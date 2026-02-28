/**
 * 综合分析页阈值配置
 * Comprehensive Analysis Thresholds
 *
 * 说明：
 * - 作为后端权威配置源，前端只消费 API 返回值
 * - 默认值与 autowrKPI 现有阈值保持一致
 */

export interface ComprehensiveThresholds {
  /** 年保费未达标阈值（%） */
  premiumProgressWarn: number;
  /** 变动成本率预警阈值（%） */
  costRateWarn: number;
  /** 满期赔付率预警阈值（%） */
  lossRateWarn: number;
  /** 费用率预警阈值（%） */
  expenseRateWarn: number;
  /** 费用预算阈值（%） */
  expenseBudget: number;
}

export const DEFAULT_COMPREHENSIVE_THRESHOLDS: ComprehensiveThresholds = {
  premiumProgressWarn: 99,
  costRateWarn: 91,
  lossRateWarn: 70,
  expenseRateWarn: 16,
  expenseBudget: 14,
};

