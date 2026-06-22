import { describe, expect, it, vi } from 'vitest';
import {
  createClaimsAggFromDetail,
  buildWindowedClaimsAggCTE,
  CLAIMS_REPORTED_AMOUNT_CASE,
} from '../duckdb-domain-loaders.js';
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

  it('B299 字节安全：静态 ClaimsAgg SQL 不含 accident_time 出险日期过滤（看板行为零变更）', async () => {
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
    expect(createSql).not.toContain('accident_time');
  });
});

describe('buildWindowedClaimsAggCTE (B299)', () => {
  it('追加 accident_time 半开区间过滤 (< cutoff + INTERVAL 1 DAY)，含 cutoff 当天出险', () => {
    const cte = buildWindowedClaimsAggCTE('2026-03-31');
    expect(cte).toContain("accident_time < DATE '2026-03-31' + INTERVAL 1 DAY");
    // 列侧不加 CAST（利于扫描优化）
    expect(cte).not.toContain('CAST(accident_time');
  });

  it('复用静态 ClaimsAgg 金额口径常量（防漂移 · 件数不过滤）', () => {
    const cte = buildWindowedClaimsAggCTE('2026-03-31');
    expect(cte).toContain(CLAIMS_REPORTED_AMOUNT_CASE);
    expect(cte).toMatch(/COUNT\(DISTINCT claim_no\)\s*AS\s*claim_cases/);
    expect(cte).toContain('GROUP BY policy_no');
  });

  it('cutoff 单引号转义（防 SQL 注入）', () => {
    const cte = buildWindowedClaimsAggCTE("2026-03-31'; DROP TABLE ClaimsDetail; --");
    expect(cte).toContain("''; DROP TABLE ClaimsDetail; --");
    expect(cte).not.toMatch(/DATE '2026-03-31';\s*DROP/);
  });

  it('不产出 CREATE/REPLACE 语句（仅 CTE 主体，不污染静态单例表）', () => {
    const cte = buildWindowedClaimsAggCTE('2026-03-31');
    expect(cte).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(cte).not.toMatch(/\bWITH\b/);
  });
});
