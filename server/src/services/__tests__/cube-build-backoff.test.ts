/**
 * 立方体构建失败退避 + 生产脱敏 OOM 标记回归测试（2026-07-09 审计修复）
 *
 * 覆盖两个生产实证缺陷（哨兵 issue #608，cost 立方体 2026-06-25 起持续 CRITICAL）：
 *   1. 生产 duckdb.ts 抛错前把原始消息脱敏为「查询执行失败 [uuid]」→ 旧版
 *      `/Out of Memory/i` 消息正则永不命中 → OOM 不降级、每个请求重复触发注定
 *      失败的重型构建。修复后错误对象带结构化标记 duckdbOom，isOutOfMemoryError
 *      优先读标记。
 *   2. 非 OOM 的确定性失败（Binder 等）无退避：builtVersion 保持 null，每个命中
 *      请求都重新触发构建。修复后同一 dataVersion 连续失败 3 次即停止自动重建
 *      （cost 转正式 degraded；trend/salesman 不再重触发），版本翻新自动恢复。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ensureCostCubeFresh,
  resetCostCubeStateForTest,
  getCostCubeState,
  ensureTrendCubeFresh,
  resetTrendCubeStateForTest,
  getTrendCubeState,
} from '../duckdb-cube.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import { isOutOfMemoryError, markDuckDbOom, isDuckDbOomMessage } from '../duckdb-error-classifier.js';
import type { DuckDBQueryable } from '../duckdb-types.js';

/** mock db：探针/构建 SQL 抛指定错误，schema 正常 */
function makeFailingDb(error: Error, opts: { failProbe?: boolean } = {}): { db: DuckDBQueryable; buildAttempts: () => number } {
  let attempts = 0;
  const db: DuckDBQueryable = {
    async getTableSchema() {
      return [
        { column_name: 'policy_no', column_type: 'VARCHAR' },
        { column_name: 'insurance_start_date', column_type: 'DATE' },
        { column_name: 'policy_date', column_type: 'DATE' },
      ];
    },
    async hasRelation() { return false; },
    async dropRelationIfExists() { /* noop */ },
    invalidateCache() { /* noop */ },
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      // 每次 cost 构建尝试恰好经过探针一次 → 只在探针处计数，避免双计
      if (/impure_policies/i.test(sql)) {
        attempts++;
        if (opts.failProbe) throw error;
        return [{ impure_policies: 0 }] as unknown as T[];
      }
      if (/DROP TABLE IF EXISTS __cost_policy_dedup/i.test(sql)) return [] as unknown as T[];
      if (/TEMP TABLE\s+__cost_policy_dedup/i.test(sql)) {
        throw error;
      }
      if (/CREATE OR REPLACE TABLE CubeTrendDay/i.test(sql)) {
        attempts++;
        throw error;
      }
      return [] as unknown as T[];
    },
  };
  return { db, buildAttempts: () => attempts };
}

/** 触发一次 ensure 并等后台构建（含失败）收尾 */
async function triggerAndSettle(ensure: () => unknown, getState: () => { building: Promise<void> | null }): Promise<void> {
  ensure();
  const b = getState().building;
  if (b) await b.catch(() => { /* 忽略 */ });
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  _resetDataVersionForTesting();
  resetCostCubeStateForTest();
  resetTrendCubeStateForTest();
});

describe('isOutOfMemoryError：结构化标记优先，消息正则兜底', () => {
  it('生产脱敏消息 + duckdbOom 标记 → 识别为 OOM（旧正则在此场景永不命中）', () => {
    const masked = new Error('查询执行失败 [ec6069e9-f6ef-483d-a91b-506ed8bbeec9]');
    expect(isOutOfMemoryError(masked)).toBe(false); // 无标记 + 脱敏消息 = 识别不出（旧缺陷形态）
    markDuckDbOom(masked);
    expect(isOutOfMemoryError(masked)).toBe(true);  // 有标记 = 修复后可识别
  });

  it('未脱敏裸 Error 走消息正则兜底（本地开发 / mock 测试兼容）', () => {
    expect(isOutOfMemoryError(new Error('Out of Memory: cannot allocate'))).toBe(true);
    expect(isOutOfMemoryError(new Error('memory_limit exceeded'))).toBe(true);
    expect(isOutOfMemoryError(new Error('Binder Error: column not found'))).toBe(false);
    expect(isDuckDbOomMessage('OOM detected')).toBe(true);
  });
});

describe('cost 立方体：生产脱敏 OOM（带标记）→ 正确降级 degraded', () => {
  it('探针抛出带 duckdbOom 标记的脱敏错误 → 本版本 degraded，不再重试', async () => {
    const masked = new Error('查询执行失败 [uuid-prod-masked]');
    markDuckDbOom(masked);
    const { db, buildAttempts } = makeFailingDb(masked, { failProbe: true });
    setDataVersion('ver-mask-1');

    await triggerAndSettle(() => ensureCostCubeFresh(db), getCostCubeState);

    const state = getCostCubeState();
    expect(state.exact).toBe(false);
    expect(state.builtVersion).toBe('ver-mask'); // 前 8 字符
    expect(ensureCostCubeFresh(db)).toBe('degraded');
    expect(buildAttempts()).toBe(1); // 只探针一次，无死循环
  });
});

describe('cost 立方体：非 OOM 确定性失败的退避（3 次后转 degraded）', () => {
  it('同版本连续失败 3 次后 ensureCostCubeFresh 返回 degraded，不再触发构建', async () => {
    const binderErr = new Error('Binder Error: Referenced column "ghost" not found');
    const { db, buildAttempts } = makeFailingDb(binderErr);
    setDataVersion('ver-back-1');

    for (let i = 0; i < 3; i++) {
      await triggerAndSettle(() => ensureCostCubeFresh(db), getCostCubeState);
    }
    expect(buildAttempts()).toBe(3);

    // 第 4 次起：退避生效，返回 degraded 且不再发起构建
    expect(ensureCostCubeFresh(db)).toBe('degraded');
    expect(ensureCostCubeFresh(db)).toBe('degraded');
    await new Promise((r) => setTimeout(r, 0));
    expect(buildAttempts()).toBe(3);
    expect(getCostCubeState().lastError).toContain('Binder Error');
  });

  it('版本翻新后退避解除，恢复重试资格', async () => {
    const binderErr = new Error('Binder Error: transient');
    const { db, buildAttempts } = makeFailingDb(binderErr);
    setDataVersion('verback2');

    for (let i = 0; i < 3; i++) {
      await triggerAndSettle(() => ensureCostCubeFresh(db), getCostCubeState);
    }
    expect(ensureCostCubeFresh(db)).toBe('degraded');

    setDataVersion('verback3'); // ETL 版本翻新（前 8 字符不同）
    expect(ensureCostCubeFresh(db)).toBe('building'); // 恢复重试
    await triggerAndSettle(() => undefined, getCostCubeState);
    expect(buildAttempts()).toBe(4);
  });

  it('单次失败不触发退避（保留瞬时故障自愈，与既有行为一致）', async () => {
    const err = new Error('IO Error: transient hiccup');
    const { db } = makeFailingDb(err);
    setDataVersion('ver-one-1');

    await triggerAndSettle(() => ensureCostCubeFresh(db), getCostCubeState);

    const state = getCostCubeState();
    expect(state.builtVersion).toBeNull(); // 未降级
    expect(ensureCostCubeFresh(db)).toBe('building'); // 仍允许重试
  });
});

describe('trend 立方体：失败退避（3 次后停止重触发）', () => {
  it('同版本连续失败 3 次后不再发起新构建', async () => {
    const err = new Error('Binder Error: CubeTrendDay build broken');
    const { db, buildAttempts } = makeFailingDb(err);
    // setDataVersion 取前 8 字符，两个版本必须在前 8 字符内互异
    setDataVersion('vertr001');

    for (let i = 0; i < 3; i++) {
      await triggerAndSettle(() => ensureTrendCubeFresh(db), getTrendCubeState);
    }
    expect(buildAttempts()).toBe(3);

    ensureTrendCubeFresh(db);
    await new Promise((r) => setTimeout(r, 0));
    expect(buildAttempts()).toBe(3); // 退避：不再重触发
    expect(getTrendCubeState().building).toBeNull();

    setDataVersion('vertr002');
    await triggerAndSettle(() => ensureTrendCubeFresh(db), getTrendCubeState);
    expect(buildAttempts()).toBe(4); // 版本翻新恢复
  });
});
