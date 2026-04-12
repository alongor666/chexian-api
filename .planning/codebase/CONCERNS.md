# Codebase Concerns

**Analysis Date:** 2026-04-12

## Tech Debt

**Monolithic SQL Generators:**
- Issue: `server/src/sql/` contains 27 SQL generator files with significant complexity — largest: `trend.ts` (561 lines), `performance-analysis-shared.ts` (545 lines), `claims-detail.ts` (535 lines)
- Files: `server/src/sql/trend.ts`, `server/src/sql/performance-analysis-shared.ts`, `server/src/sql/claims-detail.ts`, `server/src/sql/coefficient.ts` (494 lines)
- Impact: Difficult to navigate, test, and refactor; high risk of query logic bugs when modifying coefficients or business rules
- Fix approach: Break down into smaller, single-responsibility modules (e.g., separate coefficient calculation from trend aggregation); extract reusable SQL fragments into utility functions

**Dense Data Access Layer:**
- Issue: `server/src/services/duckdb.ts` (662 lines) consolidates connection pooling, query caching, fingerprint management, domain loading, and materialization logic
- Files: `server/src/services/duckdb.ts`, `server/src/services/duckdb-materialization.ts` (478 lines), `server/src/services/duckdb-domain-loaders.ts`
- Impact: Single point of failure for all database operations; hard to unit test; schema evolution risk when adding new fields
- Fix approach: Extract QueryCache and ConnectionPool into separate modules; create field-registry-driven view builders to auto-generate DuckDB views from `server/src/config/field-registry/fields.json`

**ETL Pipeline Fragmentation:**
- Issue: 8-domain ETL still in PROPOSED state (B239-B241) — currently 1 monolithic `transform.py` (1175 lines) + 6 partial converter scripts; split architecture not yet deployed
- Files: `数据管理/daily.mjs`, `数据管理/pipelines/transform.py`, `数据管理/pipelines/convert_*.py` (0-400 lines each)
- Impact: Inconsistent data formats across domains; risk of misaligned field mappings when adding cross-sell/repair/customer-flow domains; VPS 2核4G memory tight with 380万 rows × 53 cols embedded in PolicyFact
- Fix approach: Complete Phase 1-3 of B239-B241 roadmap; split PolicyFact into thin dimension tables; move claims/cross-sell to separate materialized views with independent ETL pipelines

**Hardcoded Type Casting and Serialization:**
- Issue: DuckDB Neo API returns DATE as `{days: N}` and TIMESTAMP as `{micros: N}` — conversion logic scattered in `duckdb.ts` `convertBigIntToNumber()` without unit test
- Files: `server/src/services/duckdb.ts:320-350` (approx)
- Impact: Silent failures if new date/timestamp field added without conversion; risk of string-to-date format mismatches in front-end charts
- Fix approach: Create centralized `DuckDBTypeConverter` class with explicit test cases for each supported type; validate in schema codegen

## Known Bugs

**Quote Data Reliability (BLOCKING BUSINESS LOGIC):**
- Symptoms: "是否报价" field in source data is unreliable for determining if a renewal was quoted
- Files: `数据管理/pipelines/convert_quotes_v2.py` (filtering logic), `开发文档/数据分析报告/` (analysis output)
- Root cause: Source Excel contains boolean "是/否" flag, but correct definition should be "non-empty renewal_policy_no"
- Workaround: Manual inspection of parquet to validate quote counts; AI cannot modify source data
- User ownership: Awaiting source data correction by user (CLAUDE.md §3)

**Zero-Settled Claims Analysis Gap (INSIGHT NEEDED):**
- Symptoms: 68,511 claims (27% of resolved cases) have `reserve_amount > 0` but `settled_amount = 0`, distorting "准备金释放" impact in development triangles
- Files: `server/src/sql/claims-detail.ts`, `数据管理/warehouse/fact/claims_detail/latest.parquet`
- Trigger: Backlog items B244-B245 request dimensional analysis of zero-settlement patterns
- Workaround: None — requires analysis output to guide business interpretation of IBNR effectiveness

## Security Considerations

**Implicit Default Passwords (MEDIUM RISK):**
- Risk: CSP directive includes `'unsafe-eval'` for script execution; default user password hashes distributed in `server/src/config/preset-users.ts`
- Files: `server/src/app.ts:32` (CSP config), `server/src/config/preset-users.ts` (bcrypt hashes), `server/src/config/organizations.ts` (SHA-256 backup)
- Current mitigation: IP+username dual-key rate limiting (rateLimiter.ts), environment variable password override (auth.ts)
- Recommendations: (1) Remove `'unsafe-eval'` from CSP unless mandatory for charting library; (2) Verify all preset-users passwords are overridden in VPS `ecosystem.config.cjs`; (3) Rotate E2E test credentials `admin/CxAdmin@2026!` monthly

**Type Safety Gaps (LOW RISK):**
- Risk: 70 instances of `any` / `@ts-ignore` in backend code; DuckDB query results typed as `Record<string, any>[]` without schema validation
- Files: `server/src/types/sql-query.ts:185` (base query type), `server/src/sql/` (all generators), response validators
- Current mitigation: Zod schema validation in routes, field-registry codegen
- Recommendations: (1) Extract `DuckDBRow` type with field registry lookups; (2) Use `satisfies` assertions instead of `as any` casts; (3) Enforce `strict` mode in `tsconfig.json` for new code

## Performance Bottlenecks

**Memory Pressure on VPS:**
- Problem: PolicyFact fully materialized as 380万 rows × 53 columns (claims + cross-sell embedded) in DuckDB; 2核4G VPS running at ~70% memory during peak queries
- Files: `server/src/services/duckdb.ts:loadPolicyFactView()`, `server/src/services/duckdb-domain-loaders.ts`
- Cause: Blocking B240 prevents splitting to separate ClaimsAgg + CrossSellFact views
- Improvement path: Complete 8-domain refactor (B239-B241); move claims/cross-sell to lazy-loaded views joined only when needed; target: 50% memory reduction + 10-50x query speedup

**Slow Trend Aggregations (N+1 PROBLEM):**
- Problem: `server/src/sql/coefficient.ts` and `cost/earned-premium-detail.ts` generate 12+ UNION ALL subqueries for monthly rollups; each subquery may hit full table scan
- Files: `server/src/sql/coefficient.ts:460-480`, `server/src/sql/cost/earned-premium-detail.ts:170-250`
- Cause: DuckDB VIEW creation constraint — parameters not supported, requires f-string SQL generation
- Improvement path: (1) Batch monthly queries into single CTE with window functions (OVER PARTITION BY month); (2) Add parquet-level partitioning by month to enable file pruning; (3) Benchmark: target <500ms for 24-month trend vs current 2-5s

**Snapshot Cache Invalidation:**
- Problem: Snapshot serving layer (`server/src/middleware/snapshot-serve.ts`) invalidates on any parquet change, but ETL incremental updates from `daily.mjs` touch large static files
- Files: `server/src/middleware/snapshot-serve.ts`, `数据管理/daily.mjs`
- Cause: SHA256 fingerprint computed on **all** parquet files even for incremental updates; static 2021-2023 files touched on each run
- Improvement path: Implement granular invalidation per domain; split parquet fingerprints by "static" (≥1 year old) vs "dynamic" (current year); skip fingerprint recompute for untouched files

## Fragile Areas

**DuckDB Schema Evolution (HIGH RISK):**
- Files: `server/src/services/duckdb.ts`, `server/src/services/duckdb-domain-loaders.ts`, `server/src/config/field-registry/fields.json`
- Why fragile: Adding new field requires: (1) modify `fields.json`, (2) run `generate.mjs` codegen, (3) ensure `validator.ts` EXPECTED_TYPES matches, (4) update `mapping.ts` column alias, (5) reload schema in `duckdb.ts` — 5-step manual coordination with no atomic validation
- Safe modification: (1) Extend field-registry codegen to auto-generate field-keyed validator; (2) Add schema version check in `duckdb.ts` startup that fails if fields.json ≠ generated files; (3) Lock parquet append operations until all downstream views rebuilt

**ETL Data Domain Coordination (HIGH RISK):**
- Files: `数据管理/daily.mjs`, `数据管理/pipelines/transform.py`, `数据管理/warehouse/fact/policy/current/`, `server/src/config/paths.ts`
- Why fragile: Path configuration lives in 3 places: (1) Node.js `paths.ts`, (2) Python `shard-config.json`, (3) bash `daily.mjs` — any path change requires coordinated updates
- Safe modification: (1) Create single `data-sources.json` registry (already in MEMORY.md); (2) Codegen paths to `.js` + `.py` from single source; (3) Add governance check that compares LOCAL_*_DIR paths in Node.js vs Python runtime directories

**Route/SQL Coupling (MEDIUM RISK):**
- Files: `server/src/routes/query/*.ts` (19 sub-routes), `server/src/sql/*.ts` (27 generators)
- Why fragile: Each route imports SQL generator directly; no schema contract between them; query signature changes break routes without type error
- Safe modification: (1) Extract SQL response types into `sql-response-types.ts`; (2) Add e2e test for each route's exact response schema; (3) Use TypeScript `satisfies` to verify routes handle response types

## Scaling Limits

**Query Concurrency:**
- Current capacity: ConnectionPool defaults to 10 connections; rateLimiter allows 30 query/min (2 concurrent at 2s per query)
- Limit: At 50+ simultaneous users, connection pool exhausts; subsequent requests queue and timeout
- Scaling path: (1) Upgrade ConnectionPool to 20 connections; (2) Add query queue with priority (AI queries lowest); (3) Monitor `server/src/middleware/rateLimiter.ts` for actual concurrency patterns; (4) Consider read replicas for reporting queries

**Parquet File Volume:**
- Current capacity: 4 partitioned files in `warehouse/fact/policy/current/` + 4 incremental shards; total 94MB footprint
- Limit: If incremental daily shards accumulate unchecked, weekly compaction needed to prevent 100+ small files (DuckDB scan slowdown)
- Scaling path: (1) Archive incremental shards >7 days old into compressed static parquet; (2) Set quota in `daily.mjs` to max 14 incremental files before merge; (3) Monitor parquet file count in health check

**Data Materialization Memory:**
- Current capacity: PolicyFact + supporting views fit in 2-3GB with 2核4G VPS headroom
- Limit: Adding more materialized views (ClaimsAgg, CrossSellFact, RepairDim) risks hitting 4GB ceiling
- Scaling path: (1) Lazy-load views on-demand instead of startup materialization; (2) Add LRU cache eviction for views unused >1hr; (3) Upgrade VPS to 4核8G before adding B242-B243 feature pages

## Dependencies at Risk

**@duckdb/node-api Version Pinning (MEDIUM RISK):**
- Risk: All `@duckdb/node-api` versions use `-r.N` suffix (e.g., `1.4.4-r.1`); semver `^1.4.4` won't auto-match; manual updates needed
- Files: `package.json`, `server/src/services/duckdb.ts`
- Current version: `1.4.4-r.1` (pinned); migration from deprecated `duckdb` completed in Feb 2026 but versioning gotcha documented in MEMORY.md
- Impact: Semver dependencies can break without warning; NAPI binary compatibility shifts per Node.js minor version
- Migration plan: (1) Add pre-release detection in governance check; (2) Document `-r.N` format in DEVELOPER_CONVENTIONS.md; (3) Test on Node 18/20/22/25+ monthly

**Puppeteer MCP Browser Version Mismatch (LOW RISK):**
- Risk: `@modelcontextprotocol/server-puppeteer` pins `puppeteer ^23.4.0` (Chrome 131), but system Chrome at 145
- Files: MCP agent invocation, not committed to repo
- Current mitigation: Documented in MEMORY.md; awaiting MCP package upgrade or manual executablePath config
- Impact: Requires manual setup by developers using Puppeteer MCP; blocks automated screenshot verification
- Fix: (1) Add .env instruction for MCP Puppeteer setup; (2) Upgrade @modelcontextprotocol package when available; (3) Use Chrome DevTools Protocol proxy to auto-detect system Chrome version

## Test Coverage Gaps

**SQL Query Coverage (MEDIUM RISK):**
- What's not tested: (1) Dynamic SQL generation with variable filter counts (e.g., drilldown with 5+ dimensions), (2) edge cases of empty date ranges, (3) cross-sell coefficient rollup with zero-premium scenarios
- Files: `server/src/sql/__tests__/` (4 files covering cross-sell, cost, coefficient, claims-detail)
- Risk: Regression in trend calculations or heatmap data when SQL generators refactored
- Priority: Add parametric tests for SQL generation with 100+ filter combinations; add parquet snapshot tests comparing expected vs actual aggregations

**DuckDB Schema Validation (MEDIUM RISK):**
- What's not tested: (1) Field additions without codegen (human error), (2) parquet column type mismatches, (3) view creation failure recovery
- Files: `server/src/services/duckdb.ts`, `server/src/config/field-registry/`
- Risk: Silent schema mismatches when ETL adds new field not yet in mapping
- Priority: Add startup schema audit test; codegen test that validates all `ColumnMapping` keys exist in EXPECTED_TYPES; parquet read test that verifies all fields are typed correctly

**Front-end Permission Control (MEDIUM RISK):**
- What's not tested: (1) page-level access check for restricted accounts (e.g., `jiachengxian` user), (2) permission inheritance when drilldown crosses org boundaries
- Files: `src/features/pages/`, `src/shared/services/access-control.ts`
- Risk: User with limited permissions could manually navigate to restricted pages if client-side check bypassed
- Priority: E2E test each restricted role with URL direct access; verify server-side permissions enforced on `/api/query/*` endpoints

---

*Concerns audit: 2026-04-12*
