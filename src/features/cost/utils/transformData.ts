/**
 * 成本分析数据转换工具函数
 *
 * 将原始数据转换为表格显示格式
 */

import { formatAverage, formatCount, formatCurrency, formatPercent, formatPremiumWan } from '../../../shared/utils/formatters';
import type {
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  EarnedPremiumData,
  EarnedPremiumSummaryData,
} from '../types/costTypes';

/**
 * 费用率表格显示数据类型
 */
export interface DisplayExpenseData {
  [key: string]: string;
  dim_key: string;
  policy_count: string;
  total_premium: string;
  total_fee: string;
  expense_ratio: string;
}

/**
 * 综合成本表格显示数据类型
 */
export interface DisplayComprehensiveData {
  [key: string]: string;
  dim_key: string;
  policy_count: string;
  total_premium: string;
  earned_premium: string;
  total_reported_claims: string;
  total_fee: string;
  earned_claim_ratio: string;
  expense_ratio: string;
  comprehensive_expense_ratio: string;
}

/**
 * 变动成本表格显示数据类型
 */
export interface DisplayVariableData {
  [key: string]: string;
  dim_key: string;
  policy_count: string;
  total_premium: string;
  earned_premium: string;
  total_reported_claims: string;
  total_fee: string;
  earned_claim_ratio: string;
  expense_ratio: string;
  variable_cost_ratio: string;
}

/**
 * 转换费用率数据为显示格式
 * 遵循全局格式化规范：
 * - 件数：整数，千分位 → formatCount
 * - 保费/费用：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
export function transformExpenseData(data: ExpenseRatioData[]): DisplayExpenseData[] {
  return data.map((row) => ({
    dim_key: row.dim_key || '未知',
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    total_fee: formatPremiumWan(row.total_fee),
    expense_ratio: formatPercent(row.expense_ratio),
  }));
}

/**
 * 转换综合成本数据为显示格式
 * 遵循全局格式化规范：
 * - 件数：整数，千分位 → formatCount
 * - 保费/费用/赔款：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
export function transformComprehensiveData(
  data: ComprehensiveCostData[]
): DisplayComprehensiveData[] {
  return data.map((row) => ({
    dim_key: row.dim_key || '未知',
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    earned_premium: formatPremiumWan(row.earned_premium),
    total_reported_claims: formatPremiumWan(row.total_reported_claims),
    total_fee: formatPremiumWan(row.total_fee),
    earned_claim_ratio: formatPercent(row.earned_claim_ratio),
    expense_ratio: formatPercent(row.expense_ratio),
    comprehensive_expense_ratio: formatPercent(row.comprehensive_expense_ratio),
  }));
}

/**
 * 转换变动成本数据为显示格式
 * 遵循全局格式化规范：
 * - 件数：整数，千分位 → formatCount
 * - 保费/费用/赔款：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
export function transformVariableData(data: VariableCostData[]): DisplayVariableData[] {
  return data.map((row) => ({
    dim_key: row.dim_key || '未知',
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    earned_premium: formatPremiumWan(row.earned_premium),
    total_reported_claims: formatPremiumWan(row.total_reported_claims),
    total_fee: formatPremiumWan(row.total_fee),
    earned_claim_ratio: formatPercent(row.earned_claim_ratio),
    expense_ratio: formatPercent(row.expense_ratio),
    variable_cost_ratio: formatPercent(row.variable_cost_ratio),
  }));
}

// ==================== 已赚保费数据转换 ====================

/**
 * 已赚保费明细表格显示数据类型
 */
export interface DisplayEarnedPremiumData {
  [key: string]: string;
  org_level_3: string;
  insurance_type: string;
  policy_month: string;
  policy_count: string;
  total_premium: string;
  total_fee: string;
  fee_rate: string;
  line_factor: string;
  avg_elapsed_days: string;
  first_day_part: string;
  time_part: string;
  earned_premium_cum: string;
}

/**
 * 已赚保费汇总表格显示数据类型
 */
export interface DisplayEarnedPremiumSummaryData {
  [key: string]: string;
  org_level_3: string;
  policy_count: string;
  total_premium: string;
  total_fee: string;
  avg_fee_rate: string;
  total_first_day_part: string;
  total_time_part: string;
  total_earned_premium: string;
  earned_ratio: string;
}

/**
 * 转换已赚保费明细数据为显示格式
 * 遵循全局格式化规范：
 * - 件数：整数，千分位 → formatCount
 * - 保费/费用：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
export function transformEarnedPremiumData(data: EarnedPremiumData[]): DisplayEarnedPremiumData[] {
  return data.map((row) => ({
    org_level_3: row.org_level_3 || '未知',
    insurance_type: row.insurance_type || '未知',
    policy_month: row.policy_month || '未知',
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    total_fee: formatPremiumWan(row.total_fee),
    fee_rate: formatPercent(row.fee_rate),
    line_factor: row.line_factor === null || row.line_factor === undefined ? '-' : formatCurrency(row.line_factor),
    avg_elapsed_days: row.avg_elapsed_days === null || row.avg_elapsed_days === undefined ? '-' : formatAverage(row.avg_elapsed_days),
    first_day_part: formatPremiumWan(row.first_day_part),
    time_part: formatPremiumWan(row.time_part),
    earned_premium_cum: formatPremiumWan(row.earned_premium_cum),
  }));
}

/**
 * 转换已赚保费汇总数据为显示格式
 * 遵循全局格式化规范：
 * - 件数：整数，千分位 → formatCount
 * - 保费/费用：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
export function transformEarnedPremiumSummaryData(
  data: EarnedPremiumSummaryData[]
): DisplayEarnedPremiumSummaryData[] {
  return data.map((row) => ({
    org_level_3: row.org_level_3 || '未知',
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    total_fee: formatPremiumWan(row.total_fee),
    avg_fee_rate: formatPercent(row.avg_fee_rate),
    total_first_day_part: formatPremiumWan(row.total_first_day_part),
    total_time_part: formatPremiumWan(row.total_time_part),
    total_earned_premium: formatPremiumWan(row.total_earned_premium),
    earned_ratio: formatPercent(row.earned_ratio),
  }));
}
