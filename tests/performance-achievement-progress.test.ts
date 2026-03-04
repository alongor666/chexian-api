import { describe, expect, it } from 'vitest';
import { generatePerformanceDrilldownQuery } from '../server/src/sql/performance-analysis';

describe('performance achievement progress sql', () => {
  it('should calculate period progress by natural year days with cross-year split', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');

    expect(sql).toContain('generate_series');
    expect(sql).toContain('MAKE_DATE');
    expect(sql).toContain('366');
    expect(sql).toContain('365');
    expect(sql).toContain('period_plan_ratio');
    expect(sql).toContain('elapsed_days');
    expect(sql).toContain('total_days');
  });

  it('should apply static plan denominator for weekly achievement calculation', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');
    expect(sql).toContain('(c.allocated_plan / 52)');
  });

  it('should apply static plan denominator for monthly achievement calculation', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'month', 'mom', [], 'org_level_3');
    expect(sql).toContain('(c.allocated_plan / 12)');
  });
});
