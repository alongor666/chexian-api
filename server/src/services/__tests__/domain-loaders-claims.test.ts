import { describe, expect, it, vi } from 'vitest';
import {
  createClaimsAggFromDetail,
  buildWindowedClaimsAggCTE,
  CLAIMS_REPORTED_AMOUNT_CASE,
  composeClaimsDetailSelect,
  buildClaimsDetailSelectSql,
  loadClaimsDetail,
} from '../duckdb-domain-loaders.js';
import type { DuckDBQueryable } from '../duckdb-types.js';

/** 创建用于捕获 SQL 的轻量 mock DB */
function makeMockDb() {
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
  return { db, queries };
}

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

describe('createClaimsAggFromDetail — asOfDate 可选参数（B299 预防性接口）', () => {
  it('asOfDate=null（默认）：SQL 不含 accident_time，看板行为零变化', async () => {
    const { db, queries } = makeMockDb();
    await createClaimsAggFromDetail(db, null);
    const sql = queries.find((s) => s.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    expect(sql).not.toContain('accident_time');
  });

  it('asOfDate 未传（默认 null）：与显式传 null 行为完全一致', async () => {
    const { db, queries } = makeMockDb();
    await createClaimsAggFromDetail(db);
    const sql = queries.find((s) => s.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    expect(sql).not.toContain('accident_time');
  });

  it('asOfDate 非空：SQL 含半开区间出险日期过滤（与 buildWindowedClaimsAggCTE 同口径）', async () => {
    const { db, queries } = makeMockDb();
    await createClaimsAggFromDetail(db, '2026-03-31');
    const sql = queries.find((s) => s.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    expect(sql).toContain("accident_time < DATE '2026-03-31' + INTERVAL 1 DAY");
    // 列侧不加 CAST（与 buildWindowedClaimsAggCTE 对齐）
    expect(sql).not.toContain('CAST(accident_time');
  });

  it('asOfDate 注入防护：单引号被转义（防 SQL 注入）', async () => {
    const { db, queries } = makeMockDb();
    await createClaimsAggFromDetail(db, "2026-03-31'; DROP TABLE ClaimsDetail; --");
    const sql = queries.find((s) => s.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    // 单引号被转义为两个单引号
    expect(sql).toContain("''; DROP TABLE ClaimsDetail; --");
    expect(sql).not.toMatch(/DATE '2026-03-31';\s*DROP/);
  });

  it('asOfDate 非空时仍创建 ClaimsAgg TABLE（非 CTE，静态单例行为保持）', async () => {
    const { db, queries } = makeMockDb();
    await createClaimsAggFromDetail(db, '2026-03-31');
    const sql = queries.find((s) => s.includes('CREATE OR REPLACE TABLE ClaimsAgg')) ?? '';
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+TABLE\s+ClaimsAgg/i);
  });
});

// ============================================
// PR-1 多省赔案明细扩展（ADR G4 扩展 · GATED 上线能力预备）
// ============================================

describe('composeClaimsDetailSelect (PR-1 纯函数构造)', () => {
  it('🔴 单源：逐字节等价历史 loadClaimsDetail（保留 union_by_name、不补 branch_code、不 UNION）', () => {
    const sql = composeClaimsDetailSelect([
      { branchCode: 'SC', safePath: 'wh/fact/claims_detail/claims_*.parquet', hasBranchCode: true },
    ]);
    expect(sql).toBe(
      "SELECT * FROM read_parquet('wh/fact/claims_detail/claims_*.parquet', union_by_name=true)",
    );
  });

  it('🔴 单源即使 hasBranchCode=false 也不补列（单源短路一律字节安全优先）', () => {
    const sql = composeClaimsDetailSelect([
      { branchCode: 'SC', safePath: 'p/claims_*.parquet', hasBranchCode: false },
    ]);
    expect(sql).toBe("SELECT * FROM read_parquet('p/claims_*.parquet', union_by_name=true)");
    expect(sql).not.toContain('AS branch_code');
  });

  it('多源：UNION ALL BY NAME；含 branch_code 原样、缺列补省份常量；每源均保留 union_by_name', () => {
    const sql = composeClaimsDetailSelect([
      { branchCode: 'SC', safePath: 'sc/claims_*.parquet', hasBranchCode: false },
      { branchCode: 'SX', safePath: 'sx/claims_*.parquet', hasBranchCode: true },
    ]);
    expect(sql).toContain('UNION ALL BY NAME');
    // SC 缺列补常量
    expect(sql).toContain(
      "SELECT *, 'SC' AS branch_code FROM read_parquet('sc/claims_*.parquet', union_by_name=true)",
    );
    // SX 含列：REPLACE COALESCE 兜底 NULL（混合分区健壮性，P1 codex 闸-2）
    expect(sql).toContain(
      "SELECT * REPLACE (COALESCE(branch_code, 'SX') AS branch_code) FROM read_parquet('sx/claims_*.parquet', union_by_name=true)",
    );
    // 关键：每源都保留 union_by_name（赔案 CDC 分区 schema 漂移必需，不同于派生域）
    expect((sql.match(/union_by_name=true/g) ?? []).length).toBe(2);
  });

  it('空源数组抛错', () => {
    expect(() => composeClaimsDetailSelect([])).toThrow(/至少需要一个赔案来源/);
  });

  it('P2（codex 闸-2）：非法 branchCode 抛错（须 ^[A-Z]{2}$，防注入/脏数据）', () => {
    expect(() =>
      composeClaimsDetailSelect([{ branchCode: 'sx', safePath: 'p/claims_*.parquet', hasBranchCode: true }]),
    ).toThrow(/非法 branchCode/);
    expect(() =>
      composeClaimsDetailSelect([
        { branchCode: "SX'; DROP TABLE x; --", safePath: 'p/claims_*.parquet', hasBranchCode: false },
      ]),
    ).toThrow(/非法 branchCode/);
  });
});

describe('buildClaimsDetailSelectSql (PR-1 async 入口)', () => {
  it('🔴 单源短路：不 DESCRIBE（零 DESCRIBE 调用）+ 字节安全 SQL', async () => {
    const { db, queries } = makeMockDb();
    const sql = await buildClaimsDetailSelectSql(db, [
      { branchCode: 'SC', glob: 'p/claims_*.parquet' },
    ]);
    expect(sql).toBe("SELECT * FROM read_parquet('p/claims_*.parquet', union_by_name=true)");
    expect(queries.filter((q) => q.includes('DESCRIBE')).length).toBe(0);
  });

  it('多源：DESCRIBE 实测后 SC 补常量 / SX 原样', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        // SX glob DESCRIBE → 含 branch_code；SC glob DESCRIBE → 不含
        if (sql.includes('DESCRIBE') && sql.includes('sx/')) {
          return [{ column_name: 'branch_code' }, { column_name: 'policy_no' }];
        }
        if (sql.includes('DESCRIBE')) return [{ column_name: 'policy_no' }];
        return [];
      }),
      getTableSchema: vi.fn(),
      hasRelation: vi.fn(),
      dropRelationIfExists: vi.fn(),
      invalidateCache: vi.fn(),
    } as unknown as DuckDBQueryable;

    const sql = await buildClaimsDetailSelectSql(db, [
      { branchCode: 'SC', glob: 'sc/claims_*.parquet' },
      { branchCode: 'SX', glob: 'sx/claims_*.parquet' },
    ]);
    expect(sql).toContain("SELECT *, 'SC' AS branch_code");
    expect(sql).toContain(
      "SELECT * REPLACE (COALESCE(branch_code, 'SX') AS branch_code) FROM read_parquet('sx/claims_*.parquet', union_by_name=true)",
    );
    expect(sql).toContain('UNION ALL BY NAME');
    // DESCRIBE 也保留 union_by_name（容忍分区漂移）
    expect(queries.filter((q) => q.includes('DESCRIBE') && q.includes('union_by_name=true')).length).toBe(2);
  });

  it('glob 单引号转义（防 SQL 注入）', async () => {
    const { db } = makeMockDb();
    const sql = await buildClaimsDetailSelectSql(db, [
      { branchCode: 'SC', glob: "p'; DROP TABLE x; --/claims_*.parquet" },
    ]);
    expect(sql).toContain("p''; DROP TABLE x; --");
    expect(sql).not.toMatch(/read_parquet\('p';\s*DROP/);
  });
});

describe('loadClaimsDetail (PR-1 多省扩展)', () => {
  it('🔴 extraSources=[]（默认）：ClaimsDetail VIEW SQL 逐字节等价历史（字节安全 + 零 DESCRIBE）', async () => {
    const { db, queries } = makeMockDb();
    await loadClaimsDetail(db, 'wh/claims_*.parquet');
    const viewSql = queries.find((q) => q.includes('CREATE OR REPLACE VIEW ClaimsDetail')) ?? '';
    expect(viewSql).toContain(
      "SELECT * FROM read_parquet('wh/claims_*.parquet', union_by_name=true)",
    );
    expect(viewSql).not.toContain('UNION');
    expect(queries.filter((q) => q.includes('DESCRIBE')).length).toBe(0);
  });

  it('extraSources 非空：多省 UNION ALL BY NAME 进 ClaimsDetail VIEW', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('DESCRIBE') && sql.includes('SX')) return [{ column_name: 'branch_code' }];
        if (sql.includes('DESCRIBE')) return [{ column_name: 'policy_no' }];
        if (sql.includes('SELECT COUNT(*) AS cnt')) return [{ cnt: 1 }];
        return [];
      }),
      getTableSchema: vi.fn(),
      hasRelation: vi.fn(),
      dropRelationIfExists: vi.fn(),
      invalidateCache: vi.fn(),
    } as unknown as DuckDBQueryable;

    await loadClaimsDetail(db, 'sc/claims_*.parquet', [
      { branchCode: 'SX', path: 'validation/SX/claims_detail/claims_*.parquet' },
    ]);
    const viewSql = queries.find((q) => q.includes('CREATE OR REPLACE VIEW ClaimsDetail')) ?? '';
    expect(viewSql).toContain('UNION ALL BY NAME');
    // SX 源含 branch_code → 原样；SC 基准源 DESCRIBE 无 branch_code → 补部署省常量
    expect(viewSql).toContain('AS branch_code');
  });
});
