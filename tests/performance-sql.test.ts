import { describe, expect, it } from 'vitest';
import {
  generatePerformanceDrilldownQuery,
  generatePerformanceSummaryQuery,
  generatePerformanceTopSalesmanQuery,
  generatePerformanceTrendQuery,
  getPerformanceSegmentFilter,
  getPerformanceVehicleCategoryFilter,
} from '../server/src/sql/performance-analysis';

describe('performance analysis SQL', () => {
  it('should include business passenger category filter keywords', () => {
    const filter = getPerformanceVehicleCategoryFilter('business_passenger');

    expect(filter).toContain("customer_category LIKE '%营业%'");
    expect(filter).toContain("customer_category LIKE '%客车%'");
    expect(filter).toContain("customer_category LIKE '%出租%'");
  });

  it('summary SQL should expose premium/auto_count/avg_premium/growth_rate without achievement', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'none');

    const premiumIndex = sql.indexOf('premium');
    const autoCountIndex = sql.indexOf('c.auto_count');
    const avgPremiumIndex = sql.indexOf('AS avg_premium');
    const growthRateIndex = sql.indexOf('AS growth_rate');

    expect(premiumIndex).toBeGreaterThan(-1);
    expect(autoCountIndex).toBeGreaterThan(premiumIndex);
    expect(avgPremiumIndex).toBeGreaterThan(autoCountIndex);
    expect(growthRateIndex).toBeGreaterThan(avgPremiumIndex);
    expect(sql).not.toContain('achievement_rate');
  });

  it('summary SQL should support expandable dimensions', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'energy_business_nature');
    expect(sql).toContain('child_current');
    expect(sql).toContain("|| '+' ||");
    expect(sql).toContain('row_level');
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

  it('top salesman SQL should default to achievement ascending then premium descending', () => {
    const sql = generatePerformanceTopSalesmanQuery('1=1', '1=1', 'motorcycle', 'day', 'mom', 20);

    expect(sql).toContain('ORDER BY m.achievement_rate ASC NULLS LAST, m.premium DESC');
    expect(sql).toContain('LIMIT 20');
  });
});
