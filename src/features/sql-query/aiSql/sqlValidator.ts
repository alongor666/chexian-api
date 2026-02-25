/**
 * SQL 验证器
 *
 * 1. 隐私保护验证（主验证器）
 * 2. DuckDB EXPLAIN 语法验证
 */

import { validateSQL } from '../../../shared/utils/sql-validator';
import { apiClient } from '../../../shared/api/client';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * PolicyFact 视图可用字段列表（与后端 SQL 语义保持一致）
 *
 * 更新日期: 2026-02-01
 * 来源: server/src/services/duckdb.ts + server/src/sql/*
 */
const POLICY_FACT_FIELDS = new Set([
  // 标识字段
  'policy_no',
  // 日期字段
  'policy_date', 'insurance_start_date',
  // 组织/人员维度
  'salesman_name', 'org_level_3', 'region_group',
  // 业务维度
  'customer_category', 'insurance_type', 'coverage_combination',
  'tonnage_segment', 'terminal_source', 'is_commercial_insure',
  'renewal_mode',
  // 布尔字段
  'is_renewal', 'is_new_car', 'is_nev', 'is_transfer',
  'is_telemarketing', 'is_renewable', 'is_quote',
  // 度量字段
  'premium', 'commercial_pricing_factor',
  'claim_cases', 'reported_claims', 'fee_amount',
  // 其他字段
  'vehicle_frame_no',
]);

/**
 * SalesmanPlanFact 视图可用字段列表
 *
 * 更新日期: 2026-02-01
 * 来源: server/src/services/duckdb.ts + server/src/routes/query.ts
 */
const SALESMAN_PLAN_FIELDS = new Set([
  // 维度字段
  'salesman_name', 'salesman_id', 'team_name', 'org_name',
  'entry_date', 'plan_year',
  // 计划指标（万元）
  'plan_vehicle', 'plan_property', 'plan_life', 'plan_total',
  // 实际完成（万元）
  'actual_vehicle', 'actual_property', 'actual_life', 'actual_total',
  // 达成率
  'rate_vehicle', 'rate_property', 'rate_life', 'rate_total',
  // 其他
  'months_in_service',
]);

/**
 * 合并所有可用字段（用于验证）
 */
const VALID_FIELDS = new Set([...POLICY_FACT_FIELDS, ...SALESMAN_PLAN_FIELDS]);

/**
 * 不存在的字段映射（用于智能提示）
 * key: 用户可能使用的错误字段名
 * value: 正确的替代字段或提示
 */
const FIELD_ALTERNATIVES: Record<string, string> = {
  // 批单相关字段（任何视图都不包含）
  'endorsement_no': '批单号不在任何视图中，请查询原始数据',
  'endorsement_type': '批改类型不在任何视图中',
  // 保费拆分字段（需要通过 insurance_type 筛选）
  'commercial_premium': "商业险保费请用 WHERE insurance_type='商业保险'",
  'compulsory_premium': "交强险保费请用 WHERE insurance_type='交强险'",
  // 组织层级
  'org_level_4': '四级机构请用 salesman_name 或 org_level_3/org_name',
  // 日期字段
  'insurance_end_date': '保险止期不可用，请用 insurance_start_date',
  // 车辆字段
  'vehicle_type': '车辆类型请用 customer_category',
  'plate_type': '车牌类型不可用',
  'new_vehicle_price': '新车购置价不在视图中',
  // 续保字段
  'renewal_policy_no': '续保单号仅在 PolicyFactRenewal 视图可用',
};

// SQL 关键字（保留，未来可用于语法高亮或更智能的错误提示）
// const SQL_KEYWORDS = new Set([
//   'select', 'from', 'where', 'group', 'by', 'order', 'having', 'limit',
//   'and', 'or', 'not', 'in', 'between', 'like', 'is', 'null', 'as',
//   'asc', 'desc', 'distinct', 'count', 'sum', 'avg', 'min', 'max',
//   'case', 'when', 'then', 'else', 'end', 'cast', 'extract',
//   'year', 'month', 'day', 'date', 'timestamp', 'interval',
//   'inner', 'left', 'right', 'outer', 'join', 'on', 'using',
//   'union', 'all', 'except', 'intersect', 'with', 'recursive',
//   'policyfact', 'true', 'false',
// ]);

/**
 * 快速语法检查（不调用 DuckDB）
 */
export function quickSyntaxCheck(sql: string): ValidationResult {
  const trimmed = sql.trim();

  // 检查是否为空
  if (!trimmed) {
    return { valid: false, error: 'SQL 为空' };
  }

  // 检查是否以 SELECT 开头
  if (!trimmed.toUpperCase().startsWith('SELECT')) {
    return { valid: false, error: 'SQL 必须以 SELECT 开头', suggestion: '仅支持查询语句' };
  }

  // 检查是否包含危险操作
  const dangerous = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'TRUNCATE', 'ALTER', 'CREATE'];
  for (const keyword of dangerous) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(trimmed)) {
      return { valid: false, error: `禁止使用 ${keyword} 操作`, suggestion: '仅支持 SELECT 查询' };
    }
  }

  // 检查是否包含有效的数据源（PolicyFact 或 SalesmanPlanFact）
  const hasPolicyFact = /FROM\s+PolicyFact/i.test(trimmed) || /JOIN\s+PolicyFact/i.test(trimmed);
  const hasSalesmanPlan = /FROM\s+SalesmanPlanFact/i.test(trimmed) || /JOIN\s+SalesmanPlanFact/i.test(trimmed);

  if (!hasPolicyFact && !hasSalesmanPlan) {
    return {
      valid: false,
      error: '必须从 PolicyFact 或 SalesmanPlanFact 表查询',
      suggestion: '添加 FROM PolicyFact 或 FROM SalesmanPlanFact',
    };
  }

  return { valid: true };
}

/**
 * 使用 DuckDB EXPLAIN 验证 SQL
 *
 * 验证顺序：
 * 1. 快速语法检查
 * 2. 主验证器（隐私保护 + 只读限制）
 * 3. DuckDB EXPLAIN（语法正确性）
 */
export async function validateWithDuckDB(sql: string): Promise<ValidationResult> {
  // 1. 快速检查
  const quickResult = quickSyntaxCheck(sql);
  if (!quickResult.valid) {
    return quickResult;
  }

  // 2. 主验证器：隐私保护 + 只读限制 + 聚合要求
  const mainValidation = validateSQL(sql);
  if (!mainValidation.valid) {
    return {
      valid: false,
      error: mainValidation.error,
      suggestion: '请修改 SQL 以符合安全规则',
    };
  }

  try {
    // 3. 通过后端 API 验证 SQL 语法（EXPLAIN 查询）
    const explainSql = `EXPLAIN ${sql}`;
    await apiClient.executeCustomQuery(explainSql);
    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 解析错误信息，提供友好提示
    if (errorMessage.includes('does not exist')) {
      const match = errorMessage.match(/column\s+"?(\w+)"?\s+does not exist/i);
      if (match) {
        const wrongField = match[1];
        const suggestion = findSimilarField(wrongField);
        return {
          valid: false,
          error: `字段 "${wrongField}" 不存在`,
          suggestion: suggestion ? `您是否想用 "${suggestion}"？` : '请检查字段名',
        };
      }
    }

    if (errorMessage.includes('syntax error')) {
      return {
        valid: false,
        error: 'SQL 语法错误',
        suggestion: '请检查括号、引号是否匹配',
      };
    }

    return {
      valid: false,
      error: errorMessage.slice(0, 100),
    };
  }
}

/**
 * 查找相似字段名或提供替代建议（用于错误提示）
 */
function findSimilarField(wrongField: string): string | null {
  const lower = wrongField.toLowerCase();

  // 1. 检查是否有明确的替代建议
  if (FIELD_ALTERNATIVES[lower]) {
    return FIELD_ALTERNATIVES[lower];
  }

  // 2. 直接匹配（用户字段名拼写正确但未在 VALID_FIELDS）
  if (VALID_FIELDS.has(lower)) {
    return lower;
  }

  // 3. 模糊匹配
  const candidates: Array<{ field: string; score: number }> = [];

  for (const field of VALID_FIELDS) {
    // 包含关系
    if (field.includes(lower) || lower.includes(field)) {
      candidates.push({ field, score: 3 });
      continue;
    }

    // 编辑距离（简化版）
    const distance = levenshteinDistance(lower, field);
    if (distance <= 3) {
      candidates.push({ field, score: 3 - distance });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].field;
  }

  return null;
}

/**
 * 计算编辑距离（Levenshtein Distance）
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
