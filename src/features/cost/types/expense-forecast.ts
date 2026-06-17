/**
 * 综合费用率预测相关类型
 * 从 costTypes.ts 拆分而来
 */

// ==================== 综合费用率预测相关类型 ====================

/**
 * 月度费用数据（按起保月统计）
 * 用于计算滚动12个月费用金额
 */
export interface MonthlyExpenseData {
  /** 起保月份，格式 YYYY-MM */
  policy_month: string;
  /** 当月保费合计（起保日期口径） */
  total_premium: number;
  /** 当月费用金额合计 */
  total_fee: number;
  /** 当月税金 = 保费 × 1.6% */
  tax: number;
  /** 当月总费用 = 费用金额 + 税金 */
  total_expense: number;
}

/**
 * 综合费用率预测数据
 */
export interface ExpenseRatioForecastData {
  /** 统计月份，格式 YYYY-MM */
  stat_month: string;

  // 分母 - 已赚保费（滚动12个月）
  /** 来自2025年保单的已赚保费 */
  earned_from_2025: number;
  /** 来自2026年保单的已赚保费 */
  earned_from_2026: number;
  /** 总已赚保费 */
  total_earned_premium: number;

  // 分子 - 费用金额（延迟1个月）
  /** 费用窗口（延迟1个月） */
  expense_window_start: string;
  expense_window_end: string;
  /** 费用金额合计 */
  total_fee: number;
  /** 税金合计 = 保费 × 1.6% */
  total_tax: number;
  /** 总费用 = 费用金额 + 税金 */
  total_expense: number;

  // 分子 - 运营成本
  /** 运营成本率（%） */
  operating_cost_rate: number;
  /** 运营成本 = 已赚保费 × 运营成本率 */
  operating_cost: number;

  // 综合费用率
  /** 综合费用率（%） = (运营成本 + 总费用) / 已赚保费 × 100 */
  comprehensive_expense_ratio: number;
}

/**
 * 综合费用率预测Hook结果
 */
export interface ExpenseRatioForecastResult {
  /** 预测数据（2026年各月） */
  forecastData: ExpenseRatioForecastData[];
  /** 月度费用明细 */
  monthlyExpenseData: MonthlyExpenseData[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}
