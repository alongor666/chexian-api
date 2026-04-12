# Codebase Structure

**Analysis Date:** 2026-04-12

## Directory Layout

```
chexian-api/
├── src/                           # Frontend source code (React + TypeScript)
│   ├── app/
│   │   ├── App.tsx               # Main entry point, routing setup, providers
│   │   ├── Layout.tsx            # Root layout wrapper
│   │   └── routes/               # Route definitions (if any)
│   ├── features/                 # Feature modules (by business domain)
│   │   ├── pages/                # Page components (20+ pages)
│   │   │   ├── PremiumDashboardPage.tsx
│   │   │   ├── PerformanceAnalysisPage.tsx
│   │   │   ├── GrowthPage.tsx
│   │   │   ├── CostPage.tsx
│   │   │   ├── FeeAnalysisPage.tsx
│   │   │   ├── RenewalAnalysisPage.tsx
│   │   │   ├── ClaimsDetailPage.tsx
│   │   │   └── ...
│   │   ├── dashboard/            # Dashboard feature (KPI panels, bundles)
│   │   ├── growth/               # Growth analysis feature
│   │   ├── cost/                 # Cost analysis feature
│   │   ├── fee-analysis/         # Fee analysis (access-controlled)
│   │   ├── renewal-v2/           # Renewal analysis (v2 architecture)
│   │   ├── claims-detail/        # Claims detail reporting
│   │   ├── cross-sell/           # Cross-sell analysis
│   │   ├── quote-conversion/     # Quote conversion funnel
│   │   ├── quote-timeline/       # Quote timeline view
│   │   ├── performance/          # Performance analysis
│   │   ├── coefficient/          # Pricing coefficient analysis
│   │   ├── auth/                 # Login, logout, auth state
│   │   ├── filters/              # Filter UI components and state
│   │   ├── file/                 # File upload/import
│   │   └── ...
│   ├── shared/                   # Shared modules across features
│   │   ├── api/
│   │   │   ├── client.ts         # API client class (all endpoints)
│   │   │   ├── types.ts          # API response types
│   │   │   └── routes.ts         # Route constants (QUERY_ROUTES, DATA_ROUTES, etc.)
│   │   ├── contexts/
│   │   │   ├── DataContext.tsx   # Data loading state (API mode only)
│   │   │   ├── FilterContext.tsx # Filter state (global mutable)
│   │   │   ├── PermissionContext.tsx # User role and access level
│   │   │   └── ...
│   │   ├── hooks/                # Custom React hooks (useQuery, useFilter, etc.)
│   │   ├── components/           # Shared UI components (DataGuard, ErrorBoundary)
│   │   ├── ui/                   # Shadcn/custom UI primitives (Card, Button, etc.)
│   │   ├── styles/               # Design system (colors, typography, layout)
│   │   │   └── index.ts          # Centralized style exports (DO NOT hardcode Tailwind)
│   │   ├── types/                # TypeScript type definitions (shared across app)
│   │   ├── utils/                # Utilities (formatters, validators, helpers)
│   │   ├── config/               # Configuration (customers categories, organizations)
│   │   ├── export/               # Export to Excel/PDF functionality
│   │   ├── theme/                # Theme provider (light/dark mode)
│   │   ├── json-render/          # JSON-to-React rendering for dynamic UI
│   │   ├── ai-insights/          # AI-powered analysis and insights
│   │   └── INDEX.md              # Shared module inventory
│   ├── widgets/                  # Reusable widget components (tables, charts, cards)
│   │   ├── table/
│   │   ├── chart/
│   │   ├── INDEX.md              # Widget inventory
│   │   └── ...
│   ├── components/               # App-level layout components
│   │   └── layout/               # SidebarLayout, DataGuard, ErrorBoundary
│   ├── charts/                   # Chart utility functions (ECharts wrappers)
│   ├── core/                     # Core utilities (request context, etc.)
│   ├── services/                 # Frontend services (localStorage, etc.)
│   ├── types/                    # Global type definitions
│   ├── vite-env.d.ts            # Vite environment variables typing
│   └── shims/                    # Polyfills/compatibility shims
│
├── server/                       # Backend API server (Express + DuckDB)
│   ├── src/
│   │   ├── app.ts               # Express app entry point, middleware chain
│   │   ├── config/              # Configuration files
│   │   │   ├── env.ts           # Environment variable loading (serverEnv, dbEnv)
│   │   │   ├── database.ts      # DuckDB configuration
│   │   │   ├── cors.ts          # CORS configuration
│   │   │   ├── paths.ts         # Path constants (Parquet dirs, snapshot dirs)
│   │   │   ├── metric-registry/ # L1-L3 metric definitions (25 metrics)
│   │   │   ├── field-registry/  # Field definitions (42 fields, auto-codegen)
│   │   │   ├── capability-registry.ts # AI capability mappings
│   │   │   ├── preset-users.ts  # Hardcoded user credentials (for testing)
│   │   │   ├── organizations.ts # Organization hierarchy and access control
│   │   │   ├── customer-categories.ts # 11 customer type enumerations
│   │   │   └── api-routes.ts    # API route constants
│   │   ├── middleware/          # Express middleware (auth, permission, snapshot, etc.)
│   │   │   ├── auth.ts          # JWT validation middleware
│   │   │   ├── permission.ts    # Role-based permission filtering (SQL WHERE generation)
│   │   │   ├── snapshot-serve.ts # Static snapshot caching layer
│   │   │   ├── audit.ts         # Query audit logging
│   │   │   ├── rateLimiter.ts   # 3-tier rate limiting
│   │   │   └── error.ts         # Global error handling and AppError class
│   │   ├── routes/              # REST API routes
│   │   │   ├── query.ts         # Main aggregator (65 lines), mounts all subroutes
│   │   │   ├── query/           # 19 query subroutes (KPI, Trend, Growth, etc.)
│   │   │   │   ├── kpi.ts
│   │   │   │   ├── trend.ts
│   │   │   │   ├── growth.ts
│   │   │   │   ├── cost.ts
│   │   │   │   ├── cross-sell.ts
│   │   │   │   ├── performance.ts
│   │   │   │   ├── coefficient.ts
│   │   │   │   ├── claims-detail.ts
│   │   │   │   ├── renewal-v2.ts
│   │   │   │   ├── quote-conversion.ts
│   │   │   │   ├── premium-plan.ts
│   │   │   │   ├── comprehensive.ts
│   │   │   │   ├── bundles.ts   # Aggregated multi-endpoint responses
│   │   │   │   ├── customer-flow.ts
│   │   │   │   ├── patrol.ts
│   │   │   │   ├── shared.ts    # Shared utilities (buildRouteCacheKey, etc.)
│   │   │   │   └── ...
│   │   │   ├── auth.ts          # POST /api/auth/login, /logout
│   │   │   ├── wecom-auth.ts    # WeChat Work OAuth
│   │   │   ├── data.ts          # GET /api/data/files, POST /upload, version check
│   │   │   ├── ai.ts            # POST /api/ai/* (NL2SQL, requirement detection)
│   │   │   └── filters.ts       # GET /api/filters/options (dimension options)
│   │   ├── services/            # Core business logic and data access
│   │   │   ├── duckdb.ts        # Main DuckDB service (query execution, caching)
│   │   │   ├── duckdb-infra.ts  # Connection pool, query cache
│   │   │   ├── duckdb-types.ts  # DuckDBQueryable interface for testability
│   │   │   ├── duckdb-materialization.ts # Batch materialization, VIEW/TABLE creation
│   │   │   ├── duckdb-domain-loaders.ts # Domain-specific data loading (8 domains)
│   │   │   ├── data-bootstrapper.ts # Startup sequence (Parquet discovery, dedup, materialize)
│   │   │   ├── auth.ts          # JWT token creation/validation, bcrypt
│   │   │   ├── access-control.ts # RBAC setup, permission data seeding
│   │   │   ├── requirement-detector.ts # NL2SQL requirement parsing
│   │   │   ├── cache-warmer.ts  # Proactive cache warming before deploy
│   │   │   ├── column-normalizer.ts # Data type normalization (DATE, TIMESTAMP, BOOLEAN)
│   │   │   ├── route-cache.ts   # Route-level result caching with TTL
│   │   │   ├── zhipu.ts         # Zhipu AI API integration (GLM-4 model)
│   │   │   ├── openrouter.ts    # OpenRouter API fallback
│   │   │   ├── wecom.ts         # WeChat Work API integration
│   │   │   └── notify.ts        # Notification service stub
│   │   ├── sql/                 # SQL generation layer (30 modules)
│   │   │   ├── kpi.ts           # KPI metrics query builder
│   │   │   ├── trend.ts         # Time-series trend queries
│   │   │   ├── growth.ts        # Growth analysis queries
│   │   │   ├── cost.ts          # Cost analysis (modular cost/ subdirectory)
│   │   │   │   └── cost/        # Cost sub-generators (fixed-cost, variable, etc.)
│   │   │   ├── cross-sell*.ts   # 5 cross-sell related generators
│   │   │   ├── performance*.ts  # 2 performance analysis generators
│   │   │   ├── coefficient.ts   # Pricing coefficient analysis
│   │   │   ├── claims-detail.ts # Claims detail aggregation
│   │   │   ├── renewal-universe.ts # Renewal cohort analysis
│   │   │   ├── quote-conversion.ts # Quote-to-policy conversion funnel
│   │   │   ├── premiumPlan.ts   # Plan achievement tracking
│   │   │   ├── sql-builder.ts   # Common SQL clause builders (org filter, date range, etc.)
│   │   │   ├── perspective-adapter.ts # GROUP BY perspective switching
│   │   │   ├── customer-flow.ts # Customer inflow/outflow
│   │   │   ├── repair.ts        # Repair resource analysis
│   │   │   ├── expense-development.ts # Expense development triangles
│   │   │   ├── INDEX.md         # SQL module inventory and matrix
│   │   │   └── __tests__/       # SQL unit tests
│   │   ├── types/               # TypeScript type definitions (backend-specific)
│   │   │   ├── api.ts           # API request/response types
│   │   │   ├── filters.ts       # Filter type definitions
│   │   │   ├── database.ts      # Database schema types (PolicyFact, ClaimsDetail, etc.)
│   │   │   └── ...
│   │   ├── utils/               # Utility functions
│   │   │   ├── security.ts      # SQL injection prevention (sanitizeTableName, escapeSqlValue)
│   │   │   ├── logger.ts        # Logging utility
│   │   │   ├── request-context.ts # Request tracing and metrics
│   │   │   ├── parquet-source.ts # Parquet file detection
│   │   │   └── ...
│   │   └── normalize/           # Data normalization and mapping
│   │       ├── mapping.ts       # Column name mappings (CN → EN, auto-codegen)
│   │       └── validator.ts     # Schema validation (auto-codegen)
│   └── tsconfig.json            # TypeScript config for server
│
├── tests/                        # Test suite
│   ├── unit/                    # Unit tests (component, utility, pure function tests)
│   ├── integration/             # Integration tests (DuckDB queries, API endpoints)
│   ├── e2e/                     # End-to-end tests (Playwright, critical user flows)
│   ├── mocks/                   # Mock implementations (DuckDB client, API responses)
│   ├── fixtures/                # Test data fixtures (sample Parquet, credentials)
│   ├── config/                  # Test configuration files
│   └── __snapshots__/           # Vitest snapshot files
│
├── 数据管理/                      # Data ETL and management (Python/Node.js)
│   ├── daily.mjs                # Main ETL entry point (daily refresh)
│   ├── data-sources.json        # Data domain metadata registry
│   ├── warehouse/               # Data warehouse structure
│   │   ├── fact/                # Fact tables (Parquet)
│   │   │   ├── policy/
│   │   │   │   └── current/     # Current data (4 shards: Parquet)
│   │   │   ├── claims/
│   │   │   └── quotes/
│   │   ├── dim/                 # Dimension tables (auto-generated Parquet)
│   │   │   ├── salesman/
│   │   │   ├── plan/
│   │   │   └── brand/
│   │   ├── snapshots/           # Static query snapshots (pre-computed JSON)
│   │   │   └── {bundle}/{scope}/{paramHash}.json
│   │   ├── renewal/             # Renewal cohort data
│   │   └── etl/                 # ETL scripts and pipelines
│   ├── knowledge/               # Documentation and business rules
│   │   ├── rules/
│   │   │   └── 车险数据业务规则字典.md # Authoritative business rules
│   │   ├── ai/                  # AI knowledge (ETL, schema, data flow)
│   │   ├── PARQUET_SCHEMA_KNOWLEDGE.md # Field definitions
│   │   ├── QUICK_REFERENCE.md   # Quick lookup guide
│   │   └── ...
│   └── data-analysis报告/        # Analysis output reports
│
├── 开发文档/                      # Development documentation
│   ├── 00_index/
│   │   ├── DOC_INDEX.md         # Documentation index
│   │   ├── CODE_INDEX.md        # Code module reference
│   │   ├── DATA_INDEX.md        # Data domain reference
│   │   └── PROGRESS_INDEX.md    # Project progress tracking
│   ├── 架构设计/
│   │   ├── TECH_STACK.md        # Technology stack overview
│   │   ├── ARCHITECTURE.md      # System architecture
│   │   └── ...
│   ├── DEVELOPER_CONVENTIONS.md # Code style guide (DC-001, DC-002, DC-003)
│   ├── 指标字典.md              # Metric definitions (auto-generated)
│   ├── 缺口清单.md              # Known information gaps
│   └── QUICK_REFERENCE.md       # Quick reference guide
│
├── deploy/                      # Deployment configurations
│   ├── vps-wrapper/            # VPS deployment wrapper scripts
│   ├── windows/                # Windows desktop deployment
│   └── ecosystem.config.cjs    # PM2 process manager config
│
├── scripts/                     # Utility scripts
│   ├── start.mjs               # Unified startup orchestrator
│   ├── build-snapshots.mjs     # Pre-compute static snapshots
│   ├── check-governance.mjs    # Validation checks (contracts, consistency)
│   ├── verify-cross-sell.py    # Cross-sell analysis verification
│   ├── benchmark-key-routes.mjs # Performance benchmarking
│   └── ...
│
├── public/                      # Static assets
│   ├── sw.js                    # Service Worker (stale-while-revalidate caching)
│   └── ...
│
├── dist/                        # Build output (compiled frontend + assets)
├── node_modules/               # Dependencies (Bun-managed)
│
├── ARCHITECTURE.md             # System architecture guide
├── CLAUDE.md                   # AI collaboration guide (RED LINES, rules)
├── DESIGN.md                   # Design system specifications
├── BACKLOG.md                  # Feature backlog and known issues
├── PROGRESS.md                 # Project progress and milestones
├── package.json                # Bun package manifest (not npm)
├── bun.lock                    # Dependency lock file
├── tsconfig.json              # Root TypeScript config
├── vite.config.ts             # Vite build configuration (frontend)
├── vitest.config.ts           # Vitest unit test config
├── vitest.integration.config.ts # Vitest integration test config
├── playwright.config.ts       # Playwright E2E test config
├── tailwind.config.ts         # Tailwind CSS configuration
├── postcss.config.js          # PostCSS plugins
├── .env.example               # Environment variable template
├── .env.production            # Production env (VPS)
├── .github/workflows/         # GitHub Actions CI/CD
└── README.md                  # Project overview
```

## Directory Purposes

**src/features/pages/:**
- Purpose: Page-level components that render complete views with routing
- Contains: 20+ page components, each corresponding to a main application route
- Pattern: Page = feature module layout + data fetching + child components
- Key pages: PremiumDashboardPage, PerformanceAnalysisPage, GrowthPage, RenewalAnalysisPage, ClaimsDetailPage

**src/shared/api/:**
- Purpose: API client and type definitions - single source of truth for backend communication
- Contains: `client.ts` (ApiClient class with request queuing, timeout, merge), `routes.ts` (endpoint constants), `types.ts` (response types)
- Usage: All page components import `apiClient` and call methods to fetch data
- Key methods: `getKpi()`, `getTrend()`, `getPerformanceBundle()`, `login()`, `uploadFile()`

**src/shared/styles/:**
- Purpose: Design system tokens and utilities - **MUST be used, NOT hardcoded Tailwind**
- Contains: `colorClasses`, `tableStyles`, `textStyles`, `buttonStyles`, `fontStyles`, `cardStyles`
- Rule: Zero hardcoded `text-red-500`, `bg-blue-600` etc. in code - use exported classes
- Critical: Dark mode compatibility through CSS variables

**server/src/routes/query/:**
- Purpose: Business endpoint aggregators - each file handles one logical domain
- Pattern: Route file imports SQL generator → DuckDB service → constructs response
- 19 files: kpi, trend, growth, cost, cross-sell (multiple), coefficient, performance (multiple), claims-detail, renewal-v2, quote-conversion, premium-plan, comprehensive, bundles, customer-flow, patrol, repair, expense-development, salesman
- Each exports Router with specific endpoints (e.g., `kpi.ts` exports GET /api/query/kpi with ?filters)

**server/src/sql/:**
- Purpose: SQL generation logic - encapsulates DuckDB queries for each business domain
- Pattern: Each module exports `generate*Sql(filters, permissionFilter): string`
- 30 files total: 27 generators + 3 shared utilities (sql-builder, perspective-adapter, INDEX)
- Reuse: sql-builder provides common patterns (buildOrgFilter, buildDateRangeFilter, buildCustomerCategoryFilter)

**server/src/config/metric-registry/:**
- Purpose: **Single authoritative source** for metric definitions (L1-L3 metrics)
- Contains: 25 metric definitions with id, name, formula, SQL expression, test cases, changelog
- Codegen: Auto-generates `metrics.ts` (frontend import) from this registry
- Rule: All new metrics must be added here first, never hardcoded elsewhere

**server/src/config/field-registry/:**
- Purpose: **Single authoritative source** for field definitions (42 fields across all domains)
- Contains: `fields.json` (master definitions) → codegen produces `mapping.ts`, `validator.ts`, `etl_fields.json`
- Rule: Only edit `fields.json`, auto-generated files are READ-ONLY

**数据管理/warehouse/snapshots/:**
- Purpose: Pre-computed static query responses for fastest cache hits
- Structure: `{bundle}/{scope}/{paramHash}.json` where paramHash = SHA256(sorted query params)
- Built by: `node scripts/build-snapshots.mjs` (reads live DuckDB, writes JSON files)
- Scopes: "all" (admin), "org_level_3_name" (regional), "telemarketing", etc.

**tests/integration/:**
- Purpose: DuckDB query tests, API endpoint tests that need real/mock database
- Pattern: Spin up :memory: DuckDB, load fixture Parquet, execute query, assert results
- Excluded from CI: Native .node modules (DuckDB) don't work in jsdom CI environment
- Run locally: `bun run test:integration`

## Key File Locations

**Entry Points:**

- `src/app/App.tsx`: React app entry point - routes, providers, lazy-loaded pages
- `server/src/app.ts`: Express server entry point - middleware chain, DuckDB init, data bootstrap
- `数据管理/daily.mjs`: Data ETL entry point - discover, deduplicate, load, materialize, sync

**Configuration:**

- `server/src/config/env.ts`: Environment variable loading (serverEnv, dbEnv)
- `server/src/config/paths.ts`: Path constants (Parquet dirs, snapshot dirs, database path)
- `server/src/config/organizations.ts`: Org hierarchy, user credentials (testing), permission matrix
- `tailwind.config.ts`: Tailwind CSS configuration (dark mode setup, theme colors)

**Core Logic:**

- `server/src/services/duckdb.ts`: DuckDB query executor (main service)
- `server/src/sql/sql-builder.ts`: Common SQL patterns (filters, date ranges, grouping)
- `server/src/routes/query.ts`: Query route aggregator (65 lines, mounts all subroutes)
- `src/shared/api/client.ts`: Frontend API client (all HTTP calls)

**Testing:**

- `tests/integration/critical-path.test.ts`: Core functionality end-to-end tests
- `tests/e2e/01-auth.spec.ts`: Login flow validation (Playwright)
- `tests/fixtures/`: Sample Parquet files, mock API responses
- `vitest.config.ts`: Unit test runner configuration
- `playwright.config.ts`: E2E test runner configuration

## Naming Conventions

**Files:**

- TypeScript sources: `camelCase.ts` or `kebab-case.ts` for multi-word (e.g., `snapshot-serve.ts`, `duckdb.ts`)
- React components: `PascalCase.tsx` (e.g., `PerformanceAnalysisPage.tsx`)
- Configuration: `kebab-case.ts` (e.g., `database.ts`, `api-routes.ts`)
- SQL generators: `noun.ts` or `noun-verb.ts` (e.g., `kpi.ts`, `cross-sell-trend.ts`)
- Test files: `{name}.test.ts` or `{name}.spec.ts` (e.g., `kpi-detail-sql.test.ts`)

**Directories:**

- Feature modules: `kebab-case/` (e.g., `fee-analysis/`, `renewal-v2/`)
- Logical groupings: `camelCase/` (e.g., `src/features/`, `server/src/services/`)
- Data domains: Chinese descriptive names (e.g., `数据管理/`, `开发文档/`)

**Functions/Variables:**

- Route handlers: `camelCase` (e.g., `getKpiRoute()`, `handleLogin()`)
- SQL generators: `generate*Sql()` (e.g., `generateKpiSql()`, `generateCrosseSellSql()`)
- Utilities: `camelCase` (e.g., `formatCount()`, `buildOrgFilter()`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `SNAPSHOT_BUNDLES`, `SLOW_QUERY_THRESHOLD_MS`)

**Routes:**

- Query endpoints: `/api/query/{domain}` (e.g., `/api/query/kpi`, `/api/query/cross-sell`)
- Bundle endpoints: `/api/query/{domain}-bundle` (e.g., `/api/query/dashboard-bundle`)
- Data endpoints: `/api/data/{action}` (e.g., `/api/data/files`, `/api/data/upload`)
- Auth endpoints: `/api/auth/{action}` (e.g., `/api/auth/login`, `/api/auth/logout`)

## Where to Add New Code

**New Feature (page + API):**

1. Create `src/features/{feature-name}/` directory
2. Add `src/features/{feature-name}/pages/{FeaturePage}.tsx`
3. Create `src/features/{feature-name}/hooks/` for custom hooks
4. Create `src/features/{feature-name}/components/` for feature-specific components
5. Add `server/src/routes/query/{feature-name}.ts` route file
6. Add `server/src/sql/{feature-name}.ts` SQL generator
7. Update `src/features/INDEX.md` and `server/src/sql/INDEX.md`
8. Update routing in `src/app/App.tsx`

**New UI Component (shared):**

1. Create `src/shared/ui/{ComponentName}.tsx`
2. Update `src/shared/styles/index.ts` if adding style presets
3. Document in `src/shared/INDEX.md`

**New Shared Utility Function:**

1. Add to `src/shared/utils/{category}.ts` (e.g., `formatters.ts`, `validators.ts`)
2. Export from `src/shared/utils/index.ts` (barrel export)
3. Import and use across app

**New API Route:**

1. Create `server/src/routes/{feature}.ts` 
2. Import and mount in `server/src/routes/query.ts` (if query route) or `server/src/app.ts` (if other)
3. Use existing SQL generators or create new ones in `server/src/sql/`

**New SQL Query:**

1. Create/extend `server/src/sql/{domain}.ts` with `generate*Sql()` function
2. Call from route handler: `const sql = generateKpiSql(filters, req.permissionFilter)`
3. Execute: `const result = await duckdbService.query(sql)`
4. Return with proper response envelope

**New Type Definition:**

1. If backend: Add to `server/src/types/{category}.ts`
2. If frontend: Add to `src/shared/types/{category}.ts`
3. Export from category's `index.ts` barrel file
4. Avoid duplication - check existing types first via `grep -r`

## Special Directories

**数据管理/warehouse/:**
- Purpose: Local data warehouse - source of truth during development
- Generated: Parquet files from ETL (policy, claims, quotes, dimensions)
- Committed: No - `.gitignore` excludes `warehouse/fact/`, `warehouse/dim/`, `warehouse/snapshots/`
- Synced: `node scripts/sync-vps.mjs` pushes to VPS `/var/www/chexian/data/`

**server/src/sql/__tests__/:**
- Purpose: Unit tests for SQL generators
- Pattern: Mock DuckDB, test SQL syntax and result structure
- Excluded from CI: Some tests use native DuckDB binary, must run locally

**tests/e2e/:**
- Purpose: End-to-end Playwright tests simulating real user workflows
- Requires: Running server (`bun run dev:full`), real/mock database, test credentials
- Key files: 01-auth.spec.ts (login), 02-flows.spec.ts (feature paths), 03-cleanup.spec.ts (data teardown)

**deploy/:**
- Purpose: Production deployment configurations
- VPS wrapper: Automatic restart on failure, health checks, log rotation
- PM2 config: `ecosystem.config.cjs` - process name, environment, restart policy

---

*Structure analysis: 2026-04-12*
