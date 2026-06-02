import { afterEach, describe, expect, it } from 'vitest';
import { runPerformanceBundleQueries } from '../bundles/performance.js';

describe('performance bundle query scheduling', () => {
  const originalThreads = process.env.DUCKDB_THREADS;
  const originalConcurrency = process.env.PERFORMANCE_BUNDLE_INNER_CONCURRENCY;

  afterEach(() => {
    if (originalThreads === undefined) delete process.env.DUCKDB_THREADS;
    else process.env.DUCKDB_THREADS = originalThreads;
    if (originalConcurrency === undefined) delete process.env.PERFORMANCE_BUNDLE_INNER_CONCURRENCY;
    else process.env.PERFORMANCE_BUNDLE_INNER_CONCURRENCY = originalConcurrency;
  });

  it('serializes inner DuckDB queries on 2-thread VPS by default', async () => {
    process.env.DUCKDB_THREADS = '2';
    delete process.env.PERFORMANCE_BUNDLE_INNER_CONCURRENCY;

    let active = 0;
    let maxActive = 0;
    const seen: string[] = [];
    const query = async (sql: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(sql);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return [{ sql }];
    };

    const result = await runPerformanceBundleQueries(query, {
      summarySql: 'summary',
      trendSql: 'trend',
      drillSummarySql: 'drill-summary',
      drillRowsSql: null,
      topSalesmanSql: 'top-salesman',
      cacheTtlMs: 123,
    });

    expect(maxActive).toBe(1);
    expect(seen).toEqual(['summary', 'trend', 'drill-summary', 'top-salesman']);
    expect(result.summaryRows).toEqual([{ sql: 'summary' }]);
    expect(result.trendRows).toEqual([{ sql: 'trend' }]);
    expect(result.drillSummaryRows).toEqual([{ sql: 'drill-summary' }]);
    expect(result.drillRows).toEqual([]);
    expect(result.topSalesmanRows).toEqual([{ sql: 'top-salesman' }]);
  });
});
