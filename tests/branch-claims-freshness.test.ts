import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import {
  branchClaimsDetailDir,
  summarizeFreshnessPatrol,
} from '../数据管理/lib/branch-claims-freshness.mjs';

// 注：本文件单测仅覆盖纯函数层（branchClaimsDetailDir 路径派生 + summarizeFreshnessPatrol 分类）。
// runClaimsFreshnessPatrol（副作用 log 层）属 ETL 集成测试范畴，由 `daily.mjs freshness` 实测
// （premium ETL 0 行 + exit 0）+ 主仓真实 parquet 巡检（SC/SX stale 红字告警）覆盖（闸-2 LOW-2）。
describe('branchClaimsDetailDir（省份→claims_detail 目录派生）', () => {
  it('SC / 空 / undefined → fact/claims_detail（不走 branchOutputRoot 的 policy/current）', () => {
    expect(branchClaimsDetailDir('/wh', 'SC')).toBe('/wh/fact/claims_detail');
    expect(branchClaimsDetailDir('/wh', '')).toBe('/wh/fact/claims_detail');
    expect(branchClaimsDetailDir('/wh', undefined)).toBe('/wh/fact/claims_detail');
  });
  it('非 SC → validation/<省>/claims_detail（隔离）', () => {
    expect(branchClaimsDetailDir('/wh', 'SX')).toBe('/wh/validation/SX/claims_detail');
  });
});

describe('summarizeFreshnessPatrol（巡检结果分类）', () => {
  const today = '2026-06-29';

  it('🔴 落后≥3天 → stale（含山西 06-23 落后 6 天，B4 done 目标）', () => {
    const r = summarizeFreshnessPatrol([
      { branch: 'SC', maxReportDate: '2026-06-25', today }, // 落后 4 天
      { branch: 'SX', maxReportDate: '2026-06-23', today }, // 落后 6 天
    ]);
    expect(r.stale.map((x) => x.branch)).toEqual(['SC', 'SX']);
    expect(r.stale.find((x) => x.branch === 'SX').lagDays).toBe(6);
  });

  it('落后<3天 → fresh', () => {
    const r = summarizeFreshnessPatrol([{ branch: 'SC', maxReportDate: '2026-06-28', today }]); // 落后 1 天
    expect(r.fresh.map((x) => x.branch)).toEqual(['SC']);
    expect(r.stale).toEqual([]);
  });

  it('maxReportDate null（目录缺失 / 空分区）→ unreadable，不崩', () => {
    const r = summarizeFreshnessPatrol([{ branch: 'SX', maxReportDate: null, today }]);
    expect(r.unreadable.map((x) => x.branch)).toEqual(['SX']);
    expect(r.stale).toEqual([]);
    expect(r.fresh).toEqual([]);
  });

  it('lag 负数（数据超前当日）→ fresh，不告警', () => {
    const r = summarizeFreshnessPatrol([{ branch: 'SC', maxReportDate: '2026-06-30', today }]); // 超前 1 天
    expect(r.fresh.map((x) => x.branch)).toEqual(['SC']);
  });

  it('阈值边界（恰好 3 天）→ stale', () => {
    const r = summarizeFreshnessPatrol([{ branch: 'SC', maxReportDate: '2026-06-26', today }]); // 落后 3 天
    expect(r.stale.map((x) => x.branch)).toEqual(['SC']);
  });

  it('自定义阈值（注入 2 天）', () => {
    const r = summarizeFreshnessPatrol([{ branch: 'SC', maxReportDate: '2026-06-27', today }], 2); // 落后 2 天
    expect(r.stale.map((x) => x.branch)).toEqual(['SC']);
  });

  it('空 probes → 全空（无注册省时不告警）', () => {
    expect(summarizeFreshnessPatrol([])).toEqual({ stale: [], fresh: [], unreadable: [] });
  });
});
