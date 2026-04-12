# Coding Conventions

**Analysis Date:** 2026-04-12

## Naming Patterns

**Files:**
- TypeScript: `camelCase` for filenames (e.g., `alertChecker.ts`, `duckdb.ts`, `formatters.ts`)
- Test files: `*.test.ts` or `*.test.tsx` co-located with source or in `__tests__` directories
- Routes: `kebab-case` subdirectories under `server/src/routes/query/` (e.g., `query/kpi.ts`, `query/cross-sell.ts`)
- Component files: `PascalCase.tsx` (e.g., `Card.tsx`, `Button.tsx`)
- Utilities/services: `camelCase.ts` with clear purpose in name (e.g., `duckdb-infra.ts`, `snapshot-serve.ts`)

**Functions:**
- `camelCase` for all functions: `checkGrowthDecline()`, `formatPremiumWan()`, `asyncHandler()`
- Async functions clearly named with responsibility: `waitForBackendReady()`, `ensureDataLoaded()`
- Handler functions: `{verb}Handler()` pattern (e.g., `errorHandler()`, `notFoundHandler()`, `asyncHandler()`)

**Variables:**
- `camelCase` for local variables and parameters
- `UPPER_SNAKE_CASE` for constants (e.g., `MAX_FILE_SIZE`, `SECURITY_LIMITS`, `SLOW_QUERY_THRESHOLD_MS`)
- Private class properties prefixed with underscore: `private instance: DuckDBInstance | null = null`
- Maps and collections: descriptive names reflecting contents (e.g., `parquetFingerprintCache`, `inflightControllers`, `fileMtimes`)

**Types:**
- PascalCase for interfaces, types, and classes
- Prefixed descriptively: `DuckDBServiceConfig`, `AlertCheckData`, `ParquetCacheEntry`
- Generic types: `T`, `K`, `V` for standard patterns; more descriptive when needed (e.g., `DuckDBQueryable`)

## Code Style

**Formatting:**
- No explicit linting config found (`.eslintrc*`, `.prettierrc*` absent from root)
- **De facto standard observed**: 2-space indentation, semicolons required
- Line length: ~80-100 characters (observed in conditionals and function signatures)
- JSDoc comments on public functions and classes with `@param`, `@returns`, `@example` tags

**Linting:**
- TypeScript strict mode enabled (implied by `tsconfig.json: "strict": true`)
- Type annotations required on function parameters and return types: `function formatCount(value: number | bigint | null | undefined): string`
- No implicit `any` allowed (strict TypeScript enforcement)

## Import Organization

**Order:**
1. External dependencies (npm packages): `import { Router } from 'express'`
2. TypeScript type imports (with `type` keyword): `import type { DuckDBConnection } from '@duckdb/node-api'`
3. Relative imports from project structure (with `.js` extension required for ESM): `import { databaseConfig } from '../config/database.js'`
4. Aliases (`@` and `@server`): Defined in `vite.config.ts` and `vitest.integration.config.ts`

**Path Aliases:**
- `@` → `src/` (frontend)
- `@server` → `server/src/` (backend, in test config)
- API routes centralized in `src/shared/api/routes.ts` and `src/shared/api/client.ts`

**ESM Requirements:**
- All relative imports must include `.js` extension: `import { something } from './file.js'`
- No `__dirname` — use `fileURLToPath(import.meta.url)` instead
- Use `import.meta.env` for environment variables (Vite): `import.meta.env.MODE`, `import.meta.env.VITE_API_BASE`

## Error Handling

**Patterns:**
- Custom `AppError` class in `server/src/middleware/error.ts` with `statusCode`, `message`, `isOperational` properties
- Throw with descriptive messages: `throw new AppError(400, 'Invalid input')`
- Async route wrapper `asyncHandler()` catches Promise rejections and passes to error middleware
- Frontend: throw `Error` with user-friendly message, caught by error boundaries

**Error Response Format:**
```typescript
{
  success: false,
  error: {
    message: string,        // User-facing message
    statusCode: number
  }
}
```

**Production vs Development:**
- Production: generic "Internal Server Error" (no stack trace leak)
- Development: full error message from caught exception
- Backend logging: only error name and message via `console.error()` (no raw stack traces)

## Logging

**Framework:** `Logger` class in `src/shared/utils/logger.ts` (not `console.log` directly)

**Patterns:**
- Instantiate with context: `new Logger('ComponentName')`
- Level-based filtering: `debug`, `info`, `warn`, `error`, `none`
- Production default: `warn` level; development default: `debug` level
- Methods: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
- Test setup (`tests/setup.ts`) sets logger to `warn` to reduce noise

**Configuration:**
```typescript
const logger = new Logger('MyModule', { level: 'debug', enableStackTrace: true });
logger.info('Operation started');
```

## Comments

**When to Comment:**
- Complex business logic or algorithm: explain the "why", not the "what"
- Type hints for non-obvious data structures: `// { days: N } from DuckDB DATE serialization`
- Security-related code: explicitly document threat being mitigated
- Workarounds or hacks: mark with `// HACK:` or `// TODO:` with explanation
- Public API: JSDoc with `@param`, `@returns`, `@example` required

**JSDoc/TSDoc:**
- Used extensively on exported functions and classes
- Format: `@param name - description`, `@returns description`, `@example code snippet`
- Example from codebase: `formatPremiumWan(value: number | bigint | null | undefined): string` includes example usage

## Function Design

**Size:** 
- Preferred: <50 lines per function
- Observed: Small utility functions (10-30 lines) and handler functions (20-40 lines)
- Large files broken into smaller focused modules (e.g., `duckdb.ts` delegates to `duckdb-infra.ts`, `duckdb-materialization.ts`, `duckdb-domain-loaders.ts`)

**Parameters:** 
- Explicit over variadic: named parameters preferred
- Use object destructuring for multiple parameters: `function createService({ path, maxConnections }: DuckDBServiceConfig)`
- Type all parameters strictly

**Return Values:** 
- Explicit return types required in all function signatures
- Nullable returns annotated: `Promise<T | null>`, `Result | undefined`
- Never return bare `undefined` without type annotation

## Module Design

**Exports:**
- Named exports preferred: `export function checkGrowthDecline()` allows tree-shaking
- Default exports used only for classes: `export default new ApiClient()`
- Re-export types explicitly: `export type { AlertRule, TargetProgress }`

**Barrel Files:**
- Used at layer boundaries: `src/shared/types/index.ts` exports all type definitions
- Simplifies consumer imports: `import { KpiData } from '@/shared/types'`
- One-level barrel recommended; avoid deep nesting

**Immutability:**
- Spread operator for object updates: `{ ...user, name: newName }` not `user.name = newName`
- Array immutability: `[...array, newItem]` instead of `.push()`
- Observed in Redux-style state patterns and React hooks

## API Response Format

**Standard Envelope:**
```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}
```

**Usage in `src/shared/api/client.ts`:**
- All responses wrapped in `ApiResponse<T>`
- `data` field contains payload (nullable on error)
- `error` field contains error message (nullable on success)
- `meta` included for paginated endpoints

## Frontend-Specific

**Component Naming:**
- Functional components: `PascalCase.tsx`
- Props interfaces: `{ComponentName}Props`
- Custom hooks: `use{Capability}` (e.g., `useRenewalV2`)

**Styling:**
- All hardcoded colors/styles forbidden; use design system from `src/shared/styles/index.ts`
- Available: `colorClasses`, `tableStyles`, `textStyles`, `fontStyles`, `cardStyles`
- No inline `className="text-red-500 dark:text-red-700"` — use `colorClasses.text.danger` instead
- Numeric columns in tables: `className={fontStyles.numeric}` for right-alignment

**Formatting in UI:**
- Use shared formatters from `src/shared/utils/formatters.ts`:
  - `formatCount()` —件数 with thousand separators
  - `formatPremiumWan()` — 保费 in units of 万 (ten thousand)
  - `formatPercent()` — percentages with 1 decimal + %
  - `formatCoefficient()` — 4-decimal precision coefficients
  - `formatChartValue()` — pure number for chart labels
- Never hardcode `.toFixed(2).toLocaleString()`

## Backend-Specific

**DuckDB Integration:**
- All queries go through `DuckDBService` singleton: `server/src/services/duckdb.ts`
- Query execution: `await duckdbService.query(sql, params)`
- DATE type returns as `{ days: N }` object — must deserialize to ISO string in `convertBigIntToNumber()`
- TIMESTAMP type returns as `{ micros: N }` — must deserialize to ISO string
- All DuckDB operations behind `DuckDBQueryable` interface for testability

**SQL Generation:**
- Dynamic SQL: use parameterization where possible
- Table/column names: sanitize with `sanitizeTableName()` from `server/src/utils/security.ts`
- SQL strings: use template literals with explicit variable injection (not user input directly)

**Middleware Chain:**
Express middleware stacking in `server/src/routes/query.ts`:
1. `authMiddleware` — verify JWT token
2. `permissionMiddleware` — inject row-level WHERE clause
3. `snapshotServe` — check static snapshot cache first
4. Sub-routes (`kpi`, `trend`, `cross-sell`, etc.) — execute query

---

*Convention analysis: 2026-04-12*
