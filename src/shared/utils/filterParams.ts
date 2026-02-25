/**
 * 筛选参数构建器
 * Filter Params Builder
 *
 * 将 AdvancedFilterState 直接转为后端 API 查询参数，
 * 替代原来 buildWhereClauseFromFilters → parseWhereClause 的有损转换链路。
 *
 * 所有字段名与后端 filter-params.ts 的 Zod schema 保持一致。
 */

import type { AdvancedFilterState } from '../types/data';

/**
 * 将 AdvancedFilterState 转为 API 查询参数
 *
 * @param filters - 高级筛选状态
 * @returns 扁平化的查询参数（值均为 string，数组用逗号分隔）
 */
export function buildFilterParams(
  filters: AdvancedFilterState,
  rbca?: { isOrgUser?: boolean; userOrg?: string }
): Record<string, string> {
  const params: Record<string, string> = {};

  // 日期字段
  if (filters.date_criteria) {
    params.dateField = filters.date_criteria;
  }
  if (filters.policy_date_start) {
    params.startDate = filters.policy_date_start;
  }
  if (filters.policy_date_end) {
    params.endDate = filters.policy_date_end;
  }

  // 多选字段（数组 → 逗号分隔字符串）
  if (rbca?.isOrgUser && rbca?.userOrg) {
    // Forcefully inject the user's organization for API enforcement
    params.orgNames = rbca.userOrg;
  } else if (filters.org_level_3 && filters.org_level_3.length > 0) {
    params.orgNames = filters.org_level_3.join(',');
  }
  if (filters.salesman_name && filters.salesman_name.length > 0) {
    params.salesmanNames = filters.salesman_name.join(',');
  }
  if (filters.customer_category && filters.customer_category.length > 0) {
    params.customerCategories = filters.customer_category.join(',');
  }
  if (filters.coverage_combination && filters.coverage_combination.length > 0) {
    params.coverageCombinations = filters.coverage_combination.join(',');
  }
  if (filters.renewal_mode && filters.renewal_mode.length > 0) {
    params.renewalModes = filters.renewal_mode.join(',');
  }
  if (filters.tonnage_segment && filters.tonnage_segment.length > 0) {
    params.tonnageSegments = filters.tonnage_segment.join(',');
  }

  // 新增评分字段（多选）
  if (filters.insurance_grade && filters.insurance_grade.length > 0) {
    params.insuranceGrades = filters.insurance_grade.join(',');
  }
  if (filters.small_truck_score && filters.small_truck_score.length > 0) {
    params.smallTruckScores = filters.small_truck_score.join(',');
  }
  if (filters.large_truck_score && filters.large_truck_score.length > 0) {
    params.largeTruckScores = filters.large_truck_score.join(',');
  }

  // 三态布尔字段（true/false/null=全部）
  if (filters.is_renewal !== undefined && filters.is_renewal !== null) {
    params.isRenewal = String(filters.is_renewal);
  }
  if (filters.is_new_car !== undefined && filters.is_new_car !== null) {
    params.isNewCar = String(filters.is_new_car);
  }
  if (filters.is_transfer !== undefined && filters.is_transfer !== null) {
    params.isTransfer = String(filters.is_transfer);
  }
  if (filters.is_nev !== undefined && filters.is_nev !== null) {
    params.isNev = String(filters.is_nev);
  }
  if (filters.is_telemarketing !== undefined && filters.is_telemarketing !== null) {
    params.isTelemarketing = String(filters.is_telemarketing);
  }
  if (filters.is_commercial_insure !== undefined && filters.is_commercial_insure !== null) {
    params.isCommercialInsure = String(filters.is_commercial_insure);
  }
  if (filters.is_renewable !== undefined && filters.is_renewable !== null) {
    params.isRenewable = String(filters.is_renewable);
  }
  if (filters.is_cross_sell !== undefined && filters.is_cross_sell !== null) {
    params.isCrossSell = String(filters.is_cross_sell);
  }

  return params;
}
