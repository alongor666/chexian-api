/**
 * 维度表多省共存 SQL 构造（buildBranchDimSelect）单测 — 纯函数，无 DuckDB，CI 可跑。
 *
 * 被测：services/duckdb-domain-loaders.ts buildBranchDimSelect（ADR G3 · GATED 能力预备）。
 *
 * 安全核心（必须验证）：
 *   🔴 单一来源（SC-only 默认）→ 与历史 loader **逐字节一致**：`SELECT * FROM read_parquet('<p>')`，
 *      不追加 branch_code、不 UNION（golden-baseline BLOCKED 期靠"按构造"证明字节安全）。
 *   ② 多来源（GATED 多省）→ UNION ALL BY NAME；缺 branch_code 列的源补常量列，已含者原样。
 *   ③ 边界：空来源抛错（fail-fast）。
 */
import { describe, expect, it } from 'vitest';
import { buildBranchDimSelect, type BranchDimSource } from '../duckdb-domain-loaders.js';

const SC: BranchDimSource = { branchCode: 'SC', safePath: '/w/dim/salesman/latest.parquet', hasBranchCode: false };
const SX: BranchDimSource = { branchCode: 'SX', safePath: '/w/validation/SX/dim/salesman/latest.parquet', hasBranchCode: true };
const SX_NOBC: BranchDimSource = { branchCode: 'SX', safePath: '/w/validation/SX/dim/salesman/latest.parquet', hasBranchCode: false };

describe('buildBranchDimSelect — 维度表多省共存（ADR G3）', () => {
  it('🔴 单一来源（SC-only 默认）→ 逐字节等价历史 SQL，不加 branch_code、不 UNION', () => {
    expect(buildBranchDimSelect([SC])).toBe(
      "SELECT * FROM read_parquet('/w/dim/salesman/latest.parquet')",
    );
  });

  it('单一来源即便 hasBranchCode=true 也不变形（仍为单 read_parquet）', () => {
    // 单源恒等：只读该 parquet 原样（其自带的 branch_code 列保留，无需补常量）
    expect(buildBranchDimSelect([SX])).toBe(
      "SELECT * FROM read_parquet('/w/validation/SX/dim/salesman/latest.parquet')",
    );
  });

  it('多来源（SC 无 branch_code + SX 有）→ SC 补常量、SX 原样，UNION ALL BY NAME 合并', () => {
    const out = buildBranchDimSelect([SC, SX]);
    expect(out).toContain(
      "SELECT *, 'SC' AS branch_code FROM read_parquet('/w/dim/salesman/latest.parquet')",
    );
    expect(out).toContain(
      "SELECT * FROM read_parquet('/w/validation/SX/dim/salesman/latest.parquet')",
    );
    expect(out).toContain('UNION ALL BY NAME');
    // SX 已含 branch_code → 不应被补常量
    expect(out).not.toContain("'SX' AS branch_code");
  });

  it('多来源（两省均缺 branch_code）→ 各自补对应省份常量列', () => {
    const out = buildBranchDimSelect([SC, SX_NOBC]);
    expect(out).toContain("SELECT *, 'SC' AS branch_code FROM read_parquet(");
    expect(out).toContain("SELECT *, 'SX' AS branch_code FROM read_parquet(");
    expect(out).toContain('UNION ALL BY NAME');
  });

  it('多来源用 BY NAME（按列名对齐，免疫各省 parquet 列序/列集差异）', () => {
    const out = buildBranchDimSelect([SC, SX]);
    // 必须是 BY NAME 而非纯 UNION ALL（后者按位置对齐，列序不一致会错位/报错）
    expect(out).toContain('UNION ALL BY NAME');
    expect(out).not.toMatch(/UNION ALL(?!\s+BY NAME)/);
  });

  it('边界：空来源 → 抛错（fail-fast，绝不静默产空 SQL）', () => {
    expect(() => buildBranchDimSelect([])).toThrow(/至少需要一个维度来源/);
  });
});
