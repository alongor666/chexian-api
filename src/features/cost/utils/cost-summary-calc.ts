/**
 * 成本分析纯计算工具
 *
 * 从 useCostAnalysis hook 抽出的纯函数：
 * - initialSummary 常量
 * - summary 构造器（claim / expense / full）
 * - calculateRolling12MonthSummary（v3 滚动 12 月口径，纯内存）
 * - calculateExpenseRatioForecast（综合费用率预测，前端 window filter + operating cost）
 *
 * 抽出动机：useCostAnalysis 入口降到 ≤ 400 行；纯函数可独立测试。
 */

import type {
  ClaimRatioData,
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  CostSummary,
  SameYearEarnedRow,
  CrossYearEarnedRow,
  NewEarnedPremiumSummaryData,
  MonthlyExpenseData,
  ExpenseRatioForecastData,
} from '../types/costTypes';
import { getEarnedMonthValue } from '../types/new-earned-premium';

// ==================== 常量 ====================

export const initialSummary: CostSummary = {
  totalPremium: 0,
  totalClaims: 0,
  totalFee: 0,
  policyCount: 0,
  avgClaimRatio: null,
  avgExpenseRatio: null,
};

// ==================== Summary 构造器 ====================

/**
 * 赔付率 summary：含 avgClaimRatio，不含 avgExpenseRatio。
 * avgClaimRatio = SUM(total_reported_claims) / SUM(earned_premium) * 100（防除零）。
 */
export function buildClaimRatioSummary(data: ClaimRatioData[]): CostSummary {
  const totalClaims = data.reduce((sum, r) => sum + (r.total_reported_claims || 0), 0);
  const totalEarnedPremium = data.reduce((sum, r) => sum + (r.earned_premium || 0), 0);
  return {
    totalPremium: data.reduce((sum, r) => sum + (r.total_premium || 0), 0),
    totalClaims,
    totalFee: 0,
    policyCount: data.reduce((sum, r) => sum + (r.policy_count || 0), 0),
    avgClaimRatio: totalEarnedPremium > 0 ? (totalClaims / totalEarnedPremium) * 100 : null,
    avgExpenseRatio: null,
  };
}

/**
 * 费用率 summary：含 avgExpenseRatio，不含 avgClaimRatio。
 * avgExpenseRatio = SUM(total_fee) / SUM(total_premium) * 100（防除零）。
 */
export function buildExpenseRatioSummary(data: ExpenseRatioData[]): CostSummary {
  const totalPremium = data.reduce((sum, r) => sum + (r.total_premium || 0), 0);
  const totalFee = data.reduce((sum, r) => sum + (r.total_fee || 0), 0);
  return {
    totalPremium,
    totalClaims: 0,
    totalFee,
    policyCount: data.reduce((sum, r) => sum + (r.policy_count || 0), 0),
    avgClaimRatio: null,
    avgExpenseRatio: totalPremium > 0 ? (totalFee / totalPremium) * 100 : null,
  };
}

/**
 * 完整 summary：同时含 avgClaimRatio + avgExpenseRatio。
 * 用于综合成本（comprehensive）/ 变动成本（variable）/ 变动成本 KPI（variableKpi）。
 */
export function buildFullSummary(
  data: ComprehensiveCostData[] | VariableCostData[]
): CostSummary {
  const totalPremium = data.reduce((sum, r) => sum + (r.total_premium || 0), 0);
  const totalClaims = data.reduce((sum, r) => sum + (r.total_reported_claims || 0), 0);
  const totalFee = data.reduce((sum, r) => sum + (r.total_fee || 0), 0);
  const totalEarnedPremium = data.reduce((sum, r) => sum + (r.earned_premium || 0), 0);
  return {
    totalPremium,
    totalClaims,
    totalFee,
    policyCount: data.reduce((sum, r) => sum + (r.policy_count || 0), 0),
    avgClaimRatio: totalEarnedPremium > 0 ? (totalClaims / totalEarnedPremium) * 100 : null,
    avgExpenseRatio: totalPremium > 0 ? (totalFee / totalPremium) * 100 : null,
  };
}

// ==================== Rolling 12-Month 汇总（v3 简化） ====================

/**
 * 前端计算滚动12个月汇总（纯内存，~1ms vs SQL ~3000ms）。
 *
 * 核心逻辑：从四象限矩阵数据做简单加法（锚定年 Y = anchorYear）
 * - 例：统计月 Y 年 3 月，滚动窗口 = [Y-1 年 4 月, Y 年 3 月]
 * - 滚动 12 月保费 = Y-1 年保单(起保月 4-12)保费 + Y 年保单(起保月 1-3)保费
 * - 滚动 12 月已赚 = 对应窗口内各月 earned 字段之和
 *
 * v3 简化（首日费用已并入起保月）：earned_MM 字段已含首日费用，
 * 累加窗口内各月 earned 即可（自然截断：起保日不在窗口外 → 自动排除）。
 */
export function calculateRolling12MonthSummary(
  policyPrevInPrev: SameYearEarnedRow[],
  policyPrevInCurr: CrossYearEarnedRow[],
  policyCurrInCurr: SameYearEarnedRow[],
  anchorYear: number
): NewEarnedPremiumSummaryData[] {
  const result: NewEarnedPremiumSummaryData[] = [];

  for (let statMonth = 1; statMonth <= 12; statMonth++) {
    const windowStartMonthPrev = statMonth + 1;

    const premiumPrev =
      windowStartMonthPrev <= 12
        ? policyPrevInPrev
            .filter((p) => p.policy_month >= windowStartMonthPrev)
            .reduce((sum, p) => sum + p.premium, 0)
        : 0;

    const premiumCurr = policyCurrInCurr
      .filter((p) => p.policy_month <= statMonth)
      .reduce((sum, p) => sum + p.premium, 0);

    const rollingPremium = premiumPrev + premiumCurr;

    let earnedFromPrev = 0;

    if (windowStartMonthPrev <= 12) {
      for (const p of policyPrevInPrev) {
        for (let m = windowStartMonthPrev; m <= 12; m++) {
          earnedFromPrev += getEarnedMonthValue(p, m);
        }
      }
    }

    for (const p of policyPrevInCurr) {
      for (let m = 1; m <= statMonth; m++) {
        earnedFromPrev += getEarnedMonthValue(p, m);
      }
    }

    let earnedFromCurr = 0;

    for (const p of policyCurrInCurr) {
      for (let m = 1; m <= statMonth; m++) {
        earnedFromCurr += getEarnedMonthValue(p, m);
      }
    }

    const totalEarned = earnedFromPrev + earnedFromCurr;
    const earnedRatio =
      rollingPremium > 0 ? Math.round((totalEarned / rollingPremium) * 10000) / 100 : 0;

    result.push({
      stat_month: `${anchorYear}-${statMonth.toString().padStart(2, '0')}`,
      rolling_12m_premium: Math.round(rollingPremium * 100) / 100,
      earned_from_prev: Math.round(earnedFromPrev * 100) / 100,
      earned_from_curr: Math.round(earnedFromCurr * 100) / 100,
      total_earned_premium: Math.round(totalEarned * 100) / 100,
      earned_ratio: earnedRatio,
    });
  }

  return result;
}

// ==================== 综合费用率预测 ====================

/**
 * 综合费用率预测：前端窗口过滤 + 运营成本叠加。
 * window 范围：以 stat_month 为锚点，end = stat_month - 1 月末，start = end 倒退 11 月。
 * comprehensive_expense_ratio = (operating_cost + total_expense) / total_earned_premium * 100。
 */
export function calculateExpenseRatioForecast(
  summaryData: NewEarnedPremiumSummaryData[],
  monthlyExpenseData: MonthlyExpenseData[],
  operatingCostRate: number
): ExpenseRatioForecastData[] {
  return summaryData.map((summary) => {
    const [year, month] = summary.stat_month.split('-').map(Number);

    const expenseWindowEnd = new Date(year, month - 1, 0);
    const expenseWindowStart = new Date(year, month - 1 - 11, 1);

    const expenseWindowStartStr = `${expenseWindowStart.getFullYear()}-${String(
      expenseWindowStart.getMonth() + 1
    ).padStart(2, '0')}`;
    const expenseWindowEndStr = `${expenseWindowEnd.getFullYear()}-${String(
      expenseWindowEnd.getMonth() + 1
    ).padStart(2, '0')}`;

    const expenseInWindow = monthlyExpenseData.filter(
      (item) =>
        item.policy_month >= expenseWindowStartStr && item.policy_month <= expenseWindowEndStr
    );

    const totalFee = expenseInWindow.reduce((sum, item) => sum + item.total_fee, 0);
    const totalTax = expenseInWindow.reduce((sum, item) => sum + item.tax, 0);
    const totalExpense = totalFee + totalTax;

    const totalEarnedPremium = summary.total_earned_premium;
    const operatingCost = (totalEarnedPremium * operatingCostRate) / 100;

    const comprehensiveExpenseRatio =
      totalEarnedPremium > 0
        ? ((operatingCost + totalExpense) * 100) / totalEarnedPremium
        : 0;

    return {
      stat_month: summary.stat_month,
      earned_from_prev: summary.earned_from_prev,
      earned_from_curr: summary.earned_from_curr,
      total_earned_premium: totalEarnedPremium,
      expense_window_start: expenseWindowStartStr,
      expense_window_end: expenseWindowEndStr,
      total_fee: totalFee,
      total_tax: totalTax,
      total_expense: totalExpense,
      operating_cost_rate: operatingCostRate,
      operating_cost: operatingCost,
      comprehensive_expense_ratio: comprehensiveExpenseRatio,
    };
  });
}
