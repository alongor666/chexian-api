/**
 * 未决赔案监控 — 阈值/严重度/洞察生成器单元测试
 *
 * 覆盖三个纯函数 + 两个白名单 helper：
 *   - severityForStayDays
 *   - overallSeverityFromRatio
 *   - deriveInsights
 *   - isAgingMidBucket / isAgingOverdueBucket
 */
import { describe, expect, it } from 'vitest';
import {
  AGING_BUCKETS,
  THRESHOLDS,
  deriveInsights,
  isAgingMidBucket,
  isAgingOverdueBucket,
  overallSeverityFromRatio,
  severityForStayDays,
} from './insights';
import type { AgingRow, OrgRow, OverviewRow } from './types';

describe('severityForStayDays', () => {
  it('null / undefined → neutral', () => {
    expect(severityForStayDays(null)).toBe('neutral');
    expect(severityForStayDays(undefined)).toBe('neutral');
  });

  it('≤ 30 天 → good', () => {
    expect(severityForStayDays(0)).toBe('good');
    expect(severityForStayDays(15)).toBe('good');
    expect(severityForStayDays(THRESHOLDS.maxStayDaysWarn)).toBe('good');
  });

  it('> 30 且 ≤ 90 天 → warn', () => {
    expect(severityForStayDays(THRESHOLDS.maxStayDaysWarn + 1)).toBe('warn');
    expect(severityForStayDays(60)).toBe('warn');
    expect(severityForStayDays(THRESHOLDS.maxStayDaysBad)).toBe('warn');
  });

  it('> 90 天 → bad', () => {
    expect(severityForStayDays(THRESHOLDS.maxStayDaysBad + 1)).toBe('bad');
    expect(severityForStayDays(180)).toBe('bad');
  });
});

describe('overallSeverityFromRatio', () => {
  it('< 2.0 → good', () => {
    expect(overallSeverityFromRatio(0)).toBe('good');
    expect(overallSeverityFromRatio(1.9)).toBe('good');
  });

  it('[2.0, 4.0) → warn', () => {
    expect(overallSeverityFromRatio(THRESHOLDS.avgReserveRatioWarn)).toBe('warn');
    expect(overallSeverityFromRatio(3.9)).toBe('warn');
  });

  it('≥ 4.0 → bad', () => {
    expect(overallSeverityFromRatio(THRESHOLDS.avgReserveRatioBad)).toBe('bad');
    expect(overallSeverityFromRatio(10)).toBe('bad');
  });

  it('阈值边界含等号', () => {
    // 文档约定 ≥ 而非 >
    expect(overallSeverityFromRatio(2.0)).toBe('warn');
    expect(overallSeverityFromRatio(4.0)).toBe('bad');
  });
});

describe('isAgingMidBucket / isAgingOverdueBucket', () => {
  it('AGING_BUCKETS 字面必须与后端 SQL 严格对齐（半角连字符）', () => {
    // 反向钉死 — 改后端 SQL 时如果忘了同步前端常量，本测试会立即红
    expect(AGING_BUCKETS.fresh).toBe('0-30天');
    expect(AGING_BUCKETS.mid).toBe('31-90天');
    expect(AGING_BUCKETS.long).toBe('91-180天');
    expect(AGING_BUCKETS.veryLong).toBe('181-365天');
    expect(AGING_BUCKETS.ancient).toBe('365天+');
  });

  it('mid 桶 = 31-90天', () => {
    expect(isAgingMidBucket(AGING_BUCKETS.mid)).toBe(true);
    expect(isAgingMidBucket(AGING_BUCKETS.fresh)).toBe(false);
    expect(isAgingMidBucket('91-180天')).toBe(false);
    expect(isAgingMidBucket(undefined)).toBe(false);
  });

  it('overdue 桶 = 任意非 0-30天 的已知桶', () => {
    expect(isAgingOverdueBucket(AGING_BUCKETS.fresh)).toBe(false);
    expect(isAgingOverdueBucket(AGING_BUCKETS.mid)).toBe(true);
    expect(isAgingOverdueBucket(AGING_BUCKETS.long)).toBe(true);
    expect(isAgingOverdueBucket(AGING_BUCKETS.veryLong)).toBe(true);
    expect(isAgingOverdueBucket(AGING_BUCKETS.ancient)).toBe(true);
    expect(isAgingOverdueBucket(undefined)).toBe(false);
  });

  it('未知桶字面 → false（严格白名单，避免假阳性 100% 滞留告警 — codex P2 #1）', () => {
    // 假如后端某天又改成 '0~30天' 波浪号格式，前端常量没跟上时，
    // 必须漏告警而不是把所有桶误判为 overdue
    expect(isAgingOverdueBucket('0~30天')).toBe(false);
    expect(isAgingOverdueBucket('31~90天')).toBe(false);
    expect(isAgingOverdueBucket('其它')).toBe(false);
    expect(isAgingOverdueBucket('')).toBe(false);
  });
});

describe('deriveInsights', () => {
  const PENDING: OverviewRow = {
    claim_status: '未业务结案',
    cases: 11,
    injury_cases: 3,
    reserve_wan: 14,
    injury_reserve_wan: 4,
    avg_reserve: 12477,
  };
  const SETTLED: OverviewRow = {
    claim_status: '已业务结案',
    cases: 64,
    injury_cases: 8,
    reserve_wan: 16.5,
    injury_reserve_wan: 5,
    avg_reserve: 2586,
  };
  const ORGS: OrgRow[] = [
    { org: '高新', cases: 3, avg_reserve: 21446, max_pending_days: 39 },
    { org: '重客', cases: 6, avg_reserve: 6974, max_pending_days: 53 },
  ];
  const AGING: AgingRow[] = [
    { aging_bucket: '0-30天', cases: 5, reserve_wan: 1.8 },
    { aging_bucket: '31-90天', cases: 6, reserve_wan: 9.5 },
    { aging_bucket: '91-180天', cases: 0, reserve_wan: 0 },
    { aging_bucket: '181-365天', cases: 0, reserve_wan: 0 },
  ];

  it('完整数据 → 产出 4 条洞察', () => {
    const out = deriveInsights(PENDING, SETTLED, ORGS, AGING);
    expect(out).toHaveLength(4);
    expect(out.map(i => i.id)).toEqual([
      'top-org',
      'aging-structure',
      'injury-share',
      'settled-rhythm',
    ]);
  });

  it('topOrg 案均 21446 ÷ 全省 12477 ≈ 1.72 → bad (≥1.6)', () => {
    const out = deriveInsights(PENDING, SETTLED, ORGS, AGING);
    expect(out[0].severity).toBe('bad');
    expect(out[0].title).toContain('高新');
  });

  it('topOrg ratio < 1.2 → good', () => {
    const flatOrgs: OrgRow[] = [{ org: '均匀', cases: 5, avg_reserve: 13000, max_pending_days: 20 }];
    const out = deriveInsights(PENDING, SETTLED, flatOrgs, AGING);
    expect(out[0].severity).toBe('good');
  });

  it('账龄 31-90 占比 6/11 ≈ 54.5% (≥50%) → warn', () => {
    const out = deriveInsights(PENDING, SETTLED, ORGS, AGING);
    expect(out[1].severity).toBe('warn');
    expect(out[1].title).toBe('账龄结构需关注');
  });

  it('账龄占比 < 50% → good，标题反转', () => {
    const calm: AgingRow[] = [
      { aging_bucket: '0-30天', cases: 9, reserve_wan: 5 },
      { aging_bucket: '31-90天', cases: 2, reserve_wan: 1 },
    ];
    const out = deriveInsights(PENDING, SETTLED, ORGS, calm);
    expect(out[1].severity).toBe('good');
    expect(out[1].title).toBe('账龄结构良好');
  });

  it('人伤金额比 4/14 ≈ 28.6% (≥25%) → warn（按金额比，非件数比）', () => {
    const out = deriveInsights(PENDING, SETTLED, ORGS, AGING);
    expect(out[2].severity).toBe('warn');
  });

  it('件数比 30% 但金额比 20% → good（codex P2 #3 反例：低额轻伤不告警）', () => {
    // 30 件人伤但只占 20 万、总立案 100 万 — 件数比超阈但金额未到，
    // 此时不应告警（与 jsdoc "人伤金额占比 ≥ 25%" 口径一致）
    const lowAmountInjury: OverviewRow = {
      ...PENDING,
      cases: 100,
      injury_cases: 30, // 件数比 = 30%
      reserve_wan: 100,
      injury_reserve_wan: 20, // 金额比 = 20% < 25%
    };
    const out = deriveInsights(lowAmountInjury, SETTLED, ORGS, AGING);
    expect(out[2].severity).toBe('good');
  });

  it('件数比 10% 但金额比 50% → warn（单件高额人伤场景应告警）', () => {
    // 件数稀少但金额集中 — 件数比远低于阈值，但金额比远高于阈值，
    // 这种"少件高额"才是真正的人伤风险信号
    const highAmountInjury: OverviewRow = {
      ...PENDING,
      cases: 100,
      injury_cases: 10, // 件数比 = 10%
      reserve_wan: 100,
      injury_reserve_wan: 50, // 金额比 = 50%
    };
    const out = deriveInsights(highAmountInjury, SETTLED, ORGS, AGING);
    expect(out[2].severity).toBe('warn');
  });

  it('金额比 < 25% → good', () => {
    const lowInjury: OverviewRow = {
      ...PENDING,
      reserve_wan: 100,
      injury_reserve_wan: 10, // 金额比 = 10%
    };
    const out = deriveInsights(lowInjury, SETTLED, ORGS, AGING);
    expect(out[2].severity).toBe('good');
  });

  it('settled 永远 good', () => {
    const out = deriveInsights(PENDING, SETTLED, ORGS, AGING);
    expect(out[3].severity).toBe('good');
    expect(out[3].id).toBe('settled-rhythm');
  });

  it('空 orgs → 跳过 top-org 洞察，仅 3 条', () => {
    const out = deriveInsights(PENDING, SETTLED, [], AGING);
    expect(out).toHaveLength(3);
    expect(out.map(i => i.id)).toEqual([
      'aging-structure',
      'injury-share',
      'settled-rhythm',
    ]);
  });

  it('pending 缺失 → settled 节奏仍能输出，人伤占比为 0', () => {
    const out = deriveInsights(undefined, SETTLED, [], []);
    const settledItem = out.find(i => i.id === 'settled-rhythm');
    expect(settledItem?.severity).toBe('good');
    const injuryItem = out.find(i => i.id === 'injury-share');
    expect(injuryItem?.severity).toBe('good');
  });

  it('全部输入空 → 仍返回 3 条降级洞察（不崩溃）', () => {
    const out = deriveInsights(undefined, undefined, [], []);
    expect(out).toHaveLength(3);
    out.forEach(item => {
      expect(item.metricValue).toBeDefined();
      expect(item.title).toBeTruthy();
    });
  });

  it('topOrg avg_reserve 为 0 → 不产出 top-org 洞察', () => {
    const zeroOrgs: OrgRow[] = [{ org: '空', cases: 0, avg_reserve: 0 }];
    const out = deriveInsights(PENDING, SETTLED, zeroOrgs, AGING);
    expect(out.find(i => i.id === 'top-org')).toBeUndefined();
  });
});
