import { describe, expect, it, vi } from 'vitest';

import { loadSalesTeamPerformance } from '../duckdb-domain-loaders.js';
import type { DuckDBQueryable } from '../duckdb-types.js';

describe('loadSalesTeamPerformance', () => {
  it('用转义后的 Parquet 路径建立中文列视图，并执行行数探针', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return sql.includes('COUNT(*)') ? [{ cnt: 194_191 }] : [];
      }),
      getTableSchema: vi.fn(),
      hasRelation: vi.fn(),
      dropRelationIfExists: vi.fn(),
      invalidateCache: vi.fn(),
    } as unknown as DuckDBQueryable;

    await loadSalesTeamPerformance(db, String.raw`C:\标保\郭'保东.parquet`);

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('CREATE OR REPLACE VIEW SalesTeamPerformanceFact AS');
    expect(queries[0]).toContain("read_parquet('C:/标保/郭''保东.parquet', union_by_name=true)");
    expect(queries[1]).toBe('SELECT COUNT(*) AS cnt FROM SalesTeamPerformanceFact');
  });
});
