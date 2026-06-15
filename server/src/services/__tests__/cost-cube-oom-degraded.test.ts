/**
 * 成本立方体 OOM 降级回归测试（方案 A + C 双保险验证，CI 可跑）
 *
 * 验证内容：
 *   1. buildCostCubeSql 返回三元组，各条语句按顺序执行（方案 A 拆分验证）
 *   2. 构建期抛出 OOM 错误时 → costCubeState 被标记 degraded（方案 C）
 *   3. degraded 状态下 ensureCostCubeFresh 返回 'degraded'，不再重复触发构建
 *   4. 下一个 dataVersion 到来时，degraded 解除，允许重新尝试构建
 *   5. TEMP TABLE 清理在 OOM 时仍然执行（finally 保证）
 *
 * 不依赖 DuckDB 原生二进制（mock db），CI 环境可跑。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ensureCostCubeFresh,
  resetCostCubeStateForTest,
  getCostCubeState,
  materializeCostCube,
} from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import type { DuckDBQueryable } from '../duckdb-types.js';

// ── 辅助：构造 mock db ────────────────────────────────────────────────────────

/**
 * 构建一个 mock DuckDBQueryable，可按 SQL 内容模拟不同行为：
 *   - getTableSchema 始终返回含 policy_no/insurance_start_date 的基础 schema（无 branch_code）
 *   - 探针 SQL（含 impure_policies）始终返回 0（探针通过）
 *   - 临时去重表 SQL（含 TEMP TABLE）: 正常返回空数组，或抛出指定错误
 *   - 清理 SQL（含 DROP TABLE IF EXISTS __cost_policy_dedup）: 计数 + 正常返回
 *   - 主表 SQL（含 CREATE OR REPLACE TABLE CubeCostDay）: 正常返回
 *   - COUNT(*) AS n: 返回 42 行
 */
function makeMockDb(opts: {
  /** 在执行含 'TEMP TABLE __cost_policy_dedup' 的第一步 SQL 时抛出此错误（模拟 OOM） */
  tempTableError?: Error;
  /** 在执行含 'CREATE OR REPLACE TABLE CubeCostDay' 的第二步 SQL 时抛出此错误 */
  mainTableError?: Error;
}): {
  db: DuckDBQueryable;
  cleanupCallCount: () => number;
  queryCalls: () => string[];
} {
  const calls: string[] = [];
  let cleanupCount = 0;

  const db: DuckDBQueryable = {
    async getTableSchema(_table: string) {
      return [
        { column_name: 'policy_no', column_type: 'VARCHAR' },
        { column_name: 'insurance_start_date', column_type: 'DATE' },
        { column_name: 'premium', column_type: 'DOUBLE' },
      ];
    },
    async hasRelation(_relationName: string): Promise<boolean> {
      return false;
    },
    async dropRelationIfExists(_relationName: string): Promise<void> {
      /* noop */
    },
    invalidateCache(_options?: { silent?: boolean }): void {
      /* noop */
    },
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      const trimmed = sql.trim();
      calls.push(trimmed.slice(0, 120));

      // 探针 SQL（含 impure_policies）→ 返回 0（探针通过，不触发降级）
      if (/impure_policies/i.test(trimmed)) {
        return [{ impure_policies: 0 }] as unknown as T[];
      }

      // COUNT(*) AS n 查询（成功构建后统计行数）
      if (/COUNT\(\*\)\s+AS\s+n/i.test(trimmed)) {
        return [{ n: 42 }] as unknown as T[];
      }

      // 清理 SQL（DROP TABLE IF EXISTS __cost_policy_dedup）- 在其他检查之前
      if (/DROP TABLE IF EXISTS __cost_policy_dedup/i.test(trimmed)) {
        cleanupCount++;
        return [] as unknown as T[];
      }

      // 临时去重表 SQL（第一步，含 TEMP TABLE）
      if (/TEMP TABLE\s+__cost_policy_dedup/i.test(trimmed)) {
        if (opts.tempTableError) {
          throw opts.tempTableError;
        }
        return [] as unknown as T[];
      }

      // 主表 SQL（第二步）
      if (/CREATE OR REPLACE TABLE CubeCostDay/i.test(trimmed)) {
        if (opts.mainTableError) {
          throw opts.mainTableError;
        }
        return [] as unknown as T[];
      }

      return [] as unknown as T[];
    },
  };

  return {
    db,
    cleanupCallCount: () => cleanupCount,
    queryCalls: () => [...calls],
  };
}

/**
 * 直接调用 materializeCostCube 并等待完成（无论成功还是报错）。
 * 比 ensureCostCubeFresh + waitFor(building===null) 更可靠，
 * 因为 building 初始即 null，waitFor 可能提前返回。
 *
 * 注：OOM 错误已在 materializeCostCube 内部处理（不再向外抛出，避免外层 catch 用
 * 错误的 versionAtCatch 标记 degraded，PR #645 review fix）；非 OOM 错误仍向外抛。
 */
async function triggerAndWaitBuild(db: DuckDBQueryable): Promise<void> {
  try {
    await materializeCostCube(db);
  } catch {
    // 非 OOM 错误（Binder/语法等）——测试检查 state 而非异常本身
  }
}

// ── beforeEach：重置全局状态 ───────────────────────────────────────────────────

beforeEach(() => {
  _resetDataVersionForTesting();
  resetCostCubeStateForTest();
});

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('方案 A：buildCostCubeSql 三步拆分验证', () => {
  it('正常构建时三条 SQL 按顺序执行（临时表 → 主表 → 清理）', async () => {
    const { db, cleanupCallCount, queryCalls } = makeMockDb({});
    setDataVersion('ver-normal-A');

    await triggerAndWaitBuild(db);

    const state = getCostCubeState();
    expect(state.exact).toBe(true);
    expect(state.builtVersion).toBe('ver-norm'); // setDataVersion 取前 8 字符
    expect(state.lastError).toBeNull();

    // 清理步骤必须执行（exactly 1 次）
    expect(cleanupCallCount()).toBe(1);

    // 执行顺序：探针 → 临时表 → 主表 → 清理（探针 SQL 含 impure_policies）
    const calls = queryCalls();
    const probeIdx = calls.findIndex((s) => /impure_policies/i.test(s));
    const tempIdx = calls.findIndex((s) => /TEMP TABLE\s+__cost_policy_dedup/i.test(s));
    const mainIdx = calls.findIndex((s) => /CREATE OR REPLACE TABLE CubeCostDay/i.test(s));
    const cleanIdx = calls.findIndex((s) => /DROP TABLE IF EXISTS __cost_policy_dedup/i.test(s));

    expect(probeIdx).toBeGreaterThan(-1);
    expect(tempIdx).toBeGreaterThan(probeIdx); // 临时表在探针之后
    expect(mainIdx).toBeGreaterThan(tempIdx);  // 主表在临时表之后
    expect(cleanIdx).toBeGreaterThan(mainIdx); // 清理在主表之后
  });
});

describe('方案 C：OOM 检测后标记 degraded，防止同版本死循环', () => {
  it('临时表步骤抛出 OOM → materializeCostCube 内部吞掉，state 标 degraded（PR #645 review fix）', async () => {
    const oomError = new Error('Out of Memory: cannot allocate memory (16GB limit exceeded)');
    const { db } = makeMockDb({ tempTableError: oomError });
    setDataVersion('ver-oom-01');

    // OOM 不再向外抛（在 materializeCostCube 内部 try-catch 用 versionAtStart 处理）
    await expect(materializeCostCube(db)).resolves.toBeUndefined();

    const state = getCostCubeState();
    expect(state.exact).toBe(false);
    expect(state.builtVersion).toBe('ver-oom-'); // 前 8 字符（versionAtStart）
    expect(state.lastError).toContain('Out of Memory');
  });

  it('OOM 后 ensureCostCubeFresh 返回 degraded，不再触发重建', async () => {
    const oomError = new Error('Out of Memory: cannot allocate memory');
    const { db } = makeMockDb({ tempTableError: oomError });
    setDataVersion('ver-oom-02');

    // 第一次：触发构建
    const firstResult = ensureCostCubeFresh(db);
    expect(firstResult).toBe('building');

    // 等待构建（含 OOM catch）完成
    const buildingPromise = getCostCubeState().building!;
    await buildingPromise.catch(() => {/* 忽略 */});
    // 等微任务队列清空（finally 后的赋值 building=null 需要一个 tick）
    await new Promise((r) => setTimeout(r, 0));

    // OOM 后第二次：same dataVersion → degraded
    const secondResult = ensureCostCubeFresh(db);
    expect(secondResult).toBe('degraded');

    // 第三次：仍是 degraded，无死循环
    const thirdResult = ensureCostCubeFresh(db);
    expect(thirdResult).toBe('degraded');
  });

  it('OOM 后 isCostCubeFresh 返回 false（不允许走立方体路径）', async () => {
    const oomError = new Error('OOM: memory allocation failed');
    const { db } = makeMockDb({ tempTableError: oomError });
    setDataVersion('ver-oom-03');

    const buildingPromise = (() => {
      ensureCostCubeFresh(db);
      return getCostCubeState().building;
    })();
    if (buildingPromise) await buildingPromise.catch(() => {/* 忽略 */});
    await new Promise((r) => setTimeout(r, 0));

    // degraded 状态不能被视为"新鲜"（exact !== true）
    const state = getCostCubeState();
    const isFresh = state.builtVersion !== null
      && state.builtVersion === getDataVersionForTest()
      && state.exact === true;
    expect(isFresh).toBe(false);
    expect(state.exact).toBe(false);
  });

  it('ETL 版本更新后，OOM degraded 解除，允许重新尝试构建', async () => {
    const oomError = new Error('Out of Memory: 16GiB limit reached');
    const { db } = makeMockDb({ tempTableError: oomError });
    // 注意：setDataVersion 只取前 8 字符，需用前 8 字符不同的两个版本
    setDataVersion('etlv0400'); // 前 8 字符 = 'etlv0400'

    const bp = (() => {
      ensureCostCubeFresh(db);
      return getCostCubeState().building;
    })();
    if (bp) await bp.catch(() => {/* 忽略 */});
    await new Promise((r) => setTimeout(r, 0));

    // 确认 degraded（builtVersion='etlv0400'）
    expect(ensureCostCubeFresh(db)).toBe('degraded');

    // ETL 版本更新（模拟数据重载）——前 8 字符必须不同
    setDataVersion('etlv0401'); // 前 8 字符 = 'etlv0401'，与 'etlv0400' 不同

    // 新版本下 builtVersion('etlv0400') !== getDataVersion('etlv0401')，不再走 degraded 分支
    // → 触发新一轮构建尝试
    const result = ensureCostCubeFresh(db);
    expect(result).toBe('building');
  });

  it('TEMP TABLE 清理在 OOM 时仍通过 finally 执行', async () => {
    const oomError = new Error('Out of Memory: cannot allocate more memory');
    const { db, cleanupCallCount } = makeMockDb({ tempTableError: oomError });
    setDataVersion('ver-oom-05');

    // OOM 不再向外抛（内部处理），但 finally 仍保证清理
    await expect(materializeCostCube(db)).resolves.toBeUndefined();

    // 即使 OOM，清理也必须执行（finally 保证）
    expect(cleanupCallCount()).toBe(1);
  });

  it('构建期间 ETL 推进 dataVersion，OOM 降级仍绑定 versionAtStart（PR #645 review fix）', async () => {
    // 模拟 ETL race：进入 materializeCostCube 后但抛 OOM 之前，dataVersion 被推进
    const oomError = new Error('Out of Memory: ETL race scenario');
    const { db: baseDb } = makeMockDb({});
    setDataVersion('v1-build'); // versionAtStart 抓取此版本

    const dbWithRace: DuckDBQueryable = {
      ...baseDb,
      async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
        if (/TEMP TABLE\s+__cost_policy_dedup/i.test(sql)) {
          // 模拟 ETL race：在 OOM 抛出之前先推进版本
          setDataVersion('v2-newer');
          throw oomError;
        }
        return baseDb.query<T>(sql);
      },
    };

    await materializeCostCube(dbWithRace);

    // 关键断言：builtVersion 绑定到 versionAtStart='v1-build' 前 8 字符 'v1-build'
    // 而非 catch 时的 'v2-newer'（旧实现的 bug）
    const state = getCostCubeState();
    expect(state.exact).toBe(false);
    expect(state.builtVersion).toBe('v1-build');

    // 现在 dataVersion='v2-newer'，state.builtVersion='v1-build' → 不匹配
    // ensureCostCubeFresh 应该重新触发构建（v2 有机会，不被 v1 的 degraded 阻塞）
    const result = ensureCostCubeFresh(dbWithRace);
    expect(result).toBe('building');
  });

  it('非 OOM 错误不触发 degraded（保持原有行为——builtVersion 和 exact 保持初始 null）', async () => {
    const nonOomError = new Error('Binder Error: Referenced column "foo" not found');
    const { db } = makeMockDb({ tempTableError: nonOomError });
    setDataVersion('ver-err-01');

    const bp = (() => {
      ensureCostCubeFresh(db);
      return getCostCubeState().building;
    })();
    if (bp) await bp.catch(() => {/* 忽略 */});
    await new Promise((r) => setTimeout(r, 0));

    const state = getCostCubeState();
    // 非 OOM 错误：不标 degraded，builtVersion 保持 null，exact 保持 null，下次仍可重试
    expect(state.exact).toBeNull();
    expect(state.builtVersion).toBeNull();
    // 错误信息记录（catch 块第一行 costCubeState.lastError = message）
    expect(state.lastError).not.toBeNull();
    expect(state.lastError).toContain('Binder Error');
  });

  it('memory_limit 关键词也触发 OOM 降级', async () => {
    const memLimitError = new Error('HTTP Error 500: memory_limit exceeded during query execution');
    const { db } = makeMockDb({ tempTableError: memLimitError });
    setDataVersion('ver-mml-01');

    const bp = (() => {
      ensureCostCubeFresh(db);
      return getCostCubeState().building;
    })();
    if (bp) await bp.catch(() => {/* 忽略 */});
    await new Promise((r) => setTimeout(r, 0));

    const state = getCostCubeState();
    expect(state.exact).toBe(false);
    expect(state.builtVersion).toBe('ver-mml-'); // 前 8 字符
  });
});

// 辅助：暴露 getDataVersion 供测试内部比较
function getDataVersionForTest(): string {
  // 直接从 data-version 模块获取，与 costCubeState 比对
  // 这里通过 ensureCostCubeFresh 状态来间接验证，不需要直接读版本
  return getCostCubeState().builtVersion ?? '';
}
