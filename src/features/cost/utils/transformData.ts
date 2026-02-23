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
  Policy2025In2025Data,
  Policy2025In2026Data,
  Policy2026In2026Data,
  Policy2026In2027Data,
  Rolling12MonthData,
  PolicyMonthDetail,
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
  comprehensive_cost_ratio: string;
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
    comprehensive_cost_ratio: formatPercent(row.comprehensive_cost_ratio),
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

// ==================== 滚动12个月已赚保费计算 ====================

/**
 * 计算月份偏移
 * @param month 格式 YYYY-MM
 * @param offset 偏移量（负数表示往前）
 * @returns 偏移后的月份，格式 YYYY-MM
 */
function getMonthOffset(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 比较两个月份字符串
 * @returns 负数表示a<b，0表示相等，正数表示a>b
 */
function compareMonth(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * 从V3数据构建起保月详情映射
 * 将4个表的数据合并成统一的 Map<起保月key, 详情>
 */
export function buildPolicyMonthDetails(
  policy2025In2025Data: Policy2025In2025Data[],
  policy2025In2026Data: Policy2025In2026Data[],
  policy2026In2026Data: Policy2026In2026Data[],
  policy2026In2027Data: Policy2026In2027Data[]
): Map<string, PolicyMonthDetail> {
  const details = new Map<string, PolicyMonthDetail>();

  // 处理2025年保单在2025年的数据
  for (const row of policy2025In2025Data) {
    const key = `2025-${String(row.policy_month).padStart(2, '0')}`;
    const increments = new Map<string, number>();

    // 2025年各月的时间分摊增量
    increments.set('2025-01', row.earned_2025_01 || 0);
    increments.set('2025-02', row.earned_2025_02 || 0);
    increments.set('2025-03', row.earned_2025_03 || 0);
    increments.set('2025-04', row.earned_2025_04 || 0);
    increments.set('2025-05', row.earned_2025_05 || 0);
    increments.set('2025-06', row.earned_2025_06 || 0);
    increments.set('2025-07', row.earned_2025_07 || 0);
    increments.set('2025-08', row.earned_2025_08 || 0);
    increments.set('2025-09', row.earned_2025_09 || 0);
    increments.set('2025-10', row.earned_2025_10 || 0);
    increments.set('2025-11', row.earned_2025_11 || 0);
    increments.set('2025-12', row.earned_2025_12 || 0);

    details.set(key, {
      policyYear: 2025,
      policyMonth: row.policy_month,
      premium: row.premium || 0,
      firstDayFee: row.first_day_fee || 0,
      earnedIncrements: increments,
    });
  }

  // 补充2025年保单在2026年的时间分摊增量
  for (const row of policy2025In2026Data) {
    const key = `2025-${String(row.policy_month).padStart(2, '0')}`;
    const existing = details.get(key);
    if (existing) {
      existing.earnedIncrements.set('2026-01', row.earned_2026_01 || 0);
      existing.earnedIncrements.set('2026-02', row.earned_2026_02 || 0);
      existing.earnedIncrements.set('2026-03', row.earned_2026_03 || 0);
      existing.earnedIncrements.set('2026-04', row.earned_2026_04 || 0);
      existing.earnedIncrements.set('2026-05', row.earned_2026_05 || 0);
      existing.earnedIncrements.set('2026-06', row.earned_2026_06 || 0);
      existing.earnedIncrements.set('2026-07', row.earned_2026_07 || 0);
      existing.earnedIncrements.set('2026-08', row.earned_2026_08 || 0);
      existing.earnedIncrements.set('2026-09', row.earned_2026_09 || 0);
      existing.earnedIncrements.set('2026-10', row.earned_2026_10 || 0);
      existing.earnedIncrements.set('2026-11', row.earned_2026_11 || 0);
      existing.earnedIncrements.set('2026-12', row.earned_2026_12 || 0);
    }
  }

  // 处理2026年保单在2026年的数据
  for (const row of policy2026In2026Data) {
    const key = `2026-${String(row.policy_month).padStart(2, '0')}`;
    const increments = new Map<string, number>();

    // 2026年各月的时间分摊增量
    increments.set('2026-01', row.earned_2026_01 || 0);
    increments.set('2026-02', row.earned_2026_02 || 0);
    increments.set('2026-03', row.earned_2026_03 || 0);
    increments.set('2026-04', row.earned_2026_04 || 0);
    increments.set('2026-05', row.earned_2026_05 || 0);
    increments.set('2026-06', row.earned_2026_06 || 0);
    increments.set('2026-07', row.earned_2026_07 || 0);
    increments.set('2026-08', row.earned_2026_08 || 0);
    increments.set('2026-09', row.earned_2026_09 || 0);
    increments.set('2026-10', row.earned_2026_10 || 0);
    increments.set('2026-11', row.earned_2026_11 || 0);
    increments.set('2026-12', row.earned_2026_12 || 0);

    details.set(key, {
      policyYear: 2026,
      policyMonth: row.policy_month,
      premium: row.premium || 0,
      firstDayFee: row.first_day_fee || 0,
      earnedIncrements: increments,
    });
  }

  // 补充2026年保单在2027年的时间分摊增量
  for (const row of policy2026In2027Data) {
    const key = `2026-${String(row.policy_month).padStart(2, '0')}`;
    const existing = details.get(key);
    if (existing) {
      existing.earnedIncrements.set('2027-01', row.earned_2027_01 || 0);
      existing.earnedIncrements.set('2027-02', row.earned_2027_02 || 0);
      existing.earnedIncrements.set('2027-03', row.earned_2027_03 || 0);
      existing.earnedIncrements.set('2027-04', row.earned_2027_04 || 0);
      existing.earnedIncrements.set('2027-05', row.earned_2027_05 || 0);
      existing.earnedIncrements.set('2027-06', row.earned_2027_06 || 0);
      existing.earnedIncrements.set('2027-07', row.earned_2027_07 || 0);
      existing.earnedIncrements.set('2027-08', row.earned_2027_08 || 0);
      existing.earnedIncrements.set('2027-09', row.earned_2027_09 || 0);
      existing.earnedIncrements.set('2027-10', row.earned_2027_10 || 0);
      existing.earnedIncrements.set('2027-11', row.earned_2027_11 || 0);
      existing.earnedIncrements.set('2027-12', row.earned_2027_12 || 0);
    }
  }

  return details;
}

/**
 * 计算滚动12个月已赚保费
 *
 * 计算逻辑：
 * - 滚动12个月保费：窗口[S-11, S]内起保的保单保费之和
 * - 滚动12个月首日费用：窗口内起保的保单首日费用之和
 * - 滚动12个月时间分摊：所有保单在窗口内各月的时间分摊增量之和
 * - 滚动12个月已赚保费：首日费用 + 时间分摊
 *
 * @param policy2025In2025Data 2025年保单在2025年的数据
 * @param policy2025In2026Data 2025年保单在2026年的数据
 * @param policy2026In2026Data 2026年保单在2026年的数据
 * @param policy2026In2027Data 2026年保单在2027年的数据
 * @param startStatMonth 开始统计月，格式 YYYY-MM，默认 "2025-02"
 * @param endStatMonth 结束统计月，格式 YYYY-MM，默认 "2027-12"
 * @returns 滚动12个月数据数组
 */
export function calculateRolling12MonthEarnedPremium(
  policy2025In2025Data: Policy2025In2025Data[],
  policy2025In2026Data: Policy2025In2026Data[],
  policy2026In2026Data: Policy2026In2026Data[],
  policy2026In2027Data: Policy2026In2027Data[],
  startStatMonth: string = '2025-02',
  endStatMonth: string = '2027-12'
): Rolling12MonthData[] {
  // 构建起保月详情映射
  const policyDetails = buildPolicyMonthDetails(
    policy2025In2025Data,
    policy2025In2026Data,
    policy2026In2026Data,
    policy2026In2027Data
  );

  const result: Rolling12MonthData[] = [];

  // 遍历统计月范围
  let currentMonth = startStatMonth;
  while (compareMonth(currentMonth, endStatMonth) <= 0) {
    // 计算滚动12个月窗口：[currentMonth - 11个月, currentMonth]
    const windowStart = getMonthOffset(currentMonth, -11);
    const windowEnd = currentMonth;

    let rollingPremium = 0;
    let rollingFirstDayFee = 0;
    let rollingTimePart = 0;

    // 遍历所有起保月的数据
    for (const [policyMonthKey, data] of policyDetails) {
      // 检查起保月是否在滚动窗口内（用于计算保费和首日费用）
      if (
        compareMonth(policyMonthKey, windowStart) >= 0 &&
        compareMonth(policyMonthKey, windowEnd) <= 0
      ) {
        rollingPremium += data.premium;
        rollingFirstDayFee += data.firstDayFee;
      }

      // 累加该起保月的保单在窗口内各月的时间分摊增量
      for (const [earnedMonth, increment] of data.earnedIncrements) {
        if (
          compareMonth(earnedMonth, windowStart) >= 0 &&
          compareMonth(earnedMonth, windowEnd) <= 0
        ) {
          rollingTimePart += increment;
        }
      }
    }

    const rollingEarnedPremium = rollingFirstDayFee + rollingTimePart;
    const earnedRatio = rollingPremium > 0 ? rollingEarnedPremium / rollingPremium : 0;

    result.push({
      statMonth: currentMonth,
      rollingPremium,
      rollingFirstDayFee,
      rollingTimePart,
      rollingEarnedPremium,
      earnedRatio,
    });

    // 移动到下一个月
    currentMonth = getMonthOffset(currentMonth, 1);
  }

  return result;
}

/**
 * 滚动12个月表格显示数据类型
 */
export interface DisplayRolling12MonthData {
  [key: string]: string;
  statMonth: string;
  rollingPremium: string;
  rollingFirstDayFee: string;
  rollingTimePart: string;
  rollingEarnedPremium: string;
  earnedRatio: string;
}

/**
 * 转换滚动12个月数据为显示格式
 */
export function transformRolling12MonthData(
  data: Rolling12MonthData[]
): DisplayRolling12MonthData[] {
  return data.map((row) => ({
    statMonth: row.statMonth,
    rollingPremium: formatPremiumWan(row.rollingPremium),
    rollingFirstDayFee: formatPremiumWan(row.rollingFirstDayFee),
    rollingTimePart: formatPremiumWan(row.rollingTimePart),
    rollingEarnedPremium: formatPremiumWan(row.rollingEarnedPremium),
    earnedRatio: formatPercent(row.earnedRatio),
  }));
}
