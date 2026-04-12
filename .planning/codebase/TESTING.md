# Testing Patterns

**Analysis Date:** 2026-04-12

## Test Framework

**Runner:**
- Vitest 2.1.9 with Vite 5.4.21
- Config: `vite.config.ts` (main test config) + `vitest.integration.config.ts` (DuckDB native tests)

**Assertion Library:**
- `expect()` from Vitest (ESM-based, Jest-compatible API)

**Run Commands:**
```bash
bun run test                    # Run all tests (jsdom environment)
bun run test --watch           # Watch mode for development
bun run test:coverage          # Coverage report (v8 provider)
bun run test:integration       # Integration tests (node environment, DuckDB native)
bun run test:e2e               # E2E tests with Playwright
bun run test:preflight         # Pre-flight health checks
```

## Test File Organization

**Location:**
- **Unit tests**: Co-located with source (same directory structure as production code)
  - Backend: `server/src/services/__tests__/*.test.ts`
  - Frontend utilities: `src/shared/utils/__tests__/*.test.ts`
  - Frontend hooks: `src/shared/ai-insights/__tests__/*.test.ts`
- **Integration tests**: `tests/integration/*.test.ts` or `tests/*.test.ts`
- **E2E tests**: `tests/e2e/*.spec.ts`
- **Fixtures**: Inline in test files or `tests/fixtures/` (no separate factory pattern)

**Naming:**
- Test file: `{name}.test.ts` (default Vitest pattern)
- E2E tests: `{number}-{description}.spec.ts` (Playwright convention)

**Structure:**
```
tests/
├── setup.ts                      # Global test environment config
├── e2e/
│   ├── 01-dashboard-flow.spec.ts
│   ├── 02-filter-sql.spec.ts
│   ├── auth.setup.ts             # Playwright authentication fixture
│   ├── helpers/
│   │   ├── session.ts            # Login, backend readiness helpers
│   │   ├── credentials.ts        # E2E credentials constants
│   │   └── page-shell.ts         # UI interaction helpers
│   └── verify-org-permissions.spec.ts
├── integration/
│   └── critical-path.test.ts     # Core business logic integration
├── alert-checker.test.ts
├── security.test.ts
├── kpi-detail-sql.test.ts
└── [64 more unit test files]

server/src/
├── services/
│   └── __tests__/
│       ├── duckdb-*.test.ts      # DuckDB native tests (integration only)
│       └── [other service tests]
└── utils/
    └── __tests__/
        └── [utility function tests]
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('PreAlert Detector', () => {
  describe('checkGrowthDecline - 增长率下降检测', () => {
    it('should detect critical decline (-20% or below)', () => {
      const result = checkGrowthDecline(80, 100, '机构A');
      expect(result).not.toBeNull();
      expect(result?.level).toBe('critical');
    });

    it('should return null for normal growth', () => {
      const result = checkGrowthDecline(120, 100, '机构D');
      expect(result).toBeNull();
    });
  });
});
```

**Patterns Observed:**
- **Setup**: `beforeEach()` to initialize mocks and clear state
- **Cleanup**: `afterEach()` to restore mocks and clean up resources
- **Assertions**: Multiple assertions per test when testing related conditions
- **Nested describes**: Logical grouping by functionality (e.g., by method name)

## Mocking

**Framework:** Vitest's `vi` mock API (compatible with Jest)

**Patterns:**
```typescript
// Mock environment variable
vi.stubEnv('VITE_API_KEY', 'test-key');

// Mock module
vi.mock('../insight-generator', () => ({
  generateInsights: vi.fn().mockResolvedValue({ success: false })
}));

// Mock API responses
const mockFetch = vi.fn(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ data: [...] })
}));

// Spy on method
const spy = vi.spyOn(logger, 'info');
expect(spy).toHaveBeenCalledWith('message');

// Clear mocks
vi.clearAllMocks();  // in beforeEach()
vi.restoreAllMocks(); // in afterEach()
```

**What to Mock:**
- External APIs: `fetch()`, HTTP requests
- Environment variables: `process.env.*`, `import.meta.env.*`
- Date/time: `new Date()` or `vi.useFakeTimers()`
- Random functions: use deterministic test data instead

**What NOT to Mock:**
- Business logic functions (test the real implementation)
- Data structures and validators
- Pure utility functions (formatters, validators)
- Database/DuckDB layer (use in-memory `:memory:` for integration tests)

## Fixtures and Factories

**Test Data:**
```typescript
const mockContext: RenewalDataContext = {
  type: 'renewal',
  kpi: {
    dueCount: 1000,
    renewedCount: 750,
    quotedCount: 850,
    duePremium: 5000000,
    renewedPremium: 3750000,
    quotedPremium: 4250000,
    renewalRate: 0.75,
    quoteRate: 0.85,
    conversionRate: 0.882,
  },
  top20Salesmen: [
    {
      name: '张三',
      org: '成都分公司',
      dueCount: 100,
      renewedCount: 80,
      quotedCount: 90,
      renewalRate: 0.8,
      quoteRate: 0.9,
      duePremium: 500000,
      renewedPremium: 400000,
    },
  ],
};
```

**Location:**
- Inline in test files for simple fixtures
- Shared across related tests in same `describe()` block
- Larger fixtures in `tests/fixtures/` directory (not observed but available)

## Coverage

**Requirements:** No hard target enforced in codebase; best practice is 80%+

**View Coverage:**
```bash
bun run test:coverage
# Generates: coverage/index.html (open in browser)
# Formats: text, json, html, lcov reports
```

**Excluded from Coverage:**
- `tests/` directory itself
- `**/*.test.ts`, `**/*.test.tsx` files
- `src/main.tsx` (entry point)
- `src/vite-env.d.ts` (type declarations)
- `**/*.config.*` files
- `scripts/` directory

## Test Types

**Unit Tests:**
- Scope: Individual functions, utilities, React components
- 88 test files found across unit, integration, and E2E
- Examples: `alert-checker.test.ts` (45 tests), `security.test.ts` (20+ tests), `formatters.test.ts`
- Isolation: No backend required; uses mocked data and environment

**Integration Tests:**
- Scope: API endpoints, database operations, cross-module interactions
- Location: `tests/integration/critical-path.test.ts`
- Content: Permission filtering, SQL injection prevention, error boundaries
- Backend requirement: Optional (can use in-memory DuckDB or live server)

**E2E Tests:**
- Framework: Playwright 1.58.2 with `@playwright/test`
- Location: `tests/e2e/*.spec.ts` (12 test files)
- Authentication: Setup fixture in `auth.setup.ts` caches logged-in session
- Helper functions in `tests/e2e/helpers/`:
  - `session.ts`: `login()`, `ensureDataLoaded()`, `skipWhenNoData()`
  - `credentials.ts`: E2E username/password constants
  - `page-shell.ts`: UI navigation helpers
- Run commands:
  ```bash
  bun run test:e2e                    # Run all E2E tests
  bun run test:e2e:ui                 # Interactive Playwright UI mode
  bun run test:e2e:cleanup-gate       # Specific test (03-cleanup-zero-downtime-gate.spec.ts)
  ```

## Environment Configuration

**Test Environment Selection:**
- **Default (jsdom)**: Frontend components, utilities, API client
- **Node environment**: Backend services (Express, DuckDB)
- **Playwright browser**: E2E tests (Chrome headless)

**Vitest Config Overrides:**
```typescript
// vite.config.ts - main config
test: {
  environment: 'jsdom',          // Default for most tests
  environmentMatchGlobs: [
    ['server/**/*.test.ts', 'node']  // Override to Node for backend
  ],
  exclude: [
    'server/src/services/__tests__/duckdb-*.test.ts',  // Native tests excluded
    'tests/e2e/**'                                      // E2E excluded
  ]
}

// vitest.integration.config.ts - separate config for DuckDB tests
test: {
  environment: 'node',
  include: [
    'server/src/services/__tests__/duckdb-*.test.ts',
    'tests/parquet-*.test.ts',
    'tests/duckdb-*.test.ts'
  ]
}
```

**Global Setup:**
- `tests/setup.ts` runs before all tests:
  - Mocks `window.matchMedia()` (jsdom limitation)
  - Mocks `window.ResizeObserver` (jsdom limitation)
  - Sets logger to `warn` level (reduce test output noise)

## Common Patterns

**Async Testing:**
```typescript
it('should fetch data', async () => {
  const result = await apiClient.fetchData();
  expect(result).toBeDefined();
});

// With timeout override for slow operations
it('should load large dataset', async () => {
  const result = await expensiveQuery();
  expect(result.length).toBeGreaterThan(0);
}, { timeout: 30000 });  // 30 second timeout
```

**Error Testing:**
```typescript
it('should reject invalid input', () => {
  expect(() => validateInput('injection\' DROP TABLE')).toThrow();
});

it('should handle API errors', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
  const result = await apiClient.fetchData();
  expect(result).toBeNull();
});
```

**Snapshot Testing:** (Not observed in codebase, but supported by Vitest)

**Custom Matchers:** (Not observed; using standard Vitest/Jest matchers)

## CI/CD Integration

**GitHub Actions:**
- `governance-check.yml`: Runs governance checks on PR
- `claude-code.yml`: Triggered by @claude, runs tests
- `.deployment/deploy.yml`: Builds and tests before deployment

**Test Commands in CI:**
```bash
bun run typecheck           # Type checking
bun run build              # Build verification
bun run test --run         # Unit tests (non-watch mode)
bun run test:integration   # Integration tests (local only)
bun run test:e2e           # E2E tests (requires running server)
```

**Native Module CI Limitation:**
- Integration tests (duckdb-*.test.ts) excluded from CI
- DuckDB `@duckdb/node-api` uses `.node` native binary
- jsdom/Node.js runtime in CI cannot load `.node` files
- Solution: Tests marked in `vite.config.ts:exclude` array
- Local developers run `bun run test:integration` for full coverage

## Pre-flight Checks

**Script:** `bun run test:preflight`

Validates:
1. Test isolation (no stray `.node` files loaded in jsdom)
2. Type checking completeness
3. Basic health checks before full test run

## Critical Test Scenarios

**From integration tests (`critical-path.test.ts`):**
1. **Permission filtering**: Validates row-level security in SQL WHERE clauses
2. **SQL injection prevention**: Tests dangerous patterns removal
3. **Error boundaries**: Component crash recovery
4. **Authentication flow**: Login, token verification, logout

**From E2E tests:**
1. Dashboard loading and perspective switching (`01-dashboard-flow.spec.ts`)
2. Filter SQL execution (`02-filter-sql.spec.ts`)
3. Zero-downtime deployment gate (`03-cleanup-zero-downtime-gate.spec.ts`)
4. Subpage navigation without refresh (`04-subpage-no-refresh.spec.ts`)
5. Quote conversion workflow (`09-quote-conversion.spec.ts`)
6. Organization permission verification (`verify-org-permissions.spec.ts`)

---

*Testing analysis: 2026-04-12*
