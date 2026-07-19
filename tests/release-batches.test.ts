import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL/发布链内部使用）
import {
  RELEASE_BATCHES,
  RELEASE_BATCH_IDS,
  EARLY_BATCH,
  LATE_BATCH,
  getReleaseBatch,
  batchAllCodes,
} from '../数据管理/lib/release-batches.mjs';
// @ts-expect-error — 纯 JS 模块
import { buildBatchEtlCommands } from '../scripts/sync-and-reload.mjs';
// @ts-expect-error — 纯 JS 模块
import { BRANCH_PUBLISH_DOMAINS } from '../数据管理/lib/branch-publish.mjs';

describe('release-batches SSOT（双批发布：早批 01+05 / 晚批 02+03+04）', () => {
  it('两批 = early + late，code 无重叠、并集覆盖 01-05', () => {
    expect(RELEASE_BATCH_IDS).toEqual(['early', 'late']);
    const early = batchAllCodes(EARLY_BATCH);
    const late = batchAllCodes(LATE_BATCH);
    expect(early).toEqual(['01', '05']);
    expect(late).toEqual(['02', '03', '04']);
    // 无重叠
    expect(early.filter((c: string) => late.includes(c))).toEqual([]);
    // 并集 = 上游五张表
    expect([...early, ...late].sort()).toEqual(['01', '02', '03', '04', '05']);
  });

  it('04 厂牌只在晚批、且为可选表（周日更新语义）', () => {
    expect(EARLY_BATCH.optionalCodes).toEqual([]);
    expect(LATE_BATCH.optionalCodes).toEqual(['04']);
  });

  it('早批不跑企微、晚批跑企微；两批都出报告', () => {
    expect(EARLY_BATCH.runWecom).toBe(false);
    expect(LATE_BATCH.runWecom).toBe(true);
    expect(EARLY_BATCH.runReport).toBe(true);
    expect(LATE_BATCH.runReport).toBe(true);
  });

  it('窗口：早批 07:40 起、晚批 12:00 起', () => {
    expect(EARLY_BATCH.window.start).toBe('07:40');
    expect(LATE_BATCH.window.start).toBe('12:00');
  });

  it('renewal_tracker 排在 quotes 之后（依赖 policy+quotes）', () => {
    const d = LATE_BATCH.scDomains;
    expect(d.indexOf('renewal_tracker')).toBeGreaterThan(d.indexOf('quotes'));
    // 派生域应是最后一个
    expect(d[d.length - 1]).toBe('renewal_tracker');
  });

  it('getReleaseBatch 未知 id → 抛错（fail-closed，禁默认回落）', () => {
    expect(getReleaseBatch('early')).toBe(EARLY_BATCH);
    expect(() => getReleaseBatch('midday')).toThrow(/未知发布批次/);
  });

  it('RELEASE_BATCHES 冻结（SSOT 不可运行时篡改）', () => {
    expect(Object.isFrozen(RELEASE_BATCHES)).toBe(true);
    expect(Object.isFrozen(EARLY_BATCH)).toBe(true);
  });
});

describe('buildBatchEtlCommands（批次逐域调用 daily.mjs — 单次只处理一个域）', () => {
  it('早批 = premium + claims_detail，各一条命令，均带 --no-sync --skip-report', () => {
    const cmds = buildBatchEtlCommands(EARLY_BATCH.scDomains);
    expect(cmds).toEqual([
      { label: 'ETL:premium', args: ['数据管理/daily.mjs', 'premium', '--no-sync', '--skip-report'] },
      { label: 'ETL:claims_detail', args: ['数据管理/daily.mjs', 'claims_detail', '--no-sync', '--skip-report'] },
    ]);
  });

  it('晚批逐域顺序保持 SSOT（renewal_tracker 最后）', () => {
    const cmds = buildBatchEtlCommands(LATE_BATCH.scDomains);
    expect(cmds.map((c: { args: string[] }) => c.args[1])).toEqual(LATE_BATCH.scDomains);
    expect(cmds.at(-1).args[1]).toBe('renewal_tracker');
  });
});

describe('分省核心域 ∩ 批次域（SX 也按批拆分）', () => {
  it('BRANCH_PUBLISH_DOMAINS ∩ 早批 = [premium, claims_detail]', () => {
    expect(BRANCH_PUBLISH_DOMAINS.filter((d: string) => EARLY_BATCH.scDomains.includes(d)))
      .toEqual(['premium', 'claims_detail']);
  });

  it('BRANCH_PUBLISH_DOMAINS ∩ 晚批 = [quotes, repair, renewal_tracker]（保序）', () => {
    expect(BRANCH_PUBLISH_DOMAINS.filter((d: string) => LATE_BATCH.scDomains.includes(d)))
      .toEqual(['quotes', 'repair', 'renewal_tracker']);
  });
});
