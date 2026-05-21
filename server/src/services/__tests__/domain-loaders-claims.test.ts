import { describe, expect, it, vi } from 'vitest';
import { createClaimsAggFromDetail } from '../duckdb-domain-loaders.js';
import type { DuckDBQueryable } from '../duckdb-types.js';

describe('createClaimsAggFromDetail', () => {
  it('reported_claims 按已决/未决二选一：已结案取 settled_amount，未结案取 reserve_amount', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT COUNT(*) AS cnt')) return [{ cnt: 1 }];
        return [];
      }),
      getTableSchema: vi.fn(),
      hasRelation: vi.fn(),
      dropRelationIfExists: vi.fn(),
      invalidateCache: vi.fn(),
    } as unknown as DuckDBQueryable;

    await createClaimsAggFromDetail(db);

    const createSql = queries.find((sql) => sql.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    expect(createSql).toContain('settlement_time IS NOT NULL');
    expect(createSql).toContain('settled_amount');
    expect(createSql).toContain('reserve_amount');
    expect(createSql).not.toContain('pending_amount');
    expect(createSql).not.toMatch(/COALESCE\(settled_amount,\s*0\)\s*\+\s*COALESCE\((pending|reserve)_amount,\s*0\)/);
  });

  it('reported_claims 排除无责案件 (liability_ratio=0) 与异常案件 (case_type ∈ 零结/注销/拒赔)', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT COUNT(*) AS cnt')) return [{ cnt: 1 }];
        return [];
      }),
      getTableSchema: vi.fn(),
      hasRelation: vi.fn(),
      dropRelationIfExists: vi.fn(),
      invalidateCache: vi.fn(),
    } as unknown as DuckDBQueryable;

    await createClaimsAggFromDetail(db);

    const createSql = queries.find((sql) => sql.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    // claim_cases 不过滤（保持件数 cohort）
    expect(createSql).toMatch(/COUNT\(DISTINCT claim_no\)\s*AS\s*claim_cases/);
    // reported_claims 内含两条过滤
    expect(createSql).toContain('liability_ratio');
    expect(createSql).toContain("'零结'");
    expect(createSql).toContain("'注销'");
    expect(createSql).toContain("'拒赔'");
  });
});
