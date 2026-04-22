# Renewal Analysis Redesign - Architecture Investigation Report

## Executive Summary

The renewal analysis redesign aims to construct the "应续宇宙" (due-for-renewal universe) from PolicyFact. This report provides a comprehensive architectural investigation into how this can be achieved, including the materialization flow, existing filtering patterns for insurance types, and integration points.

---

## 1. PolicyFact Materialization Flow

### Materialization Pipeline

**File**: `server/src/services/duckdb-materialization.ts`

#### Raw Data → Materialized Table Chain

```
raw_parquet (source Parquet files)
    ↓ (column name mapping + normalization)
PolicyFact (VIEW)
    ↓ (boolean field standardization)
PolicyFactRealtime (MATERIALIZED TABLE with indexes)
    ↓ (alias for drilldown)
PolicyFactRenewal (VIEW pointing to PolicyFactRealtime)
```

#### Key Facts About PolicyFact Creation

1. **Location**: Lines 399-469 in `duckdb-materialization.ts`
2. **Function**: `createPolicyFactView()`
3. **Three Stages**:
   - **Stage 1 - Column Mapping** (Lines 412-434):
     - Detects Chinese column names in raw_parquet
     - Uses `generateColumnMappingSQL()` and `getColumnMapping()` from `column-normalizer.ts`
     - Creates PolicyFact VIEW with English-normalized columns
   
   - **Stage 2 - Backward Compatibility** (Lines 436-457):
     - Adds missing compat columns to raw_parquet (ALTER ADD COLUMN):
       - `renewal_mode` (VARCHAR)
       - `is_cross_sell` (BOOLEAN)
       - `cross_sell_premium_driver` (DOUBLE)
       - `claim_cases`, `reported_claims` (INTEGER/DOUBLE)
       - `driver_coverage`, `passenger_coverage` (DOUBLE)
     - Rebuilds PolicyFact VIEW after schema changes
   
   - **Stage 3 - Materialization** (Lines 459-469):
     - Calls `materializePolicyFactWorkingSet()` to create PolicyFactRealtime (TABLE)
     - Creates PolicyFactRenewal as alias VIEW

#### PolicyFactRealtime Materialization

**Function**: `materializePolicyFactWorkingSet()` (Lines 166-222)

**Purpose**: Convert to physical TABLE with boolean field normalization and indexes

**Key Operations**:
1. **Boolean Standardization** (Lines 171-183):
   - Maps VARCHAR/'是'/'1'/'true' → BOOLEAN
   - Replaces 24 boolean fields using CASE expressions
   - Handles missing columns gracefully (union_by_name might insert NULLs)

2. **Index Creation** (Lines 215-220):
   ```sql
   CREATE INDEX idx_policy_fact_policy_date ON PolicyFactRealtime(policy_date)
   CREATE INDEX idx_policy_fact_org ON PolicyFactRealtime(org_level_3)
   CREATE INDEX idx_policy_fact_salesman ON PolicyFactRealtime(salesman_name)
   ```

3. **Memory Optimization** (Lines 202-211):
   - After materialization, drops all raw_parquet tables
   - Rebuilds views to point at PolicyFactRealtime
   - Frees ~500MB+ of memory

4. **Return Type**: `'table' | 'view'` (automatic fallback on OOM)

#### PolicyFactRenewal Alias

**Lines 460-463**:
```typescript
await db.query(`
  CREATE OR REPLACE VIEW PolicyFactRenewal AS
  SELECT * FROM PolicyFact
`);
```

Then after materialization:
```typescript
await db.query(`
  CREATE OR REPLACE VIEW PolicyFactRenewal AS
  SELECT * FROM PolicyFact  // Now PolicyFact points to PolicyFactRealtime
`);
```

**Result**: PolicyFactRenewal is a pass-through VIEW used by renewal drilldown queries.

---

## 2. Existing "交商同保" (Insurance Type Combination) Logic

### Insurance Type Field Patterns

**Field Registry** (Lines 69-76 in `fields.json`):
```json
{
  "id": "insurance_type",
  "label": "险类",
  "description": "交强险/商业险"
}
```

### Standardized Values in insurance_type Field

From `duckdb-materialization.ts` (lines 291-292, 364-365):

```
'商业险'        - Commercial insurance
'商业保险'      - Commercial insurance (alias)
'商车统保'      - Bundled commercial + compulsory
'商业险+交强险' - Bundled explicit
'交强险'        - Compulsory insurance only
```

### Existing Filtering Patterns

#### Pattern 1: Cross-Sell Agg Query (Lines 285-295)

**File**: `server/src/services/duckdb-materialization.ts`

```sql
COALESCE(SUM(CASE WHEN insurance_type IN ('商业险', '商业保险', '商车统保', '商业险+交强险') 
  THEN premium ELSE 0 END), 0) AS commercial_premium,
COALESCE(SUM(CASE WHEN insurance_type = '交强险' 
  THEN premium ELSE 0 END), 0) AS compulsory_premium,
COALESCE(SUM(premium), 0) AS auto_premium
```

**Logic**:
- Commercial: All policies with 商业 in insurance_type
- Compulsory: Only pure 交强险
- Total: All premiums

#### Pattern 2: PolicyFact Insurance Clause (Lines 46-51)

**File**: `server/src/routes/query/cross-sell.ts`

```typescript
export function buildPolicyFactInsuranceClause(raw: unknown): string {
  const insuranceType = parseInsuranceTypeFlag(raw);
  if (insuranceType === true) 
    return "insurance_type = '交强险'";
  if (insuranceType === false) 
    return "insurance_type IN ('商业险', '商业保险', '商车统保', '商业险+交强险')";
  return '';
}
```

**Usage**: Filters PolicyFact for cross-sell drilldown queries

#### Pattern 3: Metric Registry Rules

**File**: `server/src/config/metric-registry/categories/ratio.ts`

Commercial insurance rate calculation:
```sql
CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END
```

Commercial-to-compulsory ratio:
```sql
COUNT(CASE WHEN insurance_type LIKE '%商业%' THEN 1 END) / 
NULLIF(COUNT(CASE WHEN insurance_type = '交强险' THEN 1 END), 0)
```

#### Pattern 4: Premium Report Aggregation

**File**: `server/src/sql/premium-report.ts`

```sql
SUM(CASE WHEN insurance_type IN ('商业险', '商业保险', '商车统保', '商业险+交强险') 
  THEN premium ELSE 0 END) / 10000 AS 商业险保费,
COUNT(DISTINCT CASE WHEN insurance_type IN (...) THEN policy_no END) AS 商业险件数,
SUM(CASE WHEN insurance_type = '交强险' THEN premium ELSE 0 END) / 10000 AS 交强险保费,
```

### VIN Grouping Patterns

**File**: `server/src/services/duckdb-materialization.ts` (Lines 272-273)

```sql
COALESCE(
  NULLIF(TRIM(CAST(cs.vehicle_frame_no AS VARCHAR)), ''),
  NULLIF(TRIM(CAST(cs.policy_no AS VARCHAR)), '')) AS dedup_key
```

**Strategy**: Group by VIN (vehicle_frame_no) as primary key, fallback to policy_no if VIN missing.

---

## 3. Where to Add RenewalUniverse VIEW

### Recommended Location: `createPolicyFactView()` in duckdb-materialization.ts

**Rationale**:
1. PolicyFact/PolicyFactRenewal creation already exists here (lines 460-463)
2. Both are core renewal analysis foundations
3. Can reuse same pattern: VIEW → Materialized TABLE → Return status
4. Register in `DERIVED_RELATIONS` array (line 17-28)

### Implementation Pattern

**Add to DERIVED_RELATIONS** (after PolicyFactRenewal):
```typescript
export const DERIVED_RELATIONS = [
  'ClaimsDetail',
  'ClaimsAgg',
  'CrossSellFact',
  'CrossSellDailyAgg',
  'PolicyFactRenewal',
  'PolicyFact',
  'PolicyFactRealtime',
  'RepairDim',
  'BrandDim',
  'CustomerFlow',
  'RenewalUniverse',  // ← NEW
] as const;
```

**Function Template** (similar to existing pattern):
```typescript
export async function createRenewalUniverseView(db: DuckDBQueryable): Promise<void> {
  // 1. Define VIEW SQL (with all 交商同保 filtering logic)
  const renewalUniverseSQL = `
    CREATE OR REPLACE VIEW RenewalUniverse AS
    WITH normalized AS (
      SELECT
        policy_no,
        salesman_name,
        org_level_3,
        customer_category,
        insurance_type,
        insurance_start_date,
        CAST(insurance_start_date AS DATE) + INTERVAL '1 year' - INTERVAL '1 day' AS expiry_date,
        premium,
        coverage_combination,
        -- [other renewal-relevant fields]
      FROM PolicyFact
      WHERE policy_date IS NOT NULL
    )
    SELECT 
      *,
      -- Calculate renewal status
      CASE 
        WHEN CURRENT_DATE >= expiry_date THEN 'expired'
        WHEN CURRENT_DATE >= expiry_date - INTERVAL '30 days' THEN 'in_quote_window'
        ELSE 'future'
      END AS renewal_status
    FROM normalized
  `;
  
  // 2. Create VIEW
  await db.query(renewalUniverseSQL);
  
  // 3. Validation
  const result = await db.query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM RenewalUniverse'
  );
  console.log(`[DuckDB] RenewalUniverse created: ${result[0]?.cnt ?? 0} rows`);
}
```

**Call Location**: Add to `createPolicyFactView()` after line 467:
```typescript
await createRenewalUniverseView(db);
```

---

## 4. Customer Flow & Quote Conversion Loaders

### CustomerFlow

**File**: `server/src/services/duckdb-domain-loaders.ts` (Lines 478-489)

**Loading Function**: `loadCustomerFlow()`
```typescript
export async function loadCustomerFlow(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW CustomerFlow AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM CustomerFlow'
  );
  console.log(`[DuckDB] CustomerFlow view loaded: ${countResult[0]?.cnt ?? 0} rows...`);
}
```

**Path Configuration**: `server/src/config/paths.ts` (Lines 136-141)

```typescript
export function getCustomerFlowPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/customer_flow/latest.parquet'),
    path.resolve(getDataDir(), 'fact/customer_flow/latest.parquet'),
  ];
}
```

**VIEW Name**: `CustomerFlow` (not materialized, direct Parquet read)

**Load Order**: Called from `duckdb.ts` data initialization

### QuoteConversion

**File**: `server/src/services/duckdb-domain-loaders.ts` (Lines 384-394)

**Loading Function**: `loadQuoteConversion()`
```typescript
export async function loadQuoteConversion(db: DuckDBQueryable, parquetPath: string): Promise<void> {
  const safePath = escapeSqlValue(parquetPath.replace(/\\/g, '/'));
  await db.query(`
    CREATE OR REPLACE VIEW QuoteConversion AS
    SELECT * FROM read_parquet('${safePath}')
  `);
  const countResult = await db.query<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM QuoteConversion'
  );
  console.log(`[DuckDB] QuoteConversion view loaded: ${countResult[0]?.cnt ?? 0} rows...`);
}
```

**Path Configuration**: `server/src/config/paths.ts` (Lines 84-89)

```typescript
export function getQuoteConversionPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/quotes_conversion/latest.parquet'),
    path.resolve(getDataDir(), 'fact/quotes_conversion/latest.parquet'),
  ];
}
```

**VIEW Name**: `QuoteConversion` (not materialized)

**Fields Available**: All fields from `quotes_conversion/latest.parquet` (typically includes policy_no, quote_date, quote_premium, conversion_flag, etc.)

---

## 5. Core Path Functions

**File**: `server/src/config/paths.ts`

```typescript
// ══════════════════════════════════════════════════════════
// PolicyFact Parquet (primary source)
// ══════════════════════════════════════════════════════════
export function getCandidateDataDirs(): string[] {
  const warehouseCurrent = path.resolve(
    SERVER_ROOT, 
    '../数据管理/warehouse/fact/policy/current'
  );
  const serverDataCurrent = path.resolve(getDataDir(), 'current');
  return [warehouseCurrent, serverDataCurrent];  // warehouse priority
}

// ══════════════════════════════════════════════════════════
// Renewal Funnel (应续保单来源)
// ══════════════════════════════════════════════════════════
export function getRenewalFunnelPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/renewal/renewal_funnel_2026q1.parquet'),
    path.resolve(getDataDir(), 'fact/renewal/renewal_funnel_2026q1.parquet'),
  ];
}

// ══════════════════════════════════════════════════════════
// Customer Flow & Quotes
// ══════════════════════════════════════════════════════════
export function getCustomerFlowPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/customer_flow/latest.parquet'),
    path.resolve(getDataDir(), 'fact/customer_flow/latest.parquet'),
  ];
}

export function getQuoteConversionPaths(): string[] {
  return [
    path.resolve(SERVER_ROOT, '../数据管理/warehouse/fact/quotes_conversion/latest.parquet'),
    path.resolve(getDataDir(), 'fact/quotes_conversion/latest.parquet'),
  ];
}
```

---

## 6. Renewal Analysis Existing Patterns

### RenewalFunnel (Already Exists)

**File**: `server/src/sql/renewal-funnel.ts`

**Data Source**: Independent RenewalFunnel Parquet (35,011 records)
- **Purpose**: "交商同保续保询报价数据" (Bundled insurance inquiry/quote data)
- **Fields**: 17 original + 4 calculated
- **Key Calculations** (Lines 360-376):
  - `days_since_expiry`: Current date - expiry date
  - `in_quote_window`: Can quote within 30 days before expiry
  - `maturity`: mature/pending/future
  - `action_priority`: P1/P2/P3/P4 (urgency levels)

**Drilldown Query Example** (Lines 71-118):
```sql
SELECT
  org_level_3,
  COUNT(*) AS total_due,
  SUM(CASE WHEN in_quote_window THEN 1 ELSE 0 END) AS in_window_count,
  SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS total_quoted,
  SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
  -- Four-stage funnel: due → quoted → renewed
FROM RenewalFunnel
WHERE org_level_3 = '...'
GROUP BY org_level_3
```

### Renewal Rate Calculation

**File**: `server/src/sql/renewal.ts`

**Core Logic** (Lines 1-19):

```
应续保单（Denominator）:
  - 起保日期 in (targetYear - 1) 年
  - 到期日 <= 当前日期（已过期）
  - 到期日 = 起保日期 + 1年 - 1天

已续保单（Numerator）:
  - 应续保单 WHERE renewal_policy_no IS NOT NULL

续保率 = 已续保单件数 / 应续保单件数
```

**Drilldown Implementation** (Lines 84-129 in `renewal-drilldown.ts`):
- Supports org/team/salesman/coverage dimensions
- Filters by insurance_type (via WHERE clause in buildDrilldownWhereClause)
- Optional ranking (show top N by due_count)

---

## 7. Data Type & Schema Patterns

### Field Mapping (Normalization)

**File**: `server/src/normalize/mapping.ts`

Key field aliases for 交商同保 context:
```typescript
is_commercial_insure: [
  '是否交商统保',
  'is_commercial_insure',
  'isCommercialInsure',
  '交商统保',
  '交商同保',    // ← THIS is the field name in data
  'commercial_insure'
]
```

### Boolean Field Standardization

**File**: `server/src/services/duckdb-materialization.ts` (Lines 176-178)

```typescript
CASE WHEN LOWER(TRIM(CAST("${field}" AS VARCHAR))) 
  IN ('是', '1', 'true', 't', 'y', 'yes', '有', '有驾意险交叉销售') 
THEN true ELSE false END AS "${field}"
```

**Applies to**: 24 fields in BOOLEAN_FIELDS array
- Normalizes all Chinese/numeric/text representations

---

## Summary: Key Integration Points

| Component | Location | Purpose | Status |
|-----------|----------|---------|--------|
| PolicyFact VIEW | `duckdb-materialization.ts:399` | Column mapping + normalization | Exists |
| PolicyFactRealtime TABLE | `duckdb-materialization.ts:186` | Materialized + indexed working set | Exists |
| PolicyFactRenewal VIEW | `duckdb-materialization.ts:460` | Renewal drilldown alias | Exists |
| **RenewalUniverse VIEW** | `duckdb-materialization.ts:?` | **应续宇宙 (to be added)** | **NEW** |
| RenewalFunnel VIEW | `duckdb-domain-loaders.ts:353` | 交商同保 inquiry/quote data | Exists |
| CustomerFlow VIEW | `duckdb-domain-loaders.ts:481` | Customer source/sink data | Exists |
| QuoteConversion VIEW | `duckdb-domain-loaders.ts:386` | Quote-to-renewal conversion | Exists |
| Insurance Type Filtering | `cross-sell.ts:46-50` | 交商 vs 交强 split logic | Exists |
| Renewal Rate SQL | `renewal.ts:130-170` | Core renewal KPI calculation | Exists |
| Renewal Drilldown | `renewal-drilldown.ts:84+` | Multi-dimension breakdown | Exists |
