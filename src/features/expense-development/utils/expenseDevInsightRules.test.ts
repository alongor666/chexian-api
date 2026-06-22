import { describe, it, expect } from 'vitest';
import { generateExpenseDevInsights } from './expenseDevInsightRules';
import type { ExpenseMetricKey } from './expenseDevInsightRules';

// 构造单年 cohort：maxDev = 最新发展月；months[devMonth][metricKey] = 值
type MonthVals = Record<number, Record<string, number>>;
function cohort(maxDev: number, months: MonthVals) {
  return { policyCount: 0, premiumWan: 0, maxDev, months };
}
// 便捷：成熟年只关心「最新月某指标」的值
function single(maxDev: number, key: string, val: number) {
  return cohort(maxDev, { [maxDev]: { [key]: val } });
}

const gen = (
  cohorts: Record<number, ReturnType<typeof cohort>>,
  years: number[],
  metric: ExpenseMetricKey,
) => generateExpenseDevInsights(cohorts, years, metric);

describe('generateExpenseDevInsights · 成熟/早期年分类（minDevForAlert=6）', () => {
  it('maxDev>=6 成熟年 / 0<maxDev<6 早期年（产 info）/ maxDev=0 不分类', () => {
    const cohorts = {
      2023: single(0, 'expense_ratio_pct', 99), // maxDev=0 → 不分类、无 info
      2024: single(6, 'expense_ratio_pct', 10), // 成熟
      2025: single(5, 'expense_ratio_pct', 10), // 早期 → info
    };
    const infos = gen(cohorts, [2023, 2024, 2025], 'expense_ratio_pct').filter((i) => i.type === 'info');
    expect(infos).toHaveLength(1);
    expect(infos[0].title).toBe('2025年仅第5月');
  });

  it('空 activeYears → []', () => {
    expect(gen({}, [], 'expense_ratio_pct')).toEqual([]);
  });

  it('maxDev=6 恰好成熟（>=6）：参与阈值告警', () => {
    const items = gen({ 2024: single(6, 'expense_ratio_pct', 21) }, [2024], 'expense_ratio_pct');
    expect(items.some((i) => i.type === 'danger')).toBe(true);
  });
});

describe('费用率阈值告警（erHigh=20 danger / erModerate=16 warning，严格 >）', () => {
  const alert = (er: number) =>
    gen({ 2024: single(6, 'expense_ratio_pct', er) }, [2024], 'expense_ratio_pct').find(
      (i) => i.type === 'danger' || i.type === 'warning'
    );

  it('er=21 → danger 费用率偏高', () => {
    expect(alert(21)).toMatchObject({ type: 'danger', title: '费用率偏高', icon: '🔴' });
  });
  it('er=20（恰好警戒线：>20 假、>16 真）→ warning 费用率关注', () => {
    expect(alert(20)).toMatchObject({ type: 'warning', title: '费用率关注' });
  });
  it('er=17 → warning 费用率关注', () => {
    expect(alert(17)).toMatchObject({ type: 'warning', title: '费用率关注' });
  });
  it('er=16（恰好关注线：>16 假）→ 无阈值告警', () => {
    expect(alert(16)).toBeUndefined();
  });
  it('er=15 → 无阈值告警', () => {
    expect(alert(15)).toBeUndefined();
  });
  it('缺该指标值 → getLatestVal 返回 null，跳过不告警', () => {
    const items = gen({ 2024: cohort(6, { 6: {} }) }, [2024], 'expense_ratio_pct');
    expect(items.filter((i) => i.type === 'danger' || i.type === 'warning')).toHaveLength(0);
  });
});

describe('费用率趋势（trendDeltaPp=3，|delta|>=3）', () => {
  const trend = (erF: number, erL: number) =>
    gen(
      { 2023: single(6, 'expense_ratio_pct', erF), 2024: single(6, 'expense_ratio_pct', erL) },
      [2023, 2024],
      'expense_ratio_pct'
    ).find((i) => i.type === 'trend');

  it('delta=+3（恰好线）→ trend 持续走高 📈', () => {
    expect(trend(10, 13)).toMatchObject({ type: 'trend', title: '费用率持续走高', icon: '📈' });
  });
  it('delta=-3 → trend 持续下降 📉', () => {
    expect(trend(13, 10)).toMatchObject({ type: 'trend', title: '费用率持续下降', icon: '📉' });
  });
  it('delta=2.9（不足）→ 无趋势', () => {
    expect(trend(10, 12.9)).toBeUndefined();
  });
  it('单一成熟年（<2）→ 无趋势', () => {
    expect(
      gen({ 2024: single(6, 'expense_ratio_pct', 10) }, [2024], 'expense_ratio_pct').find((i) => i.type === 'trend')
    ).toBeUndefined();
  });
});

describe('件均费用趋势（avgFeeGrowthPct=30，按百分比）', () => {
  const trend = (afF: number, afL: number) =>
    gen(
      { 2023: single(6, 'avg_fee_per_policy', afF), 2024: single(6, 'avg_fee_per_policy', afL) },
      [2023, 2024],
      'avg_fee_per_policy'
    ).find((i) => i.type === 'trend');

  it('growth=+30%（恰好线）→ trend 逐年攀升', () => {
    expect(trend(100, 130)).toMatchObject({ type: 'trend', title: '件均费用逐年攀升' });
  });
  it('growth=-30% → trend 逐年下降', () => {
    expect(trend(100, 70)).toMatchObject({ type: 'trend', title: '件均费用逐年下降' });
  });
  it('growth=29%（不足）→ 无趋势', () => {
    expect(trend(100, 129)).toBeUndefined();
  });
  it('基期为 0 → 除零保护，跳过', () => {
    expect(trend(0, 130)).toBeUndefined();
  });
});

describe('费用金额趋势（dev_fee_wan，growthPct>=20）', () => {
  const trend = (faF: number, faL: number) =>
    gen(
      { 2023: single(6, 'dev_fee_wan', faF), 2024: single(6, 'dev_fee_wan', faL) },
      [2023, 2024],
      'dev_fee_wan'
    ).find((i) => i.type === 'trend');

  it('growth=+20%（恰好线）→ trend 持续增长', () => {
    expect(trend(100, 120)).toMatchObject({ type: 'trend', title: '费用总额持续增长' });
  });
  it('growth=19%（不足）→ 无趋势', () => {
    expect(trend(100, 119)).toBeUndefined();
  });
});

describe('同期对比 appendCompare（compareDeltaPp=5，早期年 vs 成熟年同发展月）', () => {
  it('delta=5（恰好线，源码 <5 才跳过）→ compare（费用率，标题含第N月同期对比）', () => {
    const cohorts = {
      2024: cohort(6, { 3: { expense_ratio_pct: 10 }, 6: { expense_ratio_pct: 10 } }), // 成熟
      2025: cohort(3, { 3: { expense_ratio_pct: 15 } }), // 早期，最新月 3，delta=5（恰好线）
    };
    const cmp = gen(cohorts, [2024, 2025], 'expense_ratio_pct').find((i) => i.type === 'compare');
    expect(cmp).toBeDefined();
    expect(cmp!.title).toContain('第3月同期对比');
    expect(cmp!.title).toContain('2025 vs 2024');
  });
  it('|delta|<5 → 无 compare', () => {
    const cohorts = {
      2024: cohort(6, { 3: { expense_ratio_pct: 10 }, 6: { expense_ratio_pct: 10 } }),
      2025: cohort(3, { 3: { expense_ratio_pct: 14 } }), // delta=4 < 5
    };
    expect(gen(cohorts, [2024, 2025], 'expense_ratio_pct').find((i) => i.type === 'compare')).toBeUndefined();
  });
});

describe('件均费用同期对比（avgFeeComparePct=20）', () => {
  it('pct=20%（恰好线，源码 >=20 触发）→ compare', () => {
    const cohorts = {
      2024: cohort(6, { 3: { avg_fee_per_policy: 100 }, 6: { avg_fee_per_policy: 100 } }),
      2025: cohort(3, { 3: { avg_fee_per_policy: 120 } }), // (120-100)/100=20%（恰好线）
    };
    const cmp = gen(cohorts, [2024, 2025], 'avg_fee_per_policy').find((i) => i.type === 'compare');
    expect(cmp).toBeDefined();
    expect(cmp!.title).toContain('第3月同期对比');
  });
  it('|pct|<20 → 无 compare', () => {
    const cohorts = {
      2024: cohort(6, { 3: { avg_fee_per_policy: 100 }, 6: { avg_fee_per_policy: 100 } }),
      2025: cohort(3, { 3: { avg_fee_per_policy: 115 } }), // 15% < 20
    };
    expect(gen(cohorts, [2024, 2025], 'avg_fee_per_policy').find((i) => i.type === 'compare')).toBeUndefined();
  });
});

describe('排序与 info 提示', () => {
  it('按 TYPE_ORDER 排序（warning<danger<trend<compare<info）且早期年产 info', () => {
    const cohorts = {
      2023: single(6, 'expense_ratio_pct', 10), // 成熟基期
      2024: cohort(6, { 6: { expense_ratio_pct: 21 }, 3: { expense_ratio_pct: 10 } }), // 成熟：danger + 趋势锚
      2025: cohort(3, { 3: { expense_ratio_pct: 30 } }), // 早期：info + 同期对比
    };
    const items = gen(cohorts, [2023, 2024, 2025], 'expense_ratio_pct');
    const rank = { warning: 0, danger: 1, trend: 2, compare: 3, info: 4 } as const;
    const nums = items.map((i) => rank[i.type]);
    expect(nums).toEqual([...nums].sort((a, b) => a - b)); // 单调不减
    expect(items.some((i) => i.type === 'danger')).toBe(true);
    expect(items.some((i) => i.type === 'trend')).toBe(true);
    expect(items.some((i) => i.type === 'compare')).toBe(true);
    expect(items.some((i) => i.type === 'info' && i.title === '2025年仅第3月')).toBe(true);
  });
});

describe('费用金额同期对比 appendCompare（dev_fee_wan，compareDeltaPp=5）', () => {
  it('delta=5（恰好线）→ compare，文案含费用金额/万元', () => {
    const cohorts = {
      2024: cohort(6, { 3: { dev_fee_wan: 10 }, 6: { dev_fee_wan: 10 } }),
      2025: cohort(3, { 3: { dev_fee_wan: 15 } }), // delta=5
    };
    const cmp = gen(cohorts, [2024, 2025], 'dev_fee_wan').find((i) => i.type === 'compare');
    expect(cmp).toBeDefined();
    expect(cmp!.description).toContain('费用金额');
    expect(cmp!.description).toContain('万元');
  });
  it('delta=4（<5）→ 无 compare', () => {
    const cohorts = {
      2024: cohort(6, { 3: { dev_fee_wan: 10 }, 6: { dev_fee_wan: 10 } }),
      2025: cohort(3, { 3: { dev_fee_wan: 14 } }),
    };
    expect(gen(cohorts, [2024, 2025], 'dev_fee_wan').find((i) => i.type === 'compare')).toBeUndefined();
  });
});

describe('费用率 danger 与 moderate 可共存', () => {
  it('一年 er>20（danger）+ 另一年 16<er<=20（warning）→ 两条都出', () => {
    const cohorts = {
      2024: single(6, 'expense_ratio_pct', 22), // danger
      2025: single(6, 'expense_ratio_pct', 18), // moderate warning
    };
    const items = gen(cohorts, [2024, 2025], 'expense_ratio_pct');
    expect(items.some((i) => i.type === 'danger' && i.title === '费用率偏高')).toBe(true);
    expect(items.some((i) => i.type === 'warning' && i.title === '费用率关注')).toBe(true);
  });
});

describe('多个早期年各产一条 info', () => {
  it('两个早期年 → 两条 info（全量循环，非只取最新）', () => {
    const cohorts = {
      2024: single(3, 'expense_ratio_pct', 10),
      2025: single(4, 'expense_ratio_pct', 10),
    };
    const infos = gen(cohorts, [2024, 2025], 'expense_ratio_pct').filter((i) => i.type === 'info');
    expect(infos).toHaveLength(2);
    expect(infos.map((i) => i.title).sort()).toEqual(['2024年仅第3月', '2025年仅第4月']);
  });
});

describe('compare 路径缺值跳过（getVal null）', () => {
  it('成熟年缺早期年对应发展月的值 → appendCompare 跳过，不产 compare', () => {
    const cohorts = {
      2024: cohort(6, { 6: { expense_ratio_pct: 10 } }), // 成熟，但无 month 3
      2025: cohort(3, { 3: { expense_ratio_pct: 20 } }), // 早期，最新月 3
    };
    // prev=2024(maxDev6>=3) 但 getVal(2024,3)=null → null guard 跳过
    expect(gen(cohorts, [2024, 2025], 'expense_ratio_pct').find((i) => i.type === 'compare')).toBeUndefined();
  });
});
