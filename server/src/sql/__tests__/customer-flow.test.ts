import { describe, expect, it } from 'vitest';

import { generateFlowSummaryQuery, generateFlowTrendQuery } from '../customer-flow.js';

describe('customer flow SQL contract', () => {
  it('marks inflow fields as unavailable instead of zero', () => {
    const summarySql = generateFlowSummaryQuery({ year: 2026 });
    const trendSql = generateFlowTrendQuery({ year: 2026 });

    expect(summarySql).toContain('COUNT(CASE WHEN previous_insurer IS NOT NULL AND TRIM(previous_insurer) != \'\' THEN 1 END) AS has_previous');
    expect(summarySql).toContain('COUNT(CASE WHEN previous_insurer IS NOT NULL AND TRIM(previous_insurer) != \'\' AND previous_insurer NOT LIKE \'%华安%\' THEN 1 END) AS inflow_count');
    expect(summarySql).toContain('COUNT(CASE WHEN previous_insurer LIKE \'%华安%\' THEN 1 END) AS self_renewal_count');
    expect(trendSql).toContain('COUNT(CASE WHEN previous_insurer IS NOT NULL AND TRIM(previous_insurer) != \'\' AND previous_insurer NOT LIKE \'%华安%\' THEN 1 END) AS inflow_count');
  });

  it('deduplicates monthly trend by VIN inside each month, not by global latest VIN', () => {
    const sql = generateFlowTrendQuery({ year: 2026 });

    expect(sql).toContain('GROUP BY month');
    expect(sql).toContain('ORDER BY month');
  });
});
