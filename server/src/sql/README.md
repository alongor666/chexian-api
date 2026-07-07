# SQL Query Templates

This module provides centralized SQL query generation for KPIs, charts, and tables. All queries operate on the `PolicyFact` view, which enforces the MAX(premium) deduplication business rule.

## Core Principle

**Never query `raw_parquet` directly**. Always use the `PolicyFact` view to ensure:
- Policy-level deduplication (MAX premium per policy_no)
- Consistent business logic across all queries
- No accidental exposure of duplicate records

## Files

### `kpi.ts`

**Purpose**: Generate SQL queries for KPIs, Top N analytics, and aggregated tables

**Key Exports**:

#### 1. Metric Registry (`getMetricSql()`)

All KPI SQL fragments are defined in the **metric registry** (`server/src/config/metric-registry/`), the single source of truth for metric definitions:

```typescript
import { getMetricSql } from '../config/metric-registry/index.js';

// Returns SQL expression like 'SUM(premium) as total_premium'
getMetricSql('total_premium');
getMetricSql('renewal_rate');
getMetricSql('per_capita_premium');
```

**Design Notes**:
- Each metric has `id`, `name`, `formula`, `sql.expression`, `display`, `testCase`, and `changelog`
- `NULLIF(..., 0)` prevents division by zero
- `* 1.0` ensures floating-point division for rates
- Never hardcode metric SQL — always use `getMetricSql(id)`

#### 2. KPI Query Generator

```typescript
generateKpiQuery(whereClause?: string): string
```

**Purpose**: Generate a single query that computes all 6 KPIs

**Usage**:
```typescript
// All data
const sql = generateKpiQuery();

// Filtered
const sql = generateKpiQuery("org_level_3 = 'Shanghai'");

// Result columns:
// - total_premium: number
// - org_count: number
// - salesman_count: number
// - per_capita_premium: number
// - renewal_rate: number (0.0 to 1.0)
// - nev_rate: number (0.0 to 1.0)
```

#### 3. Top N Query Generator

```typescript
generateTopNQuery(
  dimension: string,
  metric?: string,
  limit?: number,
  whereClause?: string
): string
```

**Purpose**: Generate queries for Top N charts (bar charts, rankings)

**Parameters**:
- `dimension`: Column to group by (e.g., `'salesman_name'`, `'org_level_3'`)
- `metric`: Aggregation expression (default: `'SUM(premium)'`)
- `limit`: Number of results (default: `20`)
- `whereClause`: Filter condition (default: `'1=1'`)

**Usage**:
```typescript
// Top 20 salesmen by premium
const sql = generateTopNQuery('salesman_name');

// Top 10 orgs by policy count
const sql = generateTopNQuery('org_level_3', 'COUNT(*)', 10);

// Top 5 salesmen for renewals
const sql = generateTopNQuery(
  'salesman_name',
  'SUM(premium)',
  5,
  'is_renewal = true'
);

// Result columns:
// - dim_key: string (the dimension value)
// - value: number (the metric value)
```

#### 4. Salesman Table Query Generator

```typescript
generateSalesmanTableQuery(
  limit?: number,
  offset?: number,
  whereClause?: string
): string
```

**Purpose**: Generate queries for the salesman performance table with pagination

**Parameters**:
- `limit`: Page size (default: `100`)
- `offset`: Offset for pagination (default: `0`)
- `whereClause`: Filter condition (default: `'1=1'`)

**Usage**:
```typescript
// First page (100 rows)
const sql = generateSalesmanTableQuery();

// Page 3 (rows 201-250)
const sql = generateSalesmanTableQuery(50, 200);

// Filtered for specific org
const sql = generateSalesmanTableQuery(100, 0, "org_level_3 = 'Beijing'");

// Result columns:
// - salesman_name: string
// - org_level_3: string
// - signed_premium: number
// - policy_count: number
```

## Query Patterns

### WHERE Clause Construction

**Dynamic Filtering**:
```typescript
function buildWhereClause(filters: FilterState): string {
  const parts = ['1=1'];  // Always true base

  if (filters.org) {
    parts.push(`org_level_3 LIKE '%${filters.org}%'`);
  }

  if (filters.salesman) {
    parts.push(`salesman_name LIKE '%${filters.salesman}%'`);
  }

  return parts.join(' AND ');
}

const where = buildWhereClause(filters);
const sql = generateKpiQuery(where);
```

**Security Note**: For production, use parameterized queries or escape user input to prevent SQL injection.

### Combining Metrics

```typescript
// Custom metric combining multiple KPIs
const customMetric = `
  SUM(CASE WHEN is_renewal THEN premium ELSE 0 END) as renewal_premium
`;

const sql = generateTopNQuery('org_level_3', customMetric, 10);
```

### Multi-Dimensional Analysis

```typescript
// Pivot-like analysis using CASE
const metric = `
  SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) as renewal_count,
  SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) as nev_count
`;

// Note: generateTopNQuery expects single metric
// For multi-metric, write custom SQL or run multiple queries
```

## Business Logic Enforcement

### 1. Policy-Level Granularity

All queries aggregate at policy level (via PolicyFact view):
```sql
-- ✅ Correct: Aggregates policies
SELECT salesman_name, SUM(premium)
FROM PolicyFact
GROUP BY salesman_name

-- ❌ Wrong: Direct access to raw data
SELECT salesman_name, premium
FROM raw_parquet
```

### 2. No Single-Policy Details

Queries must always aggregate:
```sql
-- ✅ Correct: Aggregated
SELECT COUNT(*), SUM(premium) FROM PolicyFact WHERE ...

-- ❌ Wrong: Individual policy details
SELECT policy_no, premium FROM PolicyFact LIMIT 1
```

This enforces privacy and business rules.

### 3. Deduplication is Implicit

Because all queries use PolicyFact view:
```sql
-- Duplicate policies are already handled by:
-- CREATE VIEW PolicyFact AS
--   SELECT policy_no, MAX(premium) as premium, ...
--   FROM raw_parquet
--   GROUP BY policy_no
```

## Performance Considerations

### Indexes (Future Enhancement)

```sql
-- When moving to persistent DuckDB:
CREATE INDEX idx_salesman ON PolicyFact(salesman_name);
CREATE INDEX idx_org ON PolicyFact(org_level_3);
CREATE INDEX idx_date ON PolicyFact(policy_date);
```

### Query Optimization

1. **Limit Results**: Always use LIMIT for large datasets
2. **Filter Early**: Apply WHERE clauses before aggregation
3. **Avoid SELECT ***: Specify only needed columns
4. **Use DISTINCT Carefully**: Only when truly needed (COUNT DISTINCT is expensive)

### Arrow IPC Efficiency

DuckDB returns results as Arrow tables:
```typescript
const table = await conn.query(sql);
const buffer = tableToIPC(table);  // Efficient binary format
```

Large result sets transfer efficiently because:
- Binary format (not JSON)
- Columnar storage (better compression)
- Zero-copy deserialization

## Testing

See `tests/kpi.test.ts` for comprehensive tests including:
- SQL generation correctness
- WHERE clause handling
- Business logic enforcement (PolicyFact usage)
- Deduplication behavior

## Common Patterns

### Dashboard Initialization

```typescript
// Fetch all KPIs in one query
const kpiSql = generateKpiQuery(whereClause);
const kpiTable = await duckdbClient.query(kpiSql).promise;
const kpis = kpiTable.toArray()[0];

// Fetch Top 20 salesmen
const chartSql = generateTopNQuery('salesman_name', 'SUM(premium)', 20, whereClause);
const chartTable = await duckdbClient.query(chartSql).promise;
const chartData = chartTable.toArray();

// Fetch salesman table (first page)
const tableSql = generateSalesmanTableQuery(100, 0, whereClause);
const tableData = await duckdbClient.query(tableSql).promise;
```

### Drill-Down Analysis

```typescript
// 1. Top orgs
const orgSql = generateTopNQuery('org_level_3');

// 2. Click on org -> filter salesmen
const where = "org_level_3 = 'Shanghai'";
const salesmanSql = generateTopNQuery('salesman_name', 'SUM(premium)', 20, where);
```

## Adding New Metrics

To add a new KPI:

1. Register in metric registry (`server/src/config/metric-registry/categories/*.ts`):
```typescript
{ id: 'avg_policy_value', name: '件均保费', formula: 'AVG(premium)', sql: { expression: 'AVG(premium) as avg_policy_value' }, ... }
```

2. Validate: `bun scripts/metric-registry/validate.ts`

3. Add to `generateKpiQuery()`:
```typescript
SELECT
  ${getMetricSql('total_premium')},
  ${getMetricSql('avg_policy_value')},  // Add here
  ...
```

4. Update Dashboard component to display it:
```typescript
<KpiCard title="件均保费" value={kpis.avg_policy_value} formatter={fmtMoney} />
```

5. Update tests in `tests/kpi.test.ts`
