# Dashboard Module

The main dashboard orchestration component that coordinates data loading, filtering, and visualization.

## Components

### `Dashboard.tsx`

**Purpose**: Main dashboard container that manages state and data flow

**Key Responsibilities**:
1. File upload and Parquet loading
2. Filter state management
3. Query orchestration (KPIs, charts, tables)
4. Loading states and error handling

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Dashboard Component                │
├─────────────────────────────────────────────────────┤
│                                                       │
│  1. File Upload    →  loadParquet()                  │
│                       ↓                               │
│  2. Schema Validation + PolicyFact View Creation     │
│                       ↓                               │
│  3. Filter Changes →  buildWhereClause()             │
│                       ↓                               │
│  4. Parallel Queries:                                │
│     - KPI Query      (Priority 1)                    │
│     - Chart Query    (Priority 2)                    │
│     - Table Query    (Priority 3)                    │
│                       ↓                               │
│  5. Render Components                                │
│     - KpiCard × 6                                    │
│     - BarChart (Top 20 salesmen)                     │
│     - VirtualTable (Salesman performance)            │
│                                                       │
└─────────────────────────────────────────────────────┘
```

## State Management

### Local State

```typescript
// Initialization
const [isInitialized, setIsInitialized] = useState(false);
const [error, setError] = useState<string | null>(null);

// Data
const [kpis, setKpis] = useState<any>({});
const [chartData, setChartData] = useState<any[]>([]);
const [tableData, setTableData] = useState<any[]>([]);

// Loading
const [loadingKpi, setLoadingKpi] = useState(false);
const [loadingChart, setLoadingChart] = useState(false);

// Filters
const [filters, setFilters] = useState<FilterState>({});
```

### Data Flow

```
User Action             State Update           Side Effect
─────────────────────  ──────────────────── ──────────────────────
Upload Parquet    →    isInitialized=true → refreshData()
Change Filter     →    filters={...}      → debounced refreshData()
Successful Load   →    error=null         → -
Failed Load       →    error='...'        → Display error
```

## Loading Strategy

### Progressive Loading

Queries are fired in priority order but process independently:

```typescript
// Priority 1: KPIs (users want to see these first)
const kpiPromise = duckdbClient.query(kpiSql).promise;
kpiPromise.then(table => {
  setKpis(table.toArray()[0]);
  setLoadingKpi(false);
});

// Priority 2: Chart
const chartPromise = duckdbClient.query(chartSql).promise;
chartPromise.then(table => {
  setChartData(table.toArray());
  setLoadingChart(false);
});

// Priority 3: Table (largest dataset)
const tablePromise = duckdbClient.query(tableSql).promise;
tablePromise.then(table => {
  setTableData(table.toArray());
});
```

**Why Progressive?**
- KPIs render first (smaller query)
- Chart renders next (medium query)
- Table renders last (largest query, users might scroll down)
- Better perceived performance

### Debounced Refresh

Filters trigger a debounced refresh to avoid excessive queries:

```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    refreshData();
  }, 300); // 300ms debounce

  return () => clearTimeout(timer);
}, [filters, refreshData]);
```

**Behavior**:
- User types "Sh" → no query
- User types "Sha" → no query
- User types "Shanghai" → wait 300ms → query fires

## Filter Construction

### Building WHERE Clauses

```typescript
const buildWhereClause = () => {
  const parts = ['1=1'];  // Base case

  if (filters.org_level_3) {
    parts.push(`org_level_3 LIKE '%${filters.org_level_3}%'`);
  }

  if (filters.salesman_name) {
    parts.push(`salesman_name LIKE '%${filters.salesman_name}%'`);
  }

  return parts.join(' AND ');
};

// Result: "1=1 AND org_level_3 LIKE '%Shanghai%' AND salesman_name LIKE '%Zhang%'"
```

**Pattern**: Always include `'1=1'` as base, then append conditions. This avoids complex logic for handling the first condition.

## Error Handling

### Validation Errors

```typescript
const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    setError(null);
    await duckdbClient.loadParquet(file);
    setIsInitialized(true);
    refreshData();
  } catch (err: any) {
    setError(err.message);  // Display to user
  }
};
```

**Error Types**:
- Schema validation: "Required domain field 'premium' not found..."
- Type validation: "Column 'premium' has type 'VARCHAR', expected..."
- DuckDB errors: "SQL Error: ..."

### Query Errors

```typescript
kpiPromise.catch(err => {
  console.error("KPI Query Failed", err);
  setLoadingKpi(false);  // Stop loading spinner
  // Could set error state to display to user
});
```

## Race Condition Handling

### The Problem

User changes filters rapidly:
1. Filter: `org='A'` → Query 1 starts
2. Filter: `org='B'` → Query 2 starts
3. Query 2 finishes → UI updates
4. Query 1 finishes → UI updates (wrong!)

### Current Implementation

The code includes `isLatestRequest()` mechanism in `duckdbClient`, but has a known issue with parallel queries (documented in comments).

## Phase 2 Hooks

New hooks introduced to keep the dashboard lean and testable:

- `hooks/useDashboardFilters.ts` - filter state + safe WHERE builder
- `hooks/useDashboardData.ts` - KPI/TopN/table/rose data orchestration
- `hooks/useDataQualityCheck.ts` - data quality checks after load
- `hooks/useFilterState.ts` - premium dashboard filter options + linkage
- `hooks/usePremiumDashboardData.ts` - premium dashboard data fetch (table + rose charts)

Shared types live in `types.ts` to keep components and hooks aligned.

**Current Behavior**: All queries update UI (last to finish wins)

**Recommended Fix** (for production):
```typescript
// Use a refresh batch ID
const refreshIdRef = useRef(0);

const refreshData = useCallback(() => {
  const batchId = ++refreshIdRef.current;

  // ... fire queries ...

  kpiPromise.then(table => {
    if (batchId === refreshIdRef.current) {  // Only latest batch
      setKpis(table.toArray()[0]);
    }
  });
}, [filters]);
```

## Data Formatting

### Number Formatters

```typescript
const fmtMoney = (val: number) => (val / 10000).toFixed(2) + '万';
const fmtPct = (val: number) => (val * 100).toFixed(1) + '%';
const fmtInt = (val: number) => Math.round(val).toLocaleString();
```

**Usage**:
```typescript
<KpiCard
  title="总保费"
  value={kpis.total_premium}
  formatter={fmtMoney}  // 12345678 → "1234.57万"
/>
```

### Chart Data Transformation

```typescript
chartPromise.then(table => {
  const data = table.toArray().map(row => ({
    dim_key: row.dim_key,      // 'Zhang San'
    value: row.value           // 1234567.89
  }));
  setChartData(data);
});
```

### Table Data Transformation

```typescript
const data = table.toArray().map(row => ({
  salesman_name: row.salesman_name,
  org_level_3: row.org_level_3,
  signed_premium: fmtMoney(row.signed_premium),  // Pre-format
  policy_count: row.policy_count
}));
setTableData(data);
```

## Component Integration

### FilterPanel

```typescript
<FilterPanel
  filters={filters}           // Current filter state
  onChange={setFilters}       // Update callback
/>
```

### KPI Cards

KPI 口径说明与承保/净额规则见 `开发文档/KPI口径说明.md`。

```typescript
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
  <KpiCard title="总保费" value={kpis.total_premium} formatter={fmtMoney} loading={loadingKpi} />
  <KpiCard title="机构数" value={kpis.org_count} formatter={fmtInt} loading={loadingKpi} />
  {/* ... 4 more KPIs ... */}
</div>
```

### BarChart

```typescript
<BarChart
  title="业务员保费 Top20"
  data={chartData}           // [{ dim_key, value }, ...]
  loading={loadingChart}
/>
```

### VirtualTable

```typescript
<VirtualTable
  columns={[
    { key: 'salesman_name', header: '业务员', width: 100 },
    { key: 'org_level_3', header: '机构', width: 150 },
    { key: 'signed_premium', header: '签单保费', width: 120 },
    { key: 'policy_count', header: '单量', width: 80 },
  ]}
  data={tableData}
  loading={loadingChart}
/>
```

## Layout

### Responsive Grid

```typescript
// 2 cols on mobile, 3 on tablet, 6 on desktop
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
  {/* KPI Cards */}
</div>

// 1 col on mobile, 2 on desktop (50/50 split)
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[500px]">
  <BarChart ... />
  <VirtualTable ... />
</div>
```

## Future Enhancements

### 1. Request Cancellation

Implement proper batch-based request tracking to avoid race conditions.

### 2. Caching

Cache query results to avoid re-fetching when filters revert:
```typescript
const cacheRef = useRef(new Map<string, any>());

const cacheKey = JSON.stringify(filters);
if (cacheRef.current.has(cacheKey)) {
  return cacheRef.current.get(cacheKey);
}
```

### 3. Export Functionality

Add CSV/Excel export:
```typescript
const exportData = () => {
  const csv = tableData.map(row => Object.values(row).join(',')).join('\n');
  downloadFile(csv, 'export.csv');
};
```

### 4. Drill-Down

Clickable charts that update filters:
```typescript
<BarChart
  data={chartData}
  onBarClick={(salesmanName) => {
    setFilters({ ...filters, salesman_name: salesmanName });
  }}
/>
```

## Performance Tips

1. **Memoize Callbacks**: Use `useCallback` for `refreshData` to avoid unnecessary re-renders
2. **Virtual Scrolling**: Already implemented via `react-window` for table
3. **Lazy Loading**: Consider lazy loading chart library (ECharts is large)
4. **Query Limits**: Always limit table queries (currently 100 rows)

## Testing

To test Dashboard:
1. Mock `duckdbClient` with jest.mock()
2. Test state transitions (upload → loading → success/error)
3. Test filter debouncing
4. Test error handling

Example:
```typescript
it('should display error on failed upload', async () => {
  const mockClient = { loadParquet: jest.fn().mockRejectedValue(new Error('Invalid schema')) };
  // ... render Dashboard with mock
  // ... upload file
  expect(screen.getByText('Invalid schema')).toBeInTheDocument();
});
```
