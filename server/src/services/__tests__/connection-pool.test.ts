/**
 * ConnectionPool 单元测试
 *
 * 聚焦修复"幽灵满载"bug：instance.connect() 抛错时 activeCount 必须回滚，
 * 否则每次失败永久泄漏 1 点，打满 maxSize 后池子永不自愈。
 *
 * 测试不依赖真实 DuckDB，通过 mock DuckDBInstance.connect 控制成功/失败路径。
 */
import { describe, expect, it, vi } from 'vitest';
import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ConnectionPool } from '../duckdb-infra.js';

function fakeConnection(): DuckDBConnection {
  return { __fake: true } as unknown as DuckDBConnection;
}

function makeInstance(connectImpl: () => Promise<DuckDBConnection>): DuckDBInstance {
  return { connect: connectImpl } as unknown as DuckDBInstance;
}

describe('ConnectionPool — 幽灵满载防护', () => {
  // CP-01: connect() 失败后 activeCount 必须回滚（否则后续 acquire 进排队/fast-fail）
  it('CP-01: instance.connect() 抛错时 activeCount 回滚，池子不进入幽灵满载', async () => {
    const instance = makeInstance(async () => {
      throw new Error('simulated DuckDB connect failure');
    });
    const pool = new ConnectionPool(instance, 2);

    // 连续 3 次 acquire 全部失败。修复前：activeCount 会累加到 3（>= maxSize=2），
    // 池子进入幽灵满载，下一次 acquire 进排队超时或 fast-fail。
    for (let i = 0; i < 3; i++) {
      await expect(pool.acquire()).rejects.toThrow('simulated DuckDB connect failure');
    }

    // 切换为成功实现；若 activeCount 被正确回滚，此次 acquire 应立即返回新连接，
    // 而不是进排队等 ACQUIRE_TIMEOUT_MS（当前 2s）或抛 "queue full"。
    let callCount = 0;
    (instance as any).connect = async () => {
      callCount++;
      return fakeConnection();
    };
    const conn = await pool.acquire();
    expect(conn).toBeDefined();
    expect(callCount).toBe(1);
  });

  // CP-02: 混合成功/失败 — 失败不应消耗"配额"
  it('CP-02: 失败 acquire 不消耗池子配额，成功 acquire 照常工作', async () => {
    let shouldFail = true;
    const instance = makeInstance(async () => {
      if (shouldFail) throw new Error('transient failure');
      return fakeConnection();
    });
    const pool = new ConnectionPool(instance, 1); // 极小池子放大问题

    // 先失败一次（修复前：activeCount=1，已"占满"maxSize=1）
    await expect(pool.acquire()).rejects.toThrow('transient failure');

    // 切换为成功：修复前此时 acquire 会进排队等 ACQUIRE_TIMEOUT_MS 超时；修复后立即成功
    shouldFail = false;
    const conn = await Promise.race([
      pool.acquire(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('acquire should not queue')), 500)
      ),
    ]);
    expect(conn).toBeDefined();
  });

  // CP-03: release 正常路径保持正确（防止修复引入新 bug）
  it('CP-03: 正常 acquire/release 循环仍工作', async () => {
    const instance = makeInstance(async () => fakeConnection());
    const pool = new ConnectionPool(instance, 2);

    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    pool.release(c1);
    pool.release(c2);

    // 归还后再 acquire 应从 pool 取，不再调 instance.connect
    const spyConnect = vi.fn(async () => fakeConnection());
    (instance as any).connect = spyConnect;
    const c3 = await pool.acquire();
    const c4 = await pool.acquire();
    expect(spyConnect).not.toHaveBeenCalled();
    expect([c3, c4]).toContain(c1);
    expect([c3, c4]).toContain(c2);
  });

  // CP-04: waitQueue 路径仍能 resolve（修复不应破坏排队逻辑）
  it('CP-04: 达上限后排队者在 release 时正常 resolve', async () => {
    const instance = makeInstance(async () => fakeConnection());
    const pool = new ConnectionPool(instance, 1);

    const c1 = await pool.acquire();
    const waiterPromise = pool.acquire(); // 排队

    // 下个 tick release，waiter 应拿到 c1
    setImmediate(() => pool.release(c1));
    const c2 = await waiterPromise;
    expect(c2).toBe(c1);
  });

  // CP-05: 防御性 — release(undefined) 不污染池子
  it('CP-05: release 收到 undefined/null 时不污染池子', async () => {
    const instance = makeInstance(async () => fakeConnection());
    const pool = new ConnectionPool(instance, 2);

    const c1 = await pool.acquire();
    // 模拟上游错误调用：release(undefined)。修复前这会把 undefined 入 pool
    // 或把 undefined resolve 给下一个 waiter，后续 acquire 拿到 undefined 崩溃。
    expect(() => pool.release(undefined as unknown as DuckDBConnection)).not.toThrow();

    pool.release(c1);

    // 再 acquire 两次应拿到有效连接，不是 undefined
    const c2 = await pool.acquire();
    const c3 = await pool.acquire();
    expect(c2).toBeDefined();
    expect(c3).toBeDefined();
  });
});
