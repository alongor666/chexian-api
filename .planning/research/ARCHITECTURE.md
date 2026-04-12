# Architecture Patterns: High-Performance DuckDB Analytics Platform

**Domain:** Full-stack analytics — React + Express + DuckDB on resource-constrained VPS
**Researched:** 2026-04-12
**Overall confidence:** HIGH (code verified + official DuckDB docs + multiple corroborating sources)

---

## Recommended Architecture

The system has a fundamentally sound layered design. The bottlenecks are localized to three specific zones:

1. SQL generation layer (N+1 UNION ALL patterns, 500+ line generators)
2. Materialization layer (PolicyFact full-table startup cost, secondary tables always materialized)
3. Frontend bundle (ECharts loaded synchronously, no code splitting measured)

The target architecture is not a redesign — it is surgical tightening within the existing layer boundaries.

```
Browser
  └─ Service Worker (stale-while-revalidate, 0ms on hit)
       └─ React Query (staleTime=Infinity with SW, 5min without)
            └─ Feature Hooks (useRenewalV2, useGrowth, etc.)
                 └─ apiClient → GET /api/query/*

Express
  └─ Middleware chain (auth → permission → snapshot-serve)
       ├─ Snapshot HIT  → fs.readFile → <5ms response
       └─ Snapshot MISS → Query Router → SQL Generator → DuckDB

DuckDB (in-process, persistent .duckdb file)
  └─ MaterializedTables: PolicyFact [eager], ClaimsDetail [deferred], CrossSellFact [deferred]
       └─ Parquet shards (4x geographic+temporal, union_by_name)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With | Current State |
|-----------|---------------|-------------------|---------------|
| React Feature Hooks | Bind UI state to API calls via React Query | apiClient only | Stable |
| FilterContext | Global filter state, triggers re-fetches | All feature hooks | Causes cascade re-renders |
| apiClient | HTTP GET with auth headers | Express /api/query/* | Stable |
| Service Worker (sw.js) | Stale-while-revalidate, ETL change detection | Browser fetch API | Stable, production-only |
| Express Middleware Chain | Auth, permission filter, snapshot interception | Routes and snapshot files | Snapshot path-scoping bug (current branch) |
| Query Router (query.ts + 19 subroutes) | Route aggregation, SQL dispatch | SQL Generators, DuckDB | Stable but subroutes exceed 400 lines |
| SQL Generator Layer (30 modules) | Dynamic SQL construction per business domain | PolicyFact, ClaimsDetail tables | Critical: N+1 UNION ALL, 500+ line files |
| DuckDB Service (duckdb.ts) | Connection pool, query execution, slow query monitoring | @duckdb/node-api, infra modules | Decomposed correctly (662 lines now split) |
| duckdb-infra.ts | QueryCache (LRU 500), ConnectionPool (max 10, 5s timeout) | DuckDB instance | Stable |
| duckdb-materialization.ts | Batch materialization engine, index creation, VIEW fallback | DuckDB instance | Works but always-eager for all tables |
| duckdb-domain-loaders.ts | Parquet discovery, deduplication, dimension loading | File system, DuckDB | Stable |
| data-bootstrapper.ts | Startup sequence orchestration | All DuckDB services | All tables materialized at startup regardless |
| Snapshot Middleware | Intercept /api/query/* after permission check, serve JSON | File system snapshots/ | Path-scoping bug on current branch |
| Static Snapshots (warehouse/snapshots/) | Pre-computed JSON per (bundle, scope, paramHash) | Snapshot middleware | 9 bundles, fingerprint invalidation coarse |

**Key invariant:** SQL generators NEVER call DuckDB directly. They produce SQL strings. Routes call DuckDB with generator output. This boundary is clean and must not be violated during refactoring.

---

## Data Flow

### Fast Path (snapshot hit, <5ms)

```
Request → Auth → Permission → Snapshot Middleware
  → SHA256(sorted params)[0:12] = paramHash
  → stat(snapshots/{bundle}/{scope}/{paramHash}.json)
  → HIT: readFileSync → respond (X-Snapshot: hit)
```

**Current bug on `fix/snapshot-path-scoping` branch**: path matching uses `req.baseUrl + req.path` to prevent cross-router false hits. Verify this fix resolves the `paramHash` collision between different bundles sharing the same filter params.

### Slow Path (DuckDB realtime, 2-5s problem zone)

```
Snapshot MISS → Route Handler
  → generateXxxSql(filters, permissionFilter) → SQL string
  → duckdb.query(sql) on PolicyFact (pre-indexed TABLE)
  → convertBigIntToNumber() → serialize
  → respond (X-Snapshot: miss)
```

**Where the 2-5 second cost hides:**

1. `coefficient.ts`: 6 UNION ALL blocks, each scanning PolicyFact independently. Each block applies the same org_level_3 LIKE matching — 6 full scans instead of 1.
2. `earned-premium-detail.ts`: 3 UNION ALL blocks spanning 12+ monthly ranges — forces N sequential scans.
3. `performance-analysis-shared.ts` (545 lines), `trend.ts` (561 lines): monolithic generators that inline all logic rather than composing CTEs.
4. `ClaimsDetail`, `CrossSellFact`, `CustomerFlow`: materialized at startup every time, occupying RAM even if the user never visits those pages.

### Startup Materialization Flow (current, all-eager)

```
app.ts
  → DataBootstrapper.initialize()
    1. Scan current/ → 4 Parquet shards
    2. CREATE TABLE raw_parquet_* (SCAN)
    3. CREATE TABLE PolicyFact (380万行, batch by month on VPS)  ← ~1-2 min, unavoidable
    4. CREATE TABLE ClaimsDetail (254K rows)                     ← unnecessary if page not visited
    5. CREATE TABLE CrossSellFact                                ← unnecessary if page not visited
    6. CREATE TABLE RenewalUniverse                              ← unnecessary if page not visited
    7. CREATE TABLE CustomerFlow                                 ← unnecessary if page not visited
    8. Load dim tables (salesman, plan, brand, repair)
    9. dataReady = true → HTTP server accepts requests
```

**Problem**: Steps 4-7 delay dataReady by 30-60 seconds on VPS and consume ~500MB RAM for tables that may never be queried in a session.

---

## Patterns to Follow

### Pattern 1: CTE Consolidation (replaces UNION ALL N+1)

**What:** Replace N separate UNION ALL blocks that each scan PolicyFact with a single scan that uses conditional aggregation via CASE WHEN or window functions.

**When:** Any SQL generator that produces `SELECT ... FROM PolicyFact WHERE condition_A UNION ALL SELECT ... FROM PolicyFact WHERE condition_B`.

**Before (N+1 — coefficient.ts pattern):**
```sql
SELECT 'chengdu' AS region, SUM(premium) FROM PolicyFact WHERE org LIKE '%成都%' AND ...
UNION ALL
SELECT 'remote' AS region, SUM(premium) FROM PolicyFact WHERE org LIKE '%资阳%' AND ...
UNION ALL
SELECT 'other'  AS region, SUM(premium) FROM PolicyFact WHERE ...
```

**After (single scan with CASE WHEN):**
```sql
WITH base AS (
  SELECT
    CASE
      WHEN org_level_3 LIKE '%成都%' THEN 'chengdu'
      WHEN org_level_3 LIKE '%资阳%' THEN 'remote'
      ELSE 'other'
    END AS region_group,
    premium, ...
  FROM PolicyFact
  WHERE [shared_where_clause]
)
SELECT region_group, SUM(premium) FROM base GROUP BY region_group
```

DuckDB evaluates CASE WHEN in a single columnar pass. This is the primary fix for the 2-5s query time.

**Confidence:** HIGH — DuckDB CTE materialization official docs confirm CTEs evaluated once and reused.

### Pattern 2: Deferred/Lazy Materialization (secondary tables)

**What:** PolicyFact must be eager (all 15+ routes depend on it). Secondary tables (ClaimsDetail, CrossSellFact, RenewalUniverse, CustomerFlow) should be created on first request, not at startup.

**When:** Any table that is used by fewer than 3 routes and has its own dedicated page.

**Implementation:**
```typescript
// duckdb-materialization.ts
const materializedTables = new Set<string>();

export async function ensureTable(db, tableName, buildFn) {
  if (materializedTables.has(tableName)) return;
  await buildFn(db);
  materializedTables.add(tableName);
}

// Route handler (e.g., claims-detail.ts)
router.get('/claims-detail/summary', async (req, res) => {
  await ensureTable(db, 'ClaimsDetail', buildClaimsDetail);
  // ... existing query logic
});
```

**Memory impact:** Frees ~200-300MB RAM on startup if claims/cross-sell pages not visited. Shifts cost to first page load (acceptable UX — show loading state).

**Confidence:** HIGH — DuckDB `CREATE TABLE AS` is idempotent after `DROP IF EXISTS`. Pattern verified in existing `materializeInBatches`.

### Pattern 3: Persistent .duckdb File with Warm Start

**What:** Instead of `:memory:` or rebuilding tables every startup, write PolicyFact to a persistent `.duckdb` file. On restart, skip materialization if Parquet fingerprints match saved state.

**When:** PM2 restarts (deploys) — currently throws away all materialization work.

**Implementation:**
```typescript
// data-bootstrapper.ts
const savedFingerprint = readFingerprintCache();
const currentFingerprint = computeParquetFingerprint(parquetFiles);

if (savedFingerprint === currentFingerprint && dbFileExists) {
  // Skip all CREATE TABLE steps — tables persist in .duckdb file
  console.log('[Bootstrap] Warm start — fingerprint unchanged, skipping materialization');
  dataReady = true; // <10s startup
} else {
  // Full materialization (current behavior)
  await runFullMaterialization();
  saveFingerprintCache(currentFingerprint);
}
```

**Tradeoff:** .duckdb file grows over time; needs periodic VACUUM. Adds file I/O on startup check. But eliminates 1-2 minute cold startup on every PM2 reload.

**Confidence:** MEDIUM — DuckDB persistent file officially supported; warm-start pattern inferred from official FAQ and community practice. Exact behavior of persisted TABLE vs VIEW needs local verification.

### Pattern 4: SQL Generator Module Decomposition

**What:** Files >400 lines that mix multiple concerns (summary aggregation, trend aggregation, drilldown) should be split into single-responsibility sub-modules, following the existing pattern in `sql/cost/` and `sql/growth/`.

**When:** `trend.ts` (561 lines), `performance-analysis-shared.ts` (545 lines), `claims-detail.ts` (535 lines).

**Target structure (trend.ts example):**
```
sql/trend/
  shared.ts       ← time dimension expressions, shared WHERE builders
  by-org.ts       ← generatePremiumTrendByOrg()
  by-salesman.ts  ← generatePremiumTrendBySalesman()
  index.ts        ← re-exports for backward compatibility
```

**Constraint:** All existing `import { generatePremiumTrendQuery } from '../sql/trend.js'` callsites must continue to work. Use re-exports in `index.ts` to maintain API surface.

**Confidence:** HIGH — pattern already proven in `sql/cost/` and `sql/growth/` subdirectories.

### Pattern 5: Vite Manual Chunks for ECharts

**What:** ECharts is a heavy library (~1MB uncompressed). Split it into its own chunk so the main bundle loads without it.

**When:** vite.config.ts `build.rollupOptions.output.manualChunks`.

**Implementation:**
```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-echarts': ['echarts', 'echarts-for-react'],
        'vendor-utils': ['date-fns', 'lodash-es'],
      }
    }
  }
}
```

Combined with existing `React.lazy` page loading, this defers ECharts parse+compile until a chart page is actually rendered.

**Confidence:** HIGH — Vite manual chunks documented; ECharts bundle size reduction is well-established.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: UNION ALL for Conditional Aggregation

**What:** Using N separate SELECT...FROM PolicyFact...UNION ALL blocks where the only difference is the WHERE clause, then unioning results.

**Why bad:** DuckDB must perform N full table scans. PolicyFact has 380万 rows. At 6 UNION ALL blocks (coefficient.ts), that is 2,280万 row scans instead of 380万. This is the primary cause of 2-5s queries.

**Instead:** Single scan with CASE WHEN conditional grouping (Pattern 1 above).

### Anti-Pattern 2: Eager Materialization of All Tables at Startup

**What:** Materializing ClaimsDetail, CrossSellFact, RenewalUniverse, CustomerFlow unconditionally in `data-bootstrapper.ts` before `dataReady = true`.

**Why bad:** On a 2-core 4GB VPS, startup takes 1-2 minutes. Memory pressure from unused tables raises baseline from ~70% to peak ~85%+ during materialization. Slows PM2 reload (deploy) window.

**Instead:** Lazy/deferred materialization per page (Pattern 2), eager only for PolicyFact.

### Anti-Pattern 3: Monolithic SQL Generator Files

**What:** 500+ line files that generate SQL for fundamentally different queries (summary, trend, drilldown, ranking) — `performance-analysis-shared.ts`, `trend.ts`, `claims-detail.ts`.

**Why bad:** Hard to test individual query types. Changes to one aggregation risk breaking others in the same file. Conflicts during parallel development. Governance `bun run test` becomes slow because test files must load entire modules.

**Instead:** Decompose by query type into `sql/{domain}/` subdirectories with an `index.ts` re-export (Pattern 4).

### Anti-Pattern 4: FilterContext as Global Mutable State Triggering Cascade Re-renders

**What:** FilterContext holds the filter state as a single object. Any filter change (date range, org, customer category) triggers a context value change, causing all consumers to re-render.

**Why bad:** On the dashboard page with 6+ chart panels, a single filter change causes 6+ simultaneous React Query invalidations, 6+ concurrent DuckDB queries, and 6+ component re-renders. Even if most queries hit the snapshot cache (<5ms), the React reconciliation work is non-trivial.

**Instead:** Split FilterContext into stable (user config, permissions) and volatile (current filter values) parts. Use `useMemo` to stabilize filter objects. Let React Query's built-in deduplication handle concurrent same-query requests.

### Anti-Pattern 5: Snapshot Invalidation on Static File Changes

**What:** Current snapshot fingerprint logic hashes ALL parquet files including static geographic partition shards that never change. When a single incremental shard updates, all bundles are invalidated and rebuilt.

**Why bad:** The 4 Parquet shards have different update frequencies. Geographic/static shards are built once. Temporal/incremental shards update daily. Full-fingerprint invalidation means a daily ETL run rebuilds ALL snapshots even if 3 of 4 shards are unchanged.

**Instead:** Fingerprint per shard. Static shard fingerprints cached separately. Snapshot bundles track WHICH shards they depend on. Only rebuild bundles whose dependent shards changed.

---

## Scalability Considerations

| Concern | Current (380万 rows, 4GB VPS) | Target After Optimization | At 1000万 rows |
|---------|-------------------------------|---------------------------|----------------|
| Startup time | ~90s (all tables eager) | ~30s (lazy secondary tables) | ~120s (PolicyFact only, batch materialization scales linearly) |
| Memory baseline | ~70% (~2.8GB) | ~50% (~2.0GB) | ~65% (DuckDB columnar compression reduces per-row cost) |
| Snapshot miss query time | 2-5s (N+1 UNION ALL) | <500ms (CTE single scan) | <1s (columnar scan scales sub-linearly with rows for aggregations) |
| Snapshot hit query time | <5ms | <5ms | <5ms (I/O bound, not row-count bound) |
| Bundle size | Unknown (needs measurement) | Target <500KB main chunk | No change (frontend static) |

**Why DuckDB scales well here:** DuckDB's vectorized columnar execution processes data in 122,880-row chunks with SIMD instructions. Aggregation queries (SUM, COUNT GROUP BY) with selective WHERE filters benefit from zone map pruning — DuckDB skips entire row groups when the filter predicate cannot match any value in the group. This means going from 380万 to 1000万 rows does NOT mean proportional query time increase.

---

## Refactoring Build Order (Dependency Constraints)

The order matters because later phases depend on earlier ones being stable.

### Phase 1: SQL Query Optimization (no API surface changes)

**Scope:** Replace UNION ALL N+1 patterns with CTE single-scan in SQL generators. No route changes, no materialization changes.

**Order within phase:**
1. `coefficient.ts` — highest impact (6 UNION ALL → 1 CTE), isolated module
2. `cost/earned-premium-detail.ts` — 3 UNION ALL blocks, contained in cost/ subdirectory
3. `performance-analysis-shared.ts` → split into `performance-analysis/` subdirectory

**Verification gate:** `bun run test` must pass after each file. Parquet direct-query comparison: `python3 scripts/verify-sql-parity.py --endpoint coefficient` (to be created).

**Blocks nothing** — changes are internal to SQL generators, no callers change.

### Phase 2: Frontend Bundle Optimization (independent of Phase 1)

**Scope:** Vite manual chunks, ECharts lazy import, component re-render audit.

**Can run in parallel with Phase 1** — zero server-side dependencies.

**Order within phase:**
1. Measure baseline (bundle-analyzer, Lighthouse)
2. Add Vite manual chunks for ECharts
3. Audit FilterContext for unnecessary re-renders
4. Measure delta

**Verification gate:** `bun run build` zero TS errors. Bundle size delta via rollup-plugin-visualizer.

### Phase 3: Lazy Materialization (depends on Phase 1 stability)

**Scope:** Move secondary table creation from `data-bootstrapper.ts` startup to first-request `ensureTable()` pattern.

**Depends on Phase 1** because if Phase 1 changes PolicyFact query patterns, Phase 3 may need to adjust which tables are "primary" vs "secondary".

**Order within phase:**
1. Add `ensureTable()` utility to `duckdb-materialization.ts`
2. Move `ClaimsDetail` to deferred (least risky — dedicated route, no PolicyFact dependency)
3. Move `CrossSellFact` to deferred
4. Move `RenewalUniverse` to deferred
5. Move `CustomerFlow` to deferred
6. Keep `PolicyFact` eager (required by 15+ routes)

**Verification gate:** health check endpoint returns `dataReady: true` faster. Memory baseline measured via `process.memoryUsage()` route.

### Phase 4: Persistent .duckdb Warm Start (depends on Phase 3)

**Scope:** Persist materialized tables across PM2 restarts using fingerprint comparison.

**Depends on Phase 3** because Phase 3 changes which tables are materialized at startup (only PolicyFact). Warm-start fingerprint logic only needs to cover PolicyFact.

**Risk:** Persistent file may become stale if ETL changes schema. Requires `VACUUM` on periodic schedule. Needs explicit `--force-rebuild` flag for deploys that change schema.

**Verification gate:** PM2 reload with unchanged Parquet files skips materialization. `bun run snapshot:verify` confirms snapshots still valid after warm restart.

### Phase 5: Snapshot Invalidation Granularity (independent, can be done anytime)

**Scope:** Per-shard fingerprinting for snapshot cache invalidation.

**No hard dependencies** on other phases, but lower risk to defer until after Phase 1-3 are validated.

---

## Key Files for Each Phase

| Phase | Primary Files to Change | Risk |
|-------|------------------------|------|
| 1: SQL Optimization | `server/src/sql/coefficient.ts`, `server/src/sql/cost/earned-premium-detail.ts`, `server/src/sql/performance-analysis-shared.ts` → split | LOW — internal to generators, tests cover output |
| 2: Frontend Bundle | `vite.config.ts`, `src/app/App.tsx`, `src/shared/contexts/FilterContext.tsx` | LOW — build-time, no runtime logic change |
| 3: Lazy Materialization | `server/src/services/duckdb-materialization.ts`, `server/src/services/data-bootstrapper.ts`, `server/src/routes/query/claims-detail.ts`, `cross-sell.ts`, `renewal-v2.ts`, `customer-flow.ts` | MEDIUM — changes startup sequence, test with VPS memory monitoring |
| 4: Warm Start | `server/src/services/data-bootstrapper.ts`, `server/src/config/database.ts` (add .duckdb path config) | MEDIUM — new persistence behavior, needs fingerprint validation logic |
| 5: Snapshot Granularity | `server/src/middleware/snapshot-serve.ts`, `scripts/build-snapshots.mjs` | LOW — existing snapshot serving unaffected; only invalidation changes |

---

## Sources

- [DuckDB CTE Materialization — official docs](https://duckdb.org/docs/stable/sql/query_syntax/with) — HIGH confidence
- [DuckDB Window Function optimization v1.2 (2025)](https://duckdb.org/2025/02/14/window-flying) — HIGH confidence
- [DuckDB Memory Management — official blog](https://duckdb.org/2024/07/09/memory-management) — HIGH confidence
- [DuckDB Internals: Vectorized Execution and Columnar Storage](https://calmops.com/database/duckdb/duckdb-internals/) — MEDIUM confidence
- [DuckDB in Node.js: Analytics without the bill (2026)](https://medium.com/@Nexumo_/duckdb-in-node-analytics-without-the-bill-536bbe6a2d2c) — MEDIUM confidence
- [DuckDB Materialization Patterns](https://medium.com/@Nexumo_/10-duckdb-materialization-patterns-youll-reuse-forever-5ed193226d2b) — MEDIUM confidence
- [Vite Code Splitting Best Practices 2025](https://dev.to/codeparrot/advanced-guide-to-using-vite-with-react-in-2025-377f) — HIGH confidence
- [Beyond Materialized Views: In-Process Columnar Caching](https://medium.com/striim/beyond-materialized-views-using-duckdb-for-in-process-columnar-caching-98b8387b8568) — MEDIUM confidence
- Code verification: `server/src/sql/coefficient.ts`, `duckdb-materialization.ts`, `duckdb-infra.ts`, `trend.ts` — HIGH confidence (direct inspection)
