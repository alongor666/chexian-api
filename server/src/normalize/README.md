# Data Normalization & Validation

This module implements the **Alias-Validation Pattern** for handling data from various sources with different column naming conventions.

## Core Concepts

### 1. Domain Fields vs. Actual Columns

- **Domain Fields**: Business concepts that are consistent across the application (e.g., `policy_no`, `premium`)
- **Actual Columns**: Real column names in the data source (e.g., `保单号`, `signed_premium`, `pol_num`)

### 2. Alias-Validation Pattern

The pattern enforces a three-step process:

1. **Define Aliases**: Map each domain field to multiple possible column names
2. **Validate Schema**: Check if required columns exist (using any matching alias)
3. **Process Data**: Use the resolved mapping for all queries

## Files

### `mapping.ts`

**Purpose**: Column mapping and alias resolution

**Key Exports**:
- `COLUMN_ALIASES`: Default alias configuration with English and Chinese variants
- `validateAndResolveMapping()`: Main validation function
- `ColumnMapping`: Type definition for resolved mapping
- `ValidationResult`: Validation result with errors/warnings

**Usage Example**:
```typescript
import { validateAndResolveMapping } from '@/shared/normalize/mapping';

const actualColumns = ['保单号', '保费', '业务员'];
const result = validateAndResolveMapping(actualColumns);

if (result.valid) {
  console.log('Resolved mapping:', result.mapping);
  // Use result.mapping for queries
} else {
  console.error('Validation failed:', result.errors);
}
```

### `validator.ts`

**Purpose**: Data type validation and quality checks

**Key Exports**:
- `validateColumnTypes()`: Validate column data types against expected types
- `generateDataQualityCheckSQL()`: Generate SQL to check for NULL values
- `parseDataQualityResult()`: Parse quality check results and generate warnings
- `EXPECTED_TYPES`: Expected data types for each domain field

**Usage Example**:
```typescript
import { validateColumnTypes } from '@/shared/normalize/validator';

const schema = [
  { column_name: 'policy_no', column_type: 'VARCHAR' },
  { column_name: 'premium', column_type: 'DOUBLE' }
];

const typeValidation = validateColumnTypes(schema, mapping);
if (!typeValidation.valid) {
  console.error('Type errors:', typeValidation.errors);
}
```

## Customizing Aliases

To support a custom data source with different column names:

```typescript
import { ColumnAliasConfig, validateAndResolveMapping } from '@/shared/normalize/mapping';

const customAliases: ColumnAliasConfig = {
  policy_no: ['pol_id', 'policy_number', 'insurance_id'],
  premium: ['amount', 'premium_amt', 'policy_premium'],
  // ... other fields
};

const result = validateAndResolveMapping(actualColumns, customAliases);
```

## Error Handling

### Validation Errors

**Blocking errors** (prevent data loading):
- Missing required columns
- Column not found in schema

**Warnings** (logged but not blocking):
- Ambiguous column mappings (multiple matches)
- Unexpected but acceptable data types

### Best Practices

1. **Always validate before processing**: Never assume column names match
2. **Log warnings**: Review warnings for potential data quality issues
3. **Use custom aliases**: When working with non-standard data sources
4. **Test with sample data**: Validate your alias configuration with real data samples

## Testing

See `tests/mapping.test.ts` and `tests/validator.test.ts` for comprehensive test coverage including:
- English/Chinese/Mixed column names
- Missing columns detection
- Ambiguous mappings
- Type validation
- Data quality checks
