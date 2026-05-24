import { describe, expect, it } from 'vitest';

import { generateFlowSummaryQuery, generateFlowTrendQuery } from '../customer-flow.js';

describe('customer flow SQL contract', () => {
  it('marks inflow fields as unavailable instead of zero', () => {
    const summarySql = generateFlowSummaryQuery({ year: 2026 });
    const trendSql = generateFlowTrendQuery({ year: 2026 });

    expect(summarySql).toContain('CAST(NULL AS BIGINT) AS has_previous');
    expect(summarySql).toContain('CAST(NULL AS BIGINT) AS inflow_count');
    expect(summarySql).toContain('CAST(NULL AS BIGINT) AS self_renewal_count');
    expect(trendSql).toContain('CAST(NULL AS BIGINT) AS inflow_count');
  });

  it('deduplicates monthly trend by VIN inside each month, not by global latest VIN', () => {
    const sql = generateFlowTrendQuery({ year: 2026 });

    expect(sql).toContain("PARTITION BY STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m'), TRIM(vehicle_frame_no)");
    expect(sql).not.toContain('PARTITION BY TRIM(vehicle_frame_no)');
  });
});
