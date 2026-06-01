/**
 * 单测：QueryCache 字节上限驱逐
 *
 * QueryCache 是纯 JS（无原生 DuckDB 依赖），故放在非 `duckdb-*` 命名的文件里
 * 以便在 CI 运行（`duckdb-*.test.ts` 被 vite.config exclude 排除）。
 *
 * 回归保护：条数上限挡不住"少量超大结果集撑爆堆"，必须有字节上限 + LRU 驱逐。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryCache } from '../duckdb-infra.js';

const TTL = 60_000;

describe('QueryCache 字节上限', () => {
  const prev = process.env.DUCKDB_QUERY_CACHE_MAX_BYTES;
  afterEach(() => {
    if (prev === undefined) delete process.env.DUCKDB_QUERY_CACHE_MAX_BYTES;
    else process.env.DUCKDB_QUERY_CACHE_MAX_BYTES = prev;
  });

  it('基本 set/get + 字节计量随条目增减', () => {
    const c = new QueryCache();
    expect(c.bytes).toBe(0);
    c.set('a', [{ x: 1 }], TTL);
    expect(c.bytes).toBeGreaterThan(0);
    expect(c.get('a')).toEqual([{ x: 1 }]);
    const afterOne = c.bytes;
    c.set('a', [{ x: 1 }], TTL); // 覆盖同 key 不应累加
    expect(c.bytes).toBe(afterOne);
  });

  it('超过 maxBytes 时驱逐最久未访问项（LRU）', () => {
    // 设一个很小的字节上限，使第 3 条写入触发驱逐
    process.env.DUCKDB_QUERY_CACHE_MAX_BYTES = '200';
    const c = new QueryCache();
    const big = 'x'.repeat(60); // 每条约 (60+) * 2 字节
    c.set('k1', big, TTL);
    c.set('k2', big, TTL);
    c.set('k3', big, TTL); // 触发驱逐 k1（最久未访问）
    expect(c.get('k1')).toBeNull();
    expect(c.get('k3')).toBe(big);
    expect(c.bytes).toBeLessThanOrEqual(200);
  });

  it('LRU：get 刷新访问顺序，保护被命中的 key 不先驱逐', () => {
    // 每条 'x'.repeat(60) ≈ (60+2)*2 = 124 字节。预算 300 可容 2 条（248），
    // 第 3 条（372）触发驱逐一条。
    process.env.DUCKDB_QUERY_CACHE_MAX_BYTES = '300';
    const c = new QueryCache();
    const big = 'x'.repeat(60);
    c.set('k1', big, TTL);
    c.set('k2', big, TTL);
    c.get('k1');          // k1 变为最近访问 → k2 成为最久未访问
    c.set('k3', big, TTL); // 应驱逐 k2 而非 k1
    expect(c.get('k1')).toBe(big);
    expect(c.get('k2')).toBeNull();
  });

  it('单条超大值不自我驱逐（保留刚写入的 key，避免空写）', () => {
    process.env.DUCKDB_QUERY_CACHE_MAX_BYTES = '10';
    const c = new QueryCache();
    const huge = 'y'.repeat(1000);
    c.set('only', huge, TTL);
    expect(c.get('only')).toBe(huge); // 即使超限也保留唯一条目
    expect(c.size).toBe(1);
  });

  it('invalidateAll 重置字节计数', () => {
    const c = new QueryCache();
    c.set('a', [{ x: 1 }], TTL);
    c.invalidateAll();
    expect(c.bytes).toBe(0);
    expect(c.size).toBe(0);
  });
});
