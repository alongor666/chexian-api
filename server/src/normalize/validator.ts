/**
 * Data Validation Utilities
 *
 * Provides validation functions for data quality checks
 */

import { ColumnMapping } from './mapping';
import { createLogger } from '../utils/logger';
import type { QueryResultRow } from '../types/data';

const logger = createLogger('Validator');

/**
 * Expected data types for each domain field
 */
export const EXPECTED_TYPES: Record<keyof ColumnMapping, string[]> = {
  policy_no: ['VARCHAR', 'TEXT', 'STRING'],
  premium: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'],
  policy_date: ['DATE', 'TIMESTAMP', 'VARCHAR', 'TEXT'], // VARCHAR/TEXT accepted for parsing
  insurance_start_date: ['DATE', 'TIMESTAMP', 'VARCHAR', 'TEXT'],
  salesman_name: ['VARCHAR', 'TEXT', 'STRING'],
  org_level_3: ['VARCHAR', 'TEXT', 'STRING'],
  customer_category: ['VARCHAR', 'TEXT', 'STRING'],
  insurance_type: ['VARCHAR', 'TEXT', 'STRING'],
  coverage_combination: ['VARCHAR', 'TEXT', 'STRING'],
  is_renewal: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // Flexible for 0/1 or true/false
  is_renewable: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // Flexible for 0/1 or true/false
  is_new_car: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'],
  is_transfer: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'],
  is_nev: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'],
  is_telemarketing: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'],
  tonnage_segment: ['VARCHAR', 'TEXT', 'STRING'],
  renewal_policy_no: ['VARCHAR', 'TEXT', 'STRING'],
  is_commercial_insure: ['VARCHAR', 'TEXT', 'STRING'],
  vehicle_model: ['VARCHAR', 'TEXT', 'STRING'],
  new_vehicle_price: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'],
  endorsement_no: ['VARCHAR', 'TEXT', 'STRING'],
  endorsement_type: ['VARCHAR', 'TEXT', 'STRING'],
  commercial_pricing_factor: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'],
  terminal_source: ['VARCHAR', 'TEXT', 'STRING'],
  // 新增字段预期类型
  vehicle_frame_no: ['VARCHAR', 'TEXT', 'STRING'],
  is_quote: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'],
  claim_cases: ['INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL', 'NUMERIC'], // 整数类型
  reported_claims: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 数值类型
  fee_amount: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 数值类型
  renewal_mode: ['VARCHAR', 'TEXT', 'STRING'],
};

/**
 * Schema column information
 */
export interface SchemaColumn {
  column_name: string;
  column_type: string;
}

/**
 * Type validation result
 */
export interface TypeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate column data types against expected types
 *
 * @param schema - Schema information from database
 * @param mapping - Resolved column mapping
 * @returns Validation result
 */
export function validateColumnTypes(
  schema: SchemaColumn[],
  mapping: ColumnMapping
): TypeValidationResult {
  const result: TypeValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const schemaMap = new Map(schema.map((col) => [col.column_name, col.column_type.toUpperCase()]));

  for (const [domainField, actualColumn] of Object.entries(mapping) as [
    keyof ColumnMapping,
    string
  ][]) {
    const actualType = schemaMap.get(actualColumn);
    if (!actualType) {
      result.errors.push(`Column "${actualColumn}" not found in schema`);
      result.valid = false;
      continue;
    }

    const expectedTypes = EXPECTED_TYPES[domainField];
    if (!expectedTypes) {
      logger.warn(`Unknown domain field in mapping: ${String(domainField)}`);
      continue;
    }

    const typeMatches = expectedTypes.some((expected) => actualType.includes(expected));

    if (!typeMatches) {
      result.warnings.push(
        `Column "${actualColumn}" (domain: ${domainField}) has type "${actualType}", expected one of: ${expectedTypes.join(', ')}`
      );
    }
  }

  return result;
}

/**
 * Data quality check for required fields
 * Generates SQL to check for NULL values
 *
 * @param mapping - Resolved column mapping
 * @returns SQL query to check data quality
 */
export function generateDataQualityCheckSQL(mapping: ColumnMapping): string {
  const checks = Object.entries(mapping)
    .map(
      ([domainField, actualColumn]) =>
        `SUM(CASE WHEN ${actualColumn} IS NULL THEN 1 ELSE 0 END) as null_count_${domainField}`
    )
    .join(',\n    ');

  return `
    SELECT
      COUNT(*) as total_rows,
      ${checks}
    FROM raw_parquet
  `;
}

/**
 * Parse data quality check result and generate warnings
 *
 * @param result - Query result from data quality check
 * @returns Array of warning messages
 */
export function parseDataQualityResult(result: QueryResultRow): string[] {
  const warnings: string[] = [];
  const totalRows = Number(result.total_rows ?? 0);

  for (const [key, value] of Object.entries(result)) {
    if (key.startsWith('null_count_') && typeof value === 'number' && value > 0) {
      const domainField = key.replace('null_count_', '');
      const percentage = ((value / totalRows) * 100).toFixed(2);
      warnings.push(
        `Field "${domainField}" has ${value} NULL values (${percentage}% of ${totalRows} rows)`
      );
    }
  }

  return warnings;
}
