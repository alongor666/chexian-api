import { describe, expect, it } from 'vitest';
import {
  generateSalesTeamPerformanceQuery,
  generateSalesTeamPerformanceTotalQuery,
  SALES_TEAM_DIMENSIONS,
} from '../sales-team-performance.js';

describe('generateSalesTeamPerformanceQuery', () => {
  it('maps each whitelisted dimension to its Chinese column', () => {
    for (const [dim, column] of Object.entries(SALES_TEAM_DIMENSIONS)) {
      const sql = generateSalesTeamPerformanceQuery({ dimension: dim as keyof typeof SALES_TEAM_DIMENSIONS });
      expect(sql).toContain(`coalesce("${column}", '(未指定)') AS dim_value`);
      expect(sql).toContain('FROM SalesTeamPerformanceFact');
      expect(sql).toContain('ORDER BY standard_premium DESC');
    }
  });

  it('rejects unknown dimensions (whitelist, not interpolation)', () => {
    expect(() =>
      generateSalesTeamPerformanceQuery({ dimension: '机构"; DROP TABLE x; --' as never })
    ).toThrow(/Unknown dimension/);
  });

  it('injects validated date range on 承保确认时间', () => {
    const sql = generateSalesTeamPerformanceQuery({ dimension: 'salesman', start: '2026-01-01', end: '2026-06-30' });
    expect(sql).toContain(`"承保确认时间" >= DATE '2026-01-01'`);
    expect(sql).toContain(`"承保确认时间" <= DATE '2026-06-30'`);
  });

  it('rejects malformed dates', () => {
    expect(() =>
      generateSalesTeamPerformanceQuery({ dimension: 'salesman', start: "2026-01-01' OR 1=1 --" })
    ).toThrow(/Invalid start date/);
  });

  it('defaults limit to 200 and rejects out-of-range limits', () => {
    expect(generateSalesTeamPerformanceQuery({ dimension: 'team' })).toContain('LIMIT 200');
    expect(() => generateSalesTeamPerformanceQuery({ dimension: 'team', limit: 0 })).toThrow(/Invalid limit/);
    expect(() => generateSalesTeamPerformanceQuery({ dimension: 'team', limit: 10001 })).toThrow(/Invalid limit/);
    expect(() => generateSalesTeamPerformanceQuery({ dimension: 'team', limit: 3.5 })).toThrow(/Invalid limit/);
  });
});

describe('generateSalesTeamPerformanceTotalQuery', () => {
  it('aggregates without grouping and shares the same date WHERE', () => {
    const sql = generateSalesTeamPerformanceTotalQuery({ start: '2026-01-01' });
    expect(sql).toContain('FROM SalesTeamPerformanceFact');
    expect(sql).toContain(`"承保确认时间" >= DATE '2026-01-01'`);
    expect(sql).not.toContain('GROUP BY');
    expect(sql).toContain('latest_confirm_date');
  });

  it('degrades to 1=1 when no dates given', () => {
    expect(generateSalesTeamPerformanceTotalQuery({})).toContain('WHERE 1=1');
  });
});
