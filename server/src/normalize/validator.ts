/**
 * Data Validation Utilities
 *
 * ⚠️ EXPECTED_TYPES is AUTO-GENERATED from field-registry/fields.json — DO NOT EDIT MANUALLY
 * Run: node scripts/field-registry/generate.mjs
 */

import { ColumnMapping } from './mapping.js';
import { createLogger } from '../utils/logger.js';
import type { QueryResultRow } from '../types/data.js';

const logger = createLogger('Validator');

export const EXPECTED_TYPES: Record<keyof ColumnMapping, string[]> = {
  policy_no: ['VARCHAR', 'TEXT', 'STRING'], // 保单号
  premium: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 保费
  policy_date: ['DATE', 'TIMESTAMP', 'VARCHAR', 'TEXT'], // 签单日期
  insurance_start_date: ['DATE', 'TIMESTAMP', 'VARCHAR', 'TEXT'], // 保险起期
  salesman_name: ['VARCHAR', 'TEXT', 'STRING'], // 业务员
  org_level_3: ['VARCHAR', 'TEXT', 'STRING'], // 三级机构
  customer_category: ['VARCHAR', 'TEXT', 'STRING'], // 客户类别
  insurance_type: ['VARCHAR', 'TEXT', 'STRING'], // 险类
  coverage_combination: ['VARCHAR', 'TEXT', 'STRING'], // 险别组合
  is_renewal: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否续保
  is_renewable: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否可续
  is_new_car: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否新车
  is_transfer: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否过户车
  is_nev: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否新能源
  is_telemarketing: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否电销
  tonnage_segment: ['VARCHAR', 'TEXT', 'STRING'], // 吨位分段
  renewal_policy_no: ['VARCHAR', 'TEXT', 'STRING'], // 续保单号
  is_commercial_insure: ['VARCHAR', 'TEXT', 'STRING'], // 是否交商统保
  vehicle_model: ['VARCHAR', 'TEXT', 'STRING'], // 厂牌车型
  new_vehicle_price: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 新车购置价
  endorsement_no: ['VARCHAR', 'TEXT', 'STRING'], // 批单号
  endorsement_type: ['VARCHAR', 'TEXT', 'STRING'], // 批改类型
  commercial_pricing_factor: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 商车自主定价系数
  terminal_source: ['VARCHAR', 'TEXT', 'STRING'], // 终端来源
  vehicle_frame_no: ['VARCHAR', 'TEXT', 'STRING'], // 车架号
  is_quote: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 是否报价
  claim_cases: ['INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL', 'NUMERIC'], // 赔案件数
  reported_claims: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 已报告赔款
  fee_amount: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 费用金额
  renewal_mode: ['VARCHAR', 'TEXT', 'STRING'], // 续保模式
  insurance_grade: ['VARCHAR', 'TEXT', 'STRING'], // 车险风险等级
  is_cross_sell: ['BOOLEAN', 'BOOL', 'INTEGER', 'TINYINT', 'VARCHAR'], // 交叉销售标识
  cross_sell_premium_driver: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 交叉销售保费_驾意
  underwriting_date: ['DATE', 'TIMESTAMP', 'VARCHAR', 'TEXT'], // 提核日期
  third_party_coverage: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 三者保额
  driver_coverage: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 司机保额
  passenger_coverage: ['DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT', 'INTEGER', 'BIGINT'], // 乘客险保额
  plate_no: ['VARCHAR', 'TEXT', 'STRING'], // 车牌号码
  seat_count: ['INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'FLOAT'], // 座位数
  driver_age_group: ['VARCHAR', 'TEXT', 'STRING'], // 被保险人年龄分组
  first_registration_date: ['VARCHAR', 'TEXT', 'STRING', 'DATE', 'TIMESTAMP'], // 初次登记年月
  fuel_type: ['VARCHAR', 'TEXT', 'STRING'], // 燃料种类
  agent_name: ['VARCHAR', 'TEXT', 'STRING'], // 经代名
  customer_source: ['VARCHAR', 'TEXT', 'STRING'], // 客户源
};

export interface SchemaColumn {
  column_name: string;
  column_type: string;
}

export interface TypeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

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
    const expectedTypes = EXPECTED_TYPES[domainField];

    if (!actualType) {
      result.warnings.push(
        `Column "${actualColumn}" (domain: ${domainField}) not found in schema`
      );
      continue;
    }

    if (expectedTypes && !expectedTypes.some((t) => actualType.includes(t))) {
      result.warnings.push(
        `Column "${actualColumn}" (domain: ${domainField}) has type ${actualType}, expected one of: ${expectedTypes.join(', ')}`
      );
    }
  }

  return result;
}

export function validateDataQuality(
  rows: QueryResultRow[],
  mapping: ColumnMapping
): { warnings: string[] } {
  const warnings = [];
  if (rows.length === 0) {
    warnings.push('No data rows to validate');
    return { warnings };
  }

  const sampleSize = Math.min(100, rows.length);
  const sample = rows.slice(0, sampleSize);

  const premiumCol = mapping.premium;
  if (premiumCol) {
    const nullPremiums = sample.filter(
      (r) => r[premiumCol] === null || r[premiumCol] === undefined
    ).length;
    if (nullPremiums > sampleSize * 0.1) {
      warnings.push(
        `High null rate in premium column: ${nullPremiums}/${sampleSize} (${((nullPremiums / sampleSize) * 100).toFixed(1)}%)`
      );
    }
  }

  return { warnings };
}
