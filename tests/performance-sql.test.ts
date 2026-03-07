import { describe, expect, it } from 'vitest';
import {
  generatePerformanceDrilldownQuery,
  generatePerformanceOrgHeatmapQuery,
  generatePerformancePeriodBoundsQuery,
  generatePerformanceSummaryQuery,
  generatePerformanceTopSalesmanQuery,
  generatePerformanceTrendQuery,
  getPerformanceSegmentFilter,
  getPerformanceVehicleCategoryFilter,
  getPlanDenominator,
} from '../server/src/sql/performance-analysis';

describe('performance analysis SQL', () => {
  it('should include business passenger category filter keywords', () => {
    const filter = getPerformanceVehicleCategoryFilter('business_passenger');

    expect(filter).toContain("customer_category LIKE '%营业%'");
    expect(filter).toContain("customer_category LIKE '%客车%'");
    expect(filter).toContain("customer_category LIKE '%出租%'");
  });

  it('summary SQL should expose premium/plan/auto_count/avg_premium/achievement/growth/ratio fields', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'none');

    expect(sql).toContain('AS premium');
    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('AS avg_premium');
    expect(sql).toContain('AS achievement_rate');
    expect(sql).toContain('AS growth_rate');
    expect(sql).toContain('AS nev_rate');
  });

  it('summary SQL should support expandable dimensions', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'energy_business_nature');
    expect(sql).toContain('child_current');
    expect(sql).toContain("|| '+' ||");
    expect(sql).toContain('ORDER BY coverage_order, row_level, child_order');
  });

  it('summary SQL should allow reusing precomputed period bounds', () => {
    const sql = generatePerformanceSummaryQuery(
      'policy_date >= \'2026-01-01\'',
      '1=1',
      'all',
      'month',
      'mom',
      'none',
      {
        refDate: '2026-02-27',
        currentStart: '2026-02-01',
        currentEnd: '2026-02-27',
        prevStart: '2026-01-01',
        prevEnd: '2026-01-31',
      }
    );

    expect(sql).toContain("CAST('2026-02-27' AS DATE) AS ref_date");
    expect(sql).not.toContain('COALESCE(MAX(CAST(policy_date AS DATE)), CURRENT_DATE)');
  });

  it('segment tag filter should include all truck branches', () => {
    const filter = getPerformanceSegmentFilter('truck');
    expect(filter).toContain('business_truck');
    expect(filter).toContain('non_business_truck');
  });

  it('should generate different previous period windows for mom and yoy', () => {
    const momSql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'none');
    const yoySql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'yoy', 'none');

    expect(momSql).toContain('INTERVAL 1 MONTH');
    expect(momSql).toContain('INTERVAL 1 DAY');
    expect(yoySql).toContain('INTERVAL 1 YEAR');
  });


  it('plan denominator should follow day/week/month/quarter/year formula', () => {
    expect(getPlanDenominator('day')).toBe(365);
    expect(getPlanDenominator('week')).toBe(52);
    expect(getPlanDenominator('month')).toBe(12);
    expect(getPlanDenominator('quarter')).toBe(4);
    expect(getPlanDenominator('year')).toBe(1);
  });

  it('trend SQL should contain multi-series outputs', () => {
    const sql = generatePerformanceTrendQuery('1=1', 'all', 'monthly');

    expect(sql).toContain('AS time_period');
    expect(sql).toContain('line_key');
    expect(sql).toContain('line_label');
    expect(sql).toContain('ROUND(SUM(premium_wan), 4) AS premium');
    expect(sql).toContain('COUNT(DISTINCT dedup_key) AS auto_count');
  });

  it('drilldown SQL should contain required analysis fields', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');

    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('AS achievement_rate');
    expect(sql).toContain('AS growth_rate');
    expect(sql).toContain('AS nev_rate');
    expect(sql).toContain('AS renewal_rate');
    expect(sql).toContain('AS transfer_business_rate');
    expect(sql).toContain('AS new_car_rate');
    expect(sql).toContain('AS transfer_rate');
    expect(sql).toContain('period_progress');
    expect(sql).toContain('generate_series');
    expect(sql).toContain('CURRENT_DATE');
  });


  it('drilldown SQL should support tonnage segment grouping for truck categories', () => {
    const sql = generatePerformanceDrilldownQuery(
      "customer_category = '营业货车'",
      "customer_category = '营业货车'",
      'business_truck',
      'day',
      'mom',
      [{ dimension: 'customer_category', value: '营业货车' }],
      'tonnage_segment'
    );

    expect(sql).toContain('tonnage_segment');
    expect(sql).toContain('未分段');
  });

  it('drilldown SQL should null out plan/achievement for dimensions without annual plans', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'customer_category');

    expect(sql).toContain('WHEN FALSE = FALSE THEN NULL');
    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('AS achievement_rate');
  });

  it('top salesman SQL should default to achievement ascending then premium descending', () => {
    const sql = generatePerformanceTopSalesmanQuery('1=1', '1=1', 'motorcycle', 'day', 'mom', 20);

    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('ORDER BY m.achievement_rate ASC NULLS LAST, m.premium DESC');
    expect(sql).toContain('LIMIT 20');
  });

  it('period bounds SQL should expose current/previous windows', () => {
    const sql = generatePerformancePeriodBoundsQuery('1=1', 'all', 'month', 'mom');
    expect(sql).toContain('AS current_start');
    expect(sql).toContain('AS current_end');
    expect(sql).toContain('AS prev_start');
    expect(sql).toContain('AS prev_end');
  });

  it('heatmap SQL should default to 15 consecutive periods', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day');
    expect(sql).toContain('INTERVAL 14 DAY');
  });

  it('heatmap SQL should normalize table aliases without generating double dots', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'org_level_3');

    expect(sql).toContain('CAST(p.org_level_3 AS VARCHAR)');
    expect(sql).not.toContain('p..org_level_3');
  });
});
