# Code Review Report - 2026-02-16

## Summary

This review covers recent repository changes with focus on correctness, maintainability, and governance.

---

## Findings (by severity)

### 1. **High – Data quality risk in claim ratio calculation**
**File**: `分析报告/车险分析SQL查询集_20260216.sql`
**Lines**: 411-412, 421-422

**Issue**: 
```sql
ROUND(SUM(COALESCE(reported_claims, 0)) / NULLIF(SUM(premium), 0) * 100, 2) AS "赔付率%"
ROUND(SUM(COALESCE(fee_amount, 0)) / NULLIF(SUM(premium), 0) * 100, 2) AS "费用率%"
```

- Uses `COALESCE(x, 0)` which treats null `reported_claims`/`fee_amount` as **zero cost**, potentially **inflating profitability**.
- According to schema knowledge (`PARQUET_SCHEMA_KNOWLEDGE.md`), **~50% of records have null cost attributes**.
- More correct approach would either exclude null-cost records or treat them as unknown (not zero).

**Recommendation**: Change to `WHERE reported_claims IS NOT NULL` for cost calculations, or document the zero-fill assumption.

---

### 2. **High – Report/SQL inconsistency on "续保率" method**
**Files**: 
- Report: `分析报告/车险数据深度分析报告_20260216.md`
- SQL: `分析报告/车险分析SQL查询集_20260216.sql`

**Issue**:
- Report discusses "续保率" (renewal rate) conceptually but the SQL query set **does not contain a renewal rate calculation**.
- Schema field `is_renewal` exists and is documented (36.4% renewal rate), but no query uses it for renewal rate computation.
- This creates a gap between documented analysis dimensions and executable queries.

**Recommendation**: Add renewal rate query or clarify that renewal analysis is out of scope.

---

### 3. **Medium – Hardcoded date thresholds without parameterization**
**File**: `分析报告/车险分析SQL查询集_20260216.sql`
**Lines**: 63, 154, 185

**Issue**: 
```sql
WHERE policy_date >= '2025-01-01'
```

- Multiple queries use hardcoded `2025-01-01` without clear scope definition or parameterization.
- For query collection usage via `/api/query/custom`, this can silently exclude earlier data and **become outdated over time**.

**Recommendation**: Add scope comment or parameterize the date threshold.

---

### 4. **Medium – Sensitive audit data in tracked source file**
**File**: `logs/audit.log`
**Lines**: 1-11

**Issue**:
- Contains usernames, roles, internal API paths, and timestamps.
- File is modified by normal usage and currently dirty (uncommitted).
- Increases accidental disclosure/noise risk and creates non-deterministic commits.

**Recommendation**: 
- Add `logs/audit.log` to `.gitignore` (current ignore only covers `数据管理/logs/*.log`).
- Remove from tracking or exclude sensitive data.

---

### 5. **Low – SQL portability risk due to unnamed derived table**
**File**: `分析报告/车险分析SQL查询集_20260216.sql`
**Line**: 451

**Issue**:
```sql
FROM (SELECT COUNT(*) AS daily_count FROM PolicyFact GROUP BY policy_date)
```

- Derived table lacks alias.
- May work in DuckDB but fails in stricter SQL engines; reduces reusability.

**Recommendation**: Add alias like `AS daily_stats`.

---

### 6. **Low – Report reproducibility is weak**
**File**: `分析报告/车险数据深度分析报告_20260216.md`

**Issue**:
- Contains many approximate values (`~`) (e.g., lines 15-20, 36-42, 52-63).
- No query result snapshot or table export reference.
- Hard to verify or regress-check later.

**Recommendation**: Include actual query results or reference to generated artifacts.

---

### 7. **Low – Governance indexing gap**
**Files**: 
- `分析报告/车险分析SQL查询集_20260216.sql`
- `分析报告/车险数据深度分析报告_20260216.md`

**Issue**:
- Two new files under `分析报告/` are untracked.
- No corresponding entry found in `开发文档/00_index/DOC_INDEX.md`.
- Given repo conventions, discoverability/evidence-chain may be incomplete.

**Recommendation**: Register files in DOC_INDEX.md if they are intended deliverables.

---

## Open Questions

1. Is `分析报告/` intended to be versioned deliverables, or temporary analyst output?
2. For cost calculations, should null `reported_claims`/`fee_amount` be treated as `0` or excluded?
3. Is the 2025 start date an intentional business boundary, or should it be parameterized?

---

## Scope Reviewed

- **Modified**: `logs/audit.log`
- **New (untracked)**: 
  - `分析报告/车险分析SQL查询集_20260216.sql`
  - `分析报告/车险数据深度分析报告_20260216.md`
- **No frontend/backend runtime code changes** were present in the working tree.
- SQL execution validation was not possible (DuckDB CLI unavailable).

---

**Review Tool**: OpenAI Codex v0.98.0  
**Review Date**: 2026-02-16
