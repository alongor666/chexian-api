/**
 * SQL Query Builder Utilities
 * 构建WHERE子句的工具函数
 */

import type { AdvancedFilterState, DateCriteria } from '../types/data.js';
import type { UserPermission } from '../config/organizations.js';
import { UserRole } from '../config/organizations.js';

/**
 * 从高级筛选状态构建WHERE子句
 *
 * DC-001: 支持动态日期字段（通过 date_criteria 或 dateField 参数）
 *
 * @param filters - 高级筛选状态
 * @param dateField - 可选的日期字段覆盖（优先级高于 filters.date_criteria）
 * @returns WHERE子句（不包含WHERE关键字）
 *
 * @example
 * // 使用 filters.date_criteria
 * const where1 = buildWhereClauseFromFilters({
 *   date_criteria: 'policy_date',
 *   policy_date_start: '2025-01-01',
 *   policy_date_end: '2025-12-31'
 * });
 * // returns: "1=1 AND policy_date >= '2025-01-01' AND policy_date <= '2025-12-31'"
 *
 * // 覆盖日期字段
 * const where2 = buildWhereClauseFromFilters(filters, 'insurance_start_date');
 */
export function buildWhereClauseFromFilters(
  filters: AdvancedFilterState,
  dateField?: DateCriteria
): string {
  const conditions: string[] = ['1=1'];

  // DC-001: 推断日期字段（优先级：参数 > filters.date_criteria > 默认值）
  // DC-002: 使用 ?? 确保用户选择优先于默认值
  const resolvedDateField =
    dateField ?? filters.date_criteria ?? 'policy_date';

  // Date range filters (使用动态日期字段)
  if (filters.policy_date_start) {
    conditions.push(`${resolvedDateField} >= '${sanitizeDate(filters.policy_date_start)}'`);
  }
  if (filters.policy_date_end) {
    conditions.push(`${resolvedDateField} <= '${sanitizeDate(filters.policy_date_end)}'`);
  }

  // Multi-select filters - 业务员
  if (filters.salesman_name && filters.salesman_name.length > 0) {
    const values = filters.salesman_name.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`salesman_name IN (${values})`);
  }

  // Multi-select filters - 三级机构
  if (filters.org_level_3 && filters.org_level_3.length > 0) {
    const values = filters.org_level_3.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`org_level_3 IN (${values})`);
  }

  // Multi-select filters - 客户类别
  if (filters.customer_category && filters.customer_category.length > 0) {
    const values = filters.customer_category.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`customer_category IN (${values})`);
  }

  // Boolean filter for insurance_type
  // true=交强险, false=商业保险, null=全部
  if (filters.insurance_type !== undefined && filters.insurance_type !== null) {
    if (filters.insurance_type === true) {
      conditions.push(`insurance_type = '交强险'`);
    } else {
      conditions.push(`insurance_type = '商业保险'`);
    }
  }

  // Multi-select filters - 险别组合
  if (filters.coverage_combination && filters.coverage_combination.length > 0) {
    const values = filters.coverage_combination.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`coverage_combination IN (${values})`);
  }

  // Multi-select filters - 续保模式
  if (filters.renewal_mode && filters.renewal_mode.length > 0) {
    const hasNull = filters.renewal_mode.includes('__NULL__');
    const nonNullValues = filters.renewal_mode.filter((v) => v !== '__NULL__');

    const modeConditions: string[] = [];
    if (nonNullValues.length > 0) {
      const values = nonNullValues.map((v) => `'${sanitizeString(v)}'`).join(', ');
      modeConditions.push(`renewal_mode IN (${values})`);
    }
    if (hasNull) {
      modeConditions.push('renewal_mode IS NULL');
    }

    if (modeConditions.length === 1) {
      conditions.push(modeConditions[0]!);
    } else if (modeConditions.length > 1) {
      conditions.push(`(${modeConditions.join(' OR ')})`);
    }
  }

  // Multi-select filters - 续保单号
  if (filters.renewal_policy_no && filters.renewal_policy_no.length > 0) {
    const values = filters.renewal_policy_no.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`renewal_policy_no IN (${values})`);
  }

  // Multi-select filters - 吨位分段
  if (filters.tonnage_segment && filters.tonnage_segment.length > 0) {
    const values = filters.tonnage_segment.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`tonnage_segment IN (${values})`);
  }

  // Boolean filters (three-state)
  if (filters.is_renewal !== undefined && filters.is_renewal !== null) {
    conditions.push(`is_renewal = ${filters.is_renewal}`);
  }
  if (filters.is_new_car !== undefined && filters.is_new_car !== null) {
    conditions.push(`is_new_car = ${filters.is_new_car}`);
  }
  if (filters.is_transfer !== undefined && filters.is_transfer !== null) {
    conditions.push(`is_transfer = ${filters.is_transfer}`);
  }
  if (filters.is_nev !== undefined && filters.is_nev !== null) {
    conditions.push(`is_nev = ${filters.is_nev}`);
  }
  if (filters.is_telemarketing !== undefined && filters.is_telemarketing !== null) {
    conditions.push(`is_telemarketing = ${filters.is_telemarketing}`);
  }
  // is_commercial_insure 是字符串类型，值为 '套单' (而非布尔值)
  // UI 使用布尔值: true = 套单, false = 非套单
  if (filters.is_commercial_insure !== undefined && filters.is_commercial_insure !== null) {
    if (filters.is_commercial_insure === true) {
      conditions.push(`is_commercial_insure = '套单'`);
    } else {
      conditions.push(`is_commercial_insure != '套单'`);
    }
  }
  if (filters.is_renewable !== undefined && filters.is_renewable !== null) {
    conditions.push(`is_renewable = ${filters.is_renewable}`);
  }

  // Boolean filter - 交叉销售标识
  if (filters.is_cross_sell !== undefined && filters.is_cross_sell !== null) {
    conditions.push(`is_cross_sell = ${filters.is_cross_sell}`);
  }

  // Multi-select filter - 车险风险等级
  if (filters.insurance_grade && filters.insurance_grade.length > 0) {
    const values = filters.insurance_grade.map(v => `'${sanitizeString(v)}'`).join(', ');
    conditions.push(`insurance_grade IN (${values})`);
  }

  return conditions.join(' AND ');
}

/**
 * DC-001: 获取日期字段名称的辅助函数
 *
 * @param filters - 筛选器状态
 * @param overrideField - 可选的覆盖字段
 * @returns 日期字段名称
 */
/**
 * DC-002: 使用 ?? 确保用户选择优先于默认值
 */
export function resolveDateField(
  filters: AdvancedFilterState,
  overrideField?: DateCriteria
): DateCriteria {
  return overrideField ?? filters.date_criteria ?? 'policy_date';
}

/**
 * 清理日期字符串，防止SQL注入
 *
 * @param dateStr - 日期字符串 (YYYY-MM-DD)
 * @returns 清理后的日期字符串
 */
function sanitizeDate(dateStr: string): string {
  // Validate date format: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }

  // Further validate that it's a real date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }

  return dateStr;
}

/**
 * 清理字符串，防止SQL注入
 *
 * @param str - 输入字符串
 * @returns 清理后的字符串（转义单引号）
 */
function sanitizeString(str: string): string {
  // Escape single quotes by doubling them
  return str.replace(/'/g, "''");
}

/**
 * 构建IN子句的安全版本
 *
 * @param column - 列名
 * @param values - 值数组
 * @returns SQL IN子句
 */
export function buildSafeInClause(column: string, values: string[]): string {
  if (values.length === 0) {
    return '1=0'; // No values = always false
  }

  const sanitizedValues = values.map(v => `'${sanitizeString(v)}'`).join(', ');
  return `${column} IN (${sanitizedValues})`;
}

/**
 * 构建日期范围子句
 *
 * @param column - 日期列名
 * @param start - 开始日期
 * @param end - 结束日期
 * @returns SQL日期范围子句
 */
export function buildDateRangeClause(
  column: string,
  start?: string,
  end?: string
): string | null {
  const conditions: string[] = [];

  if (start) {
    conditions.push(`${column} >= '${sanitizeDate(start)}'`);
  }
  if (end) {
    conditions.push(`${column} <= '${sanitizeDate(end)}'`);
  }

  return conditions.length > 0 ? conditions.join(' AND ') : null;
}

/**
 * 构建基于权限的机构过滤条件
 *
 * 根据用户权限限制可查看的机构数据：
 * - 分公司管理员：不过滤，可查看所有机构
 * - 三级机构用户：只能查看本机构数据（选择"全部"时自动转为本机构）
 *
 * @param permission - 用户权限配置
 * @param selectedOrgs - 用户选择的机构列表（来自筛选器）
 * @returns SQL权限过滤条件，如果不需要过滤则返回空字符串
 */
export function buildPermissionWhereClause(
  permission: UserPermission | null,
  _selectedOrgs: string[] = []
): string {
  // 未登录或管理员：不限制
  if (!permission || permission.role === UserRole.BRANCH_ADMIN) {
    return '';
  }

  // 三级机构用户：强制限制为本机构
  if (permission.role === UserRole.ORG_USER && permission.organization) {
    const userOrg = permission.organization;
    return `org_level_3 = '${sanitizeString(userOrg)}'`;
  }

  return '';
}

/**
 * 构建带权限控制的WHERE子句
 *
 * 将权限过滤条件与用户选择的筛选条件合并
 *
 * @param filters - 高级筛选状态
 * @param permission - 用户权限配置
 * @param dateField - 可选的日期字段覆盖
 * @returns 完整的WHERE子句
 */
export function buildWhereClauseWithPermission(
  filters: AdvancedFilterState,
  permission: UserPermission | null,
  dateField?: DateCriteria
): string {
  const baseConditions = buildWhereClauseFromFilters(filters, dateField);

  // 如果筛选器中已选择机构，需要结合权限判断
  if (filters.org_level_3 && filters.org_level_3.length > 0) {
    const permissionCondition = buildPermissionWhereClause(permission, filters.org_level_3);

    if (permissionCondition) {
      // 有权限限制，需要替换用户选择的机构条件
      const conditions = baseConditions.split(' AND ').filter(c => !c.startsWith('org_level_3'));
      conditions.push(permissionCondition);
      return conditions.join(' AND ');
    }
  }

  // 无机构筛选，直接应用权限过滤
  const permissionCondition = buildPermissionWhereClause(permission, []);
  if (permissionCondition) {
    return `${baseConditions} AND ${permissionCondition}`;
  }

  return baseConditions;
}
