import { describe, expect, it } from 'vitest';
import { generateGrowthQuery } from '../server/src/sql/growth';
import { generateNewEarnedPremiumSummaryQuery } from '../server/src/sql/cost';
import { generatePremiumTrendQuery } from '../server/src/sql/trend';
import { generateKpiQuery } from '../server/src/sql/kpi';

describe('realtime aggregation SQL contracts', () => {
  it('growth route default SQL should stay on PolicyFact and avoid PeriodAggregated', () => {
    const sql = generateGrowthQuery({
      growthType: 'yoy',
      timeView: 'monthly',
      whereClause: '1=1',
      referenceYear: 2026,
    });

    expect(sql).toContain('FROM PolicyFact');
    expect(sql).not.toContain('PeriodAggregated');
  });

  it('cost expense-forecast summary SQL should avoid EarnedPremiumMonthly', () => {
    const sql = generateNewEarnedPremiumSummaryQuery({
      whereClause: '1=1',
    });

    expect(sql).toContain('FROM PolicyFact');
    expect(sql).not.toContain('EarnedPremiumMonthly');
  });

  it('kpi and trend default SQL should avoid DailyAggregated', () => {
    const kpiSql = generateKpiQuery('1=1');
    const trendSql = generatePremiumTrendQuery('monthly', '1=1', 'policy_date', 'premium', 'org_level_3');

    expect(kpiSql).toContain('FROM PolicyFact');
    expect(trendSql).toContain('FROM PolicyFact');
    expect(kpiSql).not.toContain('DailyAggregated');
    expect(trendSql).not.toContain('DailyAggregated');
  });
});
