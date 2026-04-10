/**
 * 续保下钻 SQL 生成器 — 共享类型、常量与辅助函数
 *
 * 从 renewal-drilldown.ts 提取，供核心生成器和自由下钻模块共用。
 *
 * @see P1#9 架构优化计划
 */

import { buildWhereClauseFromFilters } from '../utils/queryBuilder.js';
import { createLogger } from '../utils/logger.js';
import type { AdvancedFilterState } from '../types/data.js';
import type { DateCriteria } from '../types/data.js';

/** @internal — 不导出 logger 实例以避免 TS4094（私有成员泄露），消费方自行 createLogger */
const logger = createLogger('RenewalDrilldownSQL');

// ============================================================================
// 验证与安全
// ============================================================================

export function validateYear(year: number): number {
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || Number.isNaN(year) || year < 2000 || year > currentYear + 5) {
    logger.error('Invalid year parameter', { year, currentYear });
    throw new Error(`Invalid year: ${year}. Expected integer between 2000 and ${currentYear + 5}`);
  }
  return year;
}

export function escapeSQL(str: string): string {
  if (str == null) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

// ============================================================================
// 共享常量
// ============================================================================

/**
 * is_quote 字段的布尔值检查 SQL 条件
 * 统一处理各种布尔值格式：'true', '1', 'TRUE', true
 */
export const IS_QUOTE_TRUE_CONDITION = `(is_quote = 'true' OR is_quote = '1' OR is_quote = 'TRUE' OR CAST(is_quote AS VARCHAR) = 'true')`;

/**
 * 到期日计算表达式（起保日 + 1年 - 1天）
 * 重要：2025-02-01起保 → 2026-01-31到期（1月！）
 */
export const EXPIRY_DATE_EXPR = `(DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day')`;

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 下钻层级类型
 * 五层结构：公司 → 三级机构 → 销售团队 → 业务员 → 险别组合
 */
export type DrilldownLevel = 'company' | 'org' | 'team' | 'salesman' | 'coverage';

export interface DrilldownDimension {
  level: DrilldownLevel;
  parentValue?: string;
  selfRenewalOnly?: boolean;
  bundleOnly?: boolean;
  customerCategory?: string;
  dueMonth?: number;
  filters?: {
    org?: string;
    team?: string;
    salesman?: string;
  };
}

export type DistributionType = 'coverage' | 'new_car' | 'nev' | 'transfer';

export type SortField = 'renewal_rate' | 'quote_rate' | 'due_count' | 'renewed_count';
export type SortOrder = 'asc' | 'desc';

export interface RankingConfig {
  enabled: boolean;
  topN?: number;
  lastN?: number;
  minDueCount?: number;
}

const VALID_SORT_FIELDS: readonly SortField[] = ['renewal_rate', 'quote_rate', 'due_count', 'renewed_count'];
const VALID_SORT_ORDERS: readonly SortOrder[] = ['asc', 'desc'];

/** 白名单断言 — 防止 sortField/sortOrder 注入 ORDER BY */
export function validateSortParams(sortField: SortField, sortOrder: SortOrder): void {
  if (!VALID_SORT_FIELDS.includes(sortField)) {
    throw new Error(`Invalid sortField: ${sortField}`);
  }
  if (!VALID_SORT_ORDERS.includes(sortOrder)) {
    throw new Error(`Invalid sortOrder: ${sortOrder}`);
  }
}

// ============================================================================
// WHERE 子句构造
// ============================================================================

export function buildDrilldownWhereClause(
  filters: AdvancedFilterState,
  dimension: DrilldownDimension,
  targetYear: number,
  cutoffDate?: string
): string {
  const validYear = validateYear(targetYear);
  const conditions: string[] = [];

  // 1. 按到期月份筛选
  if (dimension.dueMonth && dimension.dueMonth >= 1 && dimension.dueMonth <= 12) {
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dimension.dueMonth}`);
  } else {
    const baseYear = validYear - 1;
    conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);
  }

  // 2. 到期日范围过滤（dueMonth 存在时跳过）
  if (cutoffDate && !dimension.dueMonth) {
    const startDate = `${validYear}-01-01`;
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${startDate}' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  // 3. 套单筛选
  if (dimension.bundleOnly) {
    conditions.push(`is_commercial_insure = '套单'`);
  }

  // 4. 自留续保筛选
  if (dimension.selfRenewalOnly) {
    conditions.push(`renewal_mode = '自留'`);
  }

  // 5. 客户类别筛选
  if (dimension.customerCategory) {
    conditions.push(`customer_category = '${escapeSQL(dimension.customerCategory)}'`);
  }

  // 6. 上级筛选（支持五层下钻路径）
  if (dimension.filters?.org) {
    conditions.push(`org_level_3 = '${escapeSQL(dimension.filters.org)}'`);
  }
  if (dimension.filters?.salesman) {
    conditions.push(`salesman_name LIKE '%${escapeSQL(dimension.filters.salesman)}%'`);
  }
  // 兼容旧版 parentValue 逻辑
  if (!dimension.filters && dimension.parentValue) {
    const escapedValue = escapeSQL(dimension.parentValue);
    if (dimension.level === 'salesman') {
      conditions.push(`org_level_3 = '${escapedValue}'`);
    } else if (dimension.level === 'team') {
      conditions.push(`org_level_3 = '${escapedValue}'`);
    } else if (dimension.level === 'coverage') {
      conditions.push(`salesman_name LIKE '%${escapedValue}%'`);
    }
  }

  // 7. 其他筛选条件
  const additionalFilters: AdvancedFilterState = {
    ...filters,
    policy_date_start: undefined,
    policy_date_end: undefined,
  };
  const additionalWhere = buildWhereClauseFromFilters(
    additionalFilters,
    'insurance_start_date' as DateCriteria
  );
  if (additionalWhere && additionalWhere !== '1=1') {
    conditions.push(additionalWhere);
  }

  return conditions.join(' AND ');
}

// ============================================================================
// 维度映射
// ============================================================================

export function getGroupByField(level: DrilldownLevel): string {
  switch (level) {
    case 'company':
      return "'公司整体' AS group_name";
    case 'org':
      return 'org_level_3 AS group_name';
    case 'team':
      return 'team_name AS group_name';
    case 'salesman':
      return `REGEXP_REPLACE(salesman_name, '^[0-9]+', '') AS group_name`;
    case 'coverage':
      return 'coverage_combination AS group_name';
    default:
      throw new Error(`Unknown drilldown level: ${level}`);
  }
}

export function getAdditionalFields(level: DrilldownLevel, dimension: DrilldownDimension): string {
  switch (level) {
    case 'company':
      return "NULL AS parent_name, 'company' AS level_type";
    case 'org':
      return "'公司整体' AS parent_name, 'org' AS level_type";
    case 'team':
      return `'${escapeSQL(dimension.filters?.org || '')}' AS parent_name, 'team' AS level_type`;
    case 'salesman':
      return `'${escapeSQL(dimension.filters?.team || dimension.parentValue || '')}' AS parent_name, 'salesman' AS level_type`;
    case 'coverage':
      return `'${escapeSQL(dimension.filters?.salesman || dimension.parentValue || '')}' AS parent_name, 'coverage' AS level_type`;
    default:
      throw new Error(`Unknown drilldown level: ${level}`);
  }
}
