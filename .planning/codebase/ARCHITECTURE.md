# Architecture

**Analysis Date:** 2026-04-12

## Pattern Overview

**Overall:** Layered architecture with separated frontend (React + Vite) and backend (Express + DuckDB) deployed on different processes.

**Key Characteristics:**
- **API-driven**: Frontend communicates exclusively via REST API endpoints (`/api/*`)
- **Static snapshots**: High-frequency queries cached as pre-computed JSON files (Phase 1 optimization)
- **Service Worker integration**: Client-side caching layer for stale-while-revalidate strategy (Phase 2 optimization)
- **Domain-driven SQL generation**: 30+ SQL generators bundled into 19 query routes
- **Materialized views**: PolicyFact, ClaimsDetail, CrossSellFact pre-materialized at startup for sub-second queries

## Layers

**Frontend UI Layer:**
- Purpose: React components, page routing, user interactions, visualization (ECharts)
- Location: `src/app/App.tsx` (entry point), `src/features/pages/*` (page components)
- Contains: React components, hooks, feature modules (dashboard, growth, cost, renewal, etc.)
- Depends on: `src/shared/api/client.ts` (API calls), React Query (caching), contexts (auth/filters/permissions)
- Used by: Browser

**Frontend Data Layer:**
- Purpose: State management (authentication, filters, permissions), data fetching coordination
- Location: `src/shared/contexts/` (DataContext, FilterContext, PermissionContext)
- Contains: Context providers, React Query integration, API token management
- Depends on: apiClient, hooks (useQuery, useMutation)
- Used by: All page components via context consumption

**Frontend Shared Library:**
- Purpose: Reusable UI components, utilities, styles, types
- Location: `src/shared/` (ui, components, utils, hooks, styles, types, api, config)
- Contains: design system tokens, formatters, color classes, API routes registry, user configuration
- Depends on: Tailwind CSS, date-fns, lodash-es
- Used by: All frontend code

**API Gateway & Middleware:**
- Purpose: Request validation, authentication, authorization, rate limiting, snapshot serving, audit logging
- Location: `server/src/middleware/` (auth, permission, snapshot-serve, rateLimiter, audit, error)
- Contains: Express middleware chain (security headers, compression, auth, permission checks, snapshot interception)
- Depends on: Express, JWT, access control service
- Processes all `/api/*` requests before routing to business logic

**Query Router Layer:**
- Purpose: REST endpoint aggregation and subrouting
- Location: `server/src/routes/query.ts` (main aggregator), `server/src/routes/query/*.ts` (19 subroutes)
- Contains: KPI, Trend, Growth, Cost, Cross-Sell, Claims-Detail, Renewal, Quote-Conversion, Performance, etc.
- Depends on: SQL generators, DuckDB service, snapshot serving middleware
- Processing: Each subroute calls SQL generator, executes via DuckDB, optionally serves cached snapshot

**SQL Generation & Query Layer:**
- Purpose: Dynamic SQL construction for different business domains and filter combinations
- Location: `server/src/sql/` (30 SQL modules: 27 generators + 3 shared utilities)
- Contains: KPI, Coefficient, Cross-Sell, Performance, Claims-Detail, Renewal-Universe, Premium-Plan, Quote-Conversion, Trend, etc.
- Pattern: Each module exports `generate*Sql(filters: Filters): string` functions
- Depends on: Database schema, business rule constants, perspective adapter
- Used by: Query routes to construct SQL dynamically

**Data Access & Query Execution:**
- Purpose: DuckDB connection management, query execution, result serialization, caching
- Location: `server/src/services/duckdb.ts` (main service), `duckdb-infra.ts` (connection pool & query cache), `duckdb-materialization.ts` (VIEW/TABLE creation)
- Contains: Query execution with slow query monitoring, connection pooling (max 10 connections), result caching (optional TTL), Parquet fingerprinting
- Depends on: `@duckdb/node-api` (Neo API), DuckDB configuration
- Materializations: Creates PolicyFact, ClaimsDetail, CrossSellFact, RenewalUniverse, CustomerFlow tables at startup
- Used by: Route handlers

**Data Bootstrapping & Domain Loading:**
- Purpose: Application startup sequence - DuckDB initialization, Parquet discovery, materialization, dimension loading
- Location: `server/src/services/data-bootstrapper.ts`, `duckdb-domain-loaders.ts`
- Phases:
  1. Scan `数据管理/warehouse/fact/policy/current/` for 4 Parquet shards (geographic+temporal partitioning)
  2. Deduplicate files by content hash, validate row counts
  3. Load into raw_parquet_* tables via `SCAN()` statement
  4. Create PolicyFact materialized VIEW (union + deduplication + normalization)
  5. Load dimension tables (salesman, plan, brand, repair resource)
  6. Create derived tables (ClaimsDetail, CrossSellFact, RenewalUniverse, CustomerFlow)
  7. Create indexes for performance optimization
- Used by: Server startup

**Authentication & Access Control:**
- Purpose: JWT token validation, user identity recovery, role-based permission filtering
- Location: `server/src/services/auth.ts` (JWT), `access-control.ts` (RBAC), `server/src/config/preset-users.ts` (user credentials)
- Pattern: Login endpoint returns JWT → middleware validates JWT on each request → permission middleware constructs SQL WHERE filters based on user role
- Access levels: branch_admin (no filter), regional_manager (org_level_3 filter), salesman (personal + team filter)
- Used by: Auth middleware, permission middleware

**Static Snapshot Layer (Phase 1):**
- Purpose: Pre-computed JSON response caching for <5ms latency on cache hit
- Location: `server/src/middleware/snapshot-serve.ts`, `数据管理/warehouse/snapshots/` (directory structure: `{bundle}/{scope}/{paramHash}.json`)
- Logic: Intercepts `/api/query/*` requests after auth/permission middleware, checks if `(bundle, scope, paramHash)` snapshot exists
- Response header `X-Snapshot: hit|miss|stale|error` indicates cache status
- Built by: `node scripts/build-snapshots.mjs` during deployment or on-demand
- Used by: All `/api/query/*` routes (9 bundle routes: dashboard-bundle, performance-bundle, cross-sell-bundle, customer-flow-*, filters-options)

**Service Worker Cache (Phase 2, Production Only):**
- Purpose: Client-side stale-while-revalidate caching for `/api/query/*` GET requests
- Location: `public/sw.js`
- Logic: On daily basis, checks `/api/data/version` for ETL updates; if data unchanged, serves cached responses with Infinity staleTime
- Enabled only in production and when active (navigator.serviceWorker.controller !== null)
- Triggers React Query cache invalidation on data update via `sw-etl-updated` event

## Data Flow

**User Query Request (cached path, <5ms):**

1. Frontend: User selects filters → React Query `useQuery()` deduces stale state
2. Frontend: If data not stale (Service Worker active, Infinity staleTime), use cached response; else fetch
3. API Gateway: HTTP GET /api/query/{endpoint}?filters
4. Auth Middleware: Validate JWT token, append req.user
5. Permission Middleware: Construct permission WHERE filter based on role, store in req.permissionFilter
6. Snapshot Serve Middleware: Compute `paramHash = SHA256(sorted query params).slice(0, 12)`
   - Scope determination: Parse req.permissionFilter to extract org_level_3 or detect telemarketing
   - File lookup: Check `数据管理/warehouse/snapshots/{bundle}/{scope}/{paramHash}.json`
   - **Cache Hit**: Read file (<5ms), return with `X-Snapshot: hit`, cache-control: max-age=60s
   - **Cache Miss/Stale**: `next()` to realtime query below
7. Query Route Handler: Route request to appropriate subroute (e.g., kpi.ts, cross-sell.ts)
8. SQL Generator: Call `generateKpiSql(filters, req.permissionFilter)` → dynamic WHERE clauses injected
9. DuckDB Execution: Execute SQL on PolicyFact (pre-materialized, indexed)
   - Slow queries (>3s) logged for monitoring
   - Results cached in QueryCache (optional, configurable per query)
10. Serialization: Convert DuckDB DATE/TIMESTAMP objects to ISO strings
11. Response: Return `{success: true, data: [...], meta: {snapshot: false, ...}}`

**State Management:**

- **Frontend auth state**: JWT stored in memory (apiClient.token), recovered from sessionStorage on page load
- **Frontend UI state**: React Query cache (staleTime=5min in dev/HTTP, Infinity with Service Worker)
- **Frontend filters**: FilterContext (global mutable state, causes re-renders on change)
- **Frontend permissions**: PermissionContext (user role, cached org/salesman/team hierarchy)
- **Server-side caching**: Query cache (per-SQL with optional TTL), Parquet fingerprint cache (5min TTL), snapshot path cache (5min TTL)

## Key Abstractions

**PolicyFact Table:**
- Purpose: Unified policy/premium fact table with all business dimensions and metrics
- Location: `server/src/services/duckdb-materialization.ts` (creation), views as `PolicyFact` or `PolicyFactRealtime` (fallback)
- Scope: All in-force commercial insurance policies (excludes motorcycle, trailer)
- Columns: 42 normalized fields (policy_no, insurance_start_date, premium, claims, org_level_3, salesman_name, customer_category, etc.)
- Computed: earned_exposure, earned_premium, earned_loss_ratio, is_cross_sell, insurance_grade
- Used by: 15+ query routes

**SQL Builder Pattern:**
- Purpose: Encapsulate common WHERE clause patterns
- Location: `server/src/sql/sql-builder.ts`
- Functions: `buildOrgFilter()`, `buildDateRangeFilter()`, `buildCustomerCategoryFilter()`, etc.
- Pattern: All generator functions construct SQL string with parameterized values (no direct string interpolation)
- Security: SQL injection prevented via `sanitizeTableName()`, `escapeSqlValue()` utilities

**Perspective Adapter:**
- Purpose: Handle different data slicing perspectives (org level 1/2/3, salesman, team, combined, etc.)
- Location: `server/src/sql/perspective-adapter.ts`
- Pattern: Given `perspective` parameter, transforms GROUP BY clause to use appropriate dimension
- Used by: Performance, coefficient, growth, KPI queries

**Route Cache Key Generation:**
- Purpose: Generate deterministic cache keys for snapshot/query cache based on route + filters
- Location: `server/src/routes/query/shared.ts` → `buildRouteCacheKey()`
- Determinism: Sorted query params → SHA256 → first 12 chars
- Used by: Snapshot middleware, optional route-level caching

**DuckDBQueryable Interface:**
- Purpose: Abstract DuckDB operations for testability and dependency injection
- Location: `server/src/services/duckdb-types.ts`
- Methods: `query<T>()`, `exec()`, `dropRelationIfExists()`, `getRelationInfo()`
- Implementations: Real `DuckDBService`, mock implementations for testing

## Entry Points

**Frontend Entry Point:**
- Location: `src/app/App.tsx`
- Triggers: Browser loads HTML, Vite resolves dependencies, React mounts to `#root` DOM element
- Responsibilities: Set up routing, providers (QueryClient, DataProvider, PermissionProvider, ThemeProvider), define page lazy-loading routes
- Initial load: Auth recovery from sessionStorage, permission check, conditional redirect to LoginPage

**Backend Entry Point:**
- Location: `server/src/app.ts`
- Triggers: `bun run dev:full` or Node.js process startup
- Responsibilities:
  1. Initialize security middleware (helmet, CORS, content-security-policy)
  2. Register request parsers (JSON, URL-encoded)
  3. Set up audit logging
  4. Register rate limiters (3 tiers: 100/min general, 5/min login, 30/min query)
  5. Register health check endpoint (`GET /health` → 503 until dataReady=true)
  6. Initialize DuckDB service
  7. Run DataBootstrapper to load and materialize Parquet data
  8. Set dataReady=true, start HTTP server
  9. Register signal handlers (SIGTERM/SIGINT) for graceful shutdown

**Data Initialization Entry Point:**
- Location: `数据管理/daily.mjs` (CLI) or `server/src/services/data-bootstrapper.ts` (programmatic)
- Triggers: Manual `node 数据管理/daily.mjs` or daily scheduled job (ETL)
- Responsibilities: Discover Parquet files, deduplicate, validate, load to DuckDB, materialize derived tables, sync to VPS

## Error Handling

**Strategy:** Layered error handling with domain-specific responses

**Patterns:**

1. **Request validation errors** (auth.ts, permission.ts):
   - Return 401 Unauthorized (invalid/expired JWT)
   - Return 403 Forbidden (insufficient permissions)
   - Middleware throws AppError, caught by errorHandler

2. **Query execution errors** (DuckDB):
   - Wrap in try-catch at route level
   - Return 400 Bad Request for invalid SQL/parameters
   - Return 500 Internal Server Error for database failures
   - Log full error stack server-side (never expose to client in production)

3. **Data loading errors** (data-bootstrapper.ts):
   - Log but don't block startup (non-fatal)
   - Server starts without data, APIs return empty results
   - Health check returns 503 if bootstrap fails before dataReady timeout

4. **Rate limit errors**:
   - Return 429 Too Many Requests (handled by Express middleware)
   - Per-endpoint configuration (login 5/min, query 30/min)

5. **Snapshot serving errors**:
   - Fail silently with `X-Snapshot: error` header
   - Fall back to realtime DuckDB query
   - Log warning, don't propagate to client

6. **Global error handler** (`server/src/middleware/error.ts`):
   - Catches all unhandled Promise rejections via asyncHandler wrapper
   - Distinguishes operational errors (AppError) from unexpected errors
   - Production mode: hides error details
   - Dev mode: exposes full error message

## Cross-Cutting Concerns

**Logging:**
- Frontend: `Logger` class with module namespace (e.g., `new Logger('DataContext')`)
- Backend: `console.log` with structured prefixes (`[Server]`, `[DuckDB]`, `[Auth]`)
- Audit: Dedicated middleware (`server/src/middleware/audit.ts`) logs all authenticated queries with user + endpoint

**Validation:**
- Frontend: Zod schemas for user input (filters, file uploads)
- Backend: Schema validation at route entry, DuckDB type conversion
- Parquet loading: Schema contract pattern - unknown fields cause `sys.exit(1)` in ETL

**Authentication:**
- JWT tokens signed with `process.env.JWT_SECRET`
- Token expiry: 1 day (configurable)
- Session recovery: JWT read from sessionStorage on frontend init
- Role-based access control: 3 levels (branch_admin > regional_manager > salesman)

**Security:**
- SQL injection: Parameterized queries, table name sanitization
- XSS: No hardcoded HTML, CSP headers configured
- CSRF: SameSite=Strict cookies (not explicitly set, relies on JWT)
- Rate limiting: 3-tier (general 100/min, login 5/min, query 30/min, AI 10/min)
- Secrets: All API keys in environment variables, never committed

**Performance Optimization:**
- **Static snapshots**: 9 high-frequency bundles pre-computed daily
- **Service Worker**: Stale-while-revalidate strategy, 0ms cached responses
- **DuckDB**: Materialized PolicyFact (pre-indexed), connection pooling (max 10), Parquet fingerprinting for change detection
- **Query caching**: Optional result cache with configurable TTL
- **HTTP compression**: gzip enabled for >1KB responses
- **Lazy loading**: Page components loaded on-demand (React.lazy + Suspense)

---

*Architecture analysis: 2026-04-12*
