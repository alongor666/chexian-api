/**
 * 成本分析Hook（API 模式）
 * Cost Analysis Hook
 *
 * 提供成本率计算和分析功能：
 * - 赔付率分析
 * - 费用率分析
 * - 综合费用率分析
 * - 变动成本率分析
 * - 通过后端 API 获取数据
 */

import { useState, useCallback } from 'react';
import { apiClient } from '../../../shared/api/client';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('CostAnalysis');

import type {
  ClaimRatioData,
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  EarnedPremiumData,
  EarnedPremiumSummaryData,
  CostSummary,
  CostSubTab,
  Policy2025In2025Data,
  Policy2025In2026Data,
  Policy2026In2026Data,
  Policy2026In2027Data,
  NewEarnedPremiumSummaryData,
  NewEarnedPremiumResultV3,
  MonthlyExpenseData,
  ExpenseRatioForecastData,
  ExpenseRatioForecastResult,
} from '../types/costTypes';

// ==================== 类型定义 ====================

/** 赔付率分析结果 */
export interface ClaimRatioResult {
  data: ClaimRatioData[];
  loading: boolean;
  error: string | null;
  summary: CostSummary;
}

/** 费用率分析结果 */
export interface ExpenseRatioResult {
  data: ExpenseRatioData[];
  loading: boolean;
  error: string | null;
  summary: CostSummary;
}

/** 综合成本分析结果 */
export interface ComprehensiveCostResult {
  data: ComprehensiveCostData[];
  loading: boolean;
  error: string | null;
  summary: CostSummary;
}

/** 变动成本分析结果 */
export interface VariableCostResult {
  data: VariableCostData[];
  loading: boolean;
  error: string | null;
  summary: CostSummary;
}

/** 已赚保费分析结果 */
export interface EarnedPremiumResult {
  data: EarnedPremiumData[];
  summaryData: EarnedPremiumSummaryData[];
  loading: boolean;
  error: string | null;
}

// ==================== 前端计算函数 ====================

/**
 * 前端计算滚动12个月汇总数据（简化版 v3，无需SQL）
 *
 * 核心逻辑：直接从4个已计算好的表数据做简单加法
 * - 例如统计月26年3月，滚动窗口 = [25年4月, 26年3月]
 * - 滚动12个月保费 = 25年保单(起保月4-12月)保费 + 26年保单(起保月1-3月)保费
 * - 滚动12个月已赚 = 对应窗口内各月已赚之和
 *
 * v3 简化逻辑（首日费用已并入起保月）：
 * - earned_YYYY_MM 字段已包含起保月的首日费用
 * - 计算时只需累加窗口内各月的 earned 字段，无需单独处理首日费用
 * - 自然截断：起保日不在窗口内 -> 首日费用不在任何窗口内月份 -> 自动排除
 *
 * 性能：纯内存计算，~1ms（vs SQL方案 ~3000ms）
 */
function calculateRolling12MonthSummary(
  policy2025In2025: Policy2025In2025Data[],
  policy2025In2026: Policy2025In2026Data[],
  policy2026In2026: Policy2026In2026Data[]
): NewEarnedPremiumSummaryData[] {
  const result: NewEarnedPremiumSummaryData[] = [];

  for (let statMonth = 1; statMonth <= 12; statMonth++) {
    const windowStartMonth2025 = statMonth + 1;

    // ========== 滚动12个月保费 ==========
    const premium2025 =
      windowStartMonth2025 <= 12
        ? policy2025In2025
            .filter((p) => p.policy_month >= windowStartMonth2025)
            .reduce((sum, p) => sum + p.premium, 0)
        : 0;

    const premium2026 = policy2026In2026
      .filter((p) => p.policy_month <= statMonth)
      .reduce((sum, p) => sum + p.premium, 0);

    const rollingPremium = premium2025 + premium2026;

    // ========== 25年保单在窗口内的已赚保费 ==========
    let earned2025 = 0;

    if (windowStartMonth2025 <= 12) {
      for (const p of policy2025In2025) {
        for (let m = windowStartMonth2025; m <= 12; m++) {
          const key = `earned_2025_${m.toString().padStart(2, '0')}` as keyof Policy2025In2025Data;
          earned2025 += (p[key] as number) || 0;
        }
      }
    }

    for (const p of policy2025In2026) {
      for (let m = 1; m <= statMonth; m++) {
        const key = `earned_2026_${m.toString().padStart(2, '0')}` as keyof Policy2025In2026Data;
        earned2025 += (p[key] as number) || 0;
      }
    }

    // ========== 26年保单在窗口内的已赚保费 ==========
    let earned2026 = 0;

    for (const p of policy2026In2026) {
      for (let m = 1; m <= statMonth; m++) {
        const key = `earned_2026_${m.toString().padStart(2, '0')}` as keyof Policy2026In2026Data;
        earned2026 += (p[key] as number) || 0;
      }
    }

    // ========== 汇总 ==========
    const totalEarned = earned2025 + earned2026;
    const earnedRatio =
      rollingPremium > 0
        ? Math.round((totalEarned / rollingPremium) * 10000) / 100
        : 0;

    result.push({
      stat_month: `2026-${statMonth.toString().padStart(2, '0')}`,
      rolling_12m_premium: Math.round(rollingPremium * 100) / 100,
      earned_from_2025: Math.round(earned2025 * 100) / 100,
      earned_from_2026: Math.round(earned2026 * 100) / 100,
      total_earned_premium: Math.round(totalEarned * 100) / 100,
      earned_ratio: earnedRatio,
    });
  }

  return result;
}

// ==================== 初始状态 ====================

const initialSummary: CostSummary = {
  totalPremium: 0,
  totalClaims: 0,
  totalFee: 0,
  policyCount: 0,
  avgClaimRatio: null,
  avgExpenseRatio: null,
};

// ==================== Hook实现 ====================

/**
 * 成本分析Hook（API 模式）
 */
export function useCostAnalysis() {
  // 赔付率状态
  const [claimRatioState, setClaimRatioState] = useState<ClaimRatioResult>({
    data: [],
    loading: false,
    error: null,
    summary: initialSummary,
  });

  // 费用率状态
  const [expenseRatioState, setExpenseRatioState] =
    useState<ExpenseRatioResult>({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });

  // 综合成本状态
  const [comprehensiveCostState, setComprehensiveCostState] =
    useState<ComprehensiveCostResult>({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });

  // 变动成本状态
  const [variableCostState, setVariableCostState] =
    useState<VariableCostResult>({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });

  // 已赚保费状态
  const [earnedPremiumState, setEarnedPremiumState] =
    useState<EarnedPremiumResult>({
      data: [],
      summaryData: [],
      loading: false,
      error: null,
    });

  // 新口径已赚保费状态（V3拆分为4个年度表）
  const [newEarnedPremiumState, setNewEarnedPremiumState] =
    useState<NewEarnedPremiumResultV3>({
      policy2025In2025Data: [],
      policy2025In2026Data: [],
      policy2026In2026Data: [],
      policy2026In2027Data: [],
      summaryData: [],
      loading: false,
      error: null,
    });

  // 综合费用率预测状态
  const [expenseRatioForecastState, setExpenseRatioForecastState] =
    useState<ExpenseRatioForecastResult>({
      forecastData: [],
      monthlyExpenseData: [],
      loading: false,
      error: null,
    });

  /**
   * 查询赔付率数据
   */
  const fetchClaimRatioData = useCallback(
    async (
      dimension: string,
      cutoffDate: string,
      filterParams?: Record<string, string>
    ) => {
      setClaimRatioState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        logger.info('成本分析 API 查询执行（赔付率）');

        const response = await apiClient.getCostAnalysis({
          analysisType: 'claimRatio',
          dimension,
          cutoffDate,
          ...filterParams,
        });

        const result = Array.isArray(response) ? response as ClaimRatioData[] : [];

        const summary: CostSummary = {
          totalPremium: result.reduce((sum, r) => sum + (r.total_premium || 0), 0),
          totalClaims: result.reduce((sum, r) => sum + (r.total_reported_claims || 0), 0),
          totalFee: 0,
          policyCount: result.reduce((sum, r) => sum + (r.policy_count || 0), 0),
          avgClaimRatio: result.length > 0
            ? result.reduce((sum, r) => sum + (r.earned_claim_ratio || 0), 0) /
              result.filter((r) => r.earned_claim_ratio !== null).length
            : null,
          avgExpenseRatio: null,
        };

        setClaimRatioState({ data: result, loading: false, error: null, summary });
        logger.info('成本分析 API 查询成功（赔付率）');
        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] Claim Ratio Error:', errorMessage);
        setClaimRatioState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return [];
      }
    },
    []
  );

  /**
   * 查询费用率数据
   */
  const fetchExpenseRatioData = useCallback(
    async (
      dimension: string,
      cutoffDate: string,
      filterParams?: Record<string, string>
    ) => {
      setExpenseRatioState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        logger.info('成本分析 API 查询执行（费用率）');

        const response = await apiClient.getCostAnalysis({
          analysisType: 'expenseRatio',
          dimension,
          cutoffDate,
          ...filterParams,
        });

        const result = Array.isArray(response) ? response as ExpenseRatioData[] : [];

        const summary: CostSummary = {
          totalPremium: result.reduce((sum, r) => sum + (r.total_premium || 0), 0),
          totalClaims: 0,
          totalFee: result.reduce((sum, r) => sum + (r.total_fee || 0), 0),
          policyCount: result.reduce((sum, r) => sum + (r.policy_count || 0), 0),
          avgClaimRatio: null,
          avgExpenseRatio:
            result.length > 0
              ? result.reduce((sum, r) => sum + (r.expense_ratio || 0), 0) /
                result.filter((r) => r.expense_ratio !== null).length
              : null,
        };

        setExpenseRatioState({
          data: result,
          loading: false,
          error: null,
          summary,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] Expense Ratio Error:', errorMessage);
        setExpenseRatioState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return [];
      }
    },
    []
  );

  /**
   * 查询综合成本数据
   */
  const fetchComprehensiveCostData = useCallback(
    async (
      dimension: string,
      cutoffDate: string,
      filterParams?: Record<string, string>
    ) => {
      setComprehensiveCostState((prev) => ({
        ...prev,
        loading: true,
        error: null,
      }));

      try {
        logger.info('成本分析 API 查询执行（综合成本）');

        const response = await apiClient.getCostAnalysis({
          analysisType: 'comprehensiveCost',
          dimension,
          cutoffDate,
          ...filterParams,
        });

        const result = Array.isArray(response) ? response as ComprehensiveCostData[] : [];

        const summary: CostSummary = {
          totalPremium: result.reduce((sum, r) => sum + (r.total_premium || 0), 0),
          totalClaims: result.reduce(
            (sum, r) => sum + (r.total_reported_claims || 0),
            0
          ),
          totalFee: result.reduce((sum, r) => sum + (r.total_fee || 0), 0),
          policyCount: result.reduce((sum, r) => sum + (r.policy_count || 0), 0),
          avgClaimRatio:
            result.length > 0
              ? result.reduce((sum, r) => sum + (r.earned_claim_ratio || 0), 0) /
                result.filter((r) => r.earned_claim_ratio !== null).length
              : null,
          avgExpenseRatio:
            result.length > 0
              ? result.reduce((sum, r) => sum + (r.expense_ratio || 0), 0) /
                result.filter((r) => r.expense_ratio !== null).length
              : null,
        };

        setComprehensiveCostState({
          data: result,
          loading: false,
          error: null,
          summary,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] Comprehensive Cost Error:', errorMessage);
        setComprehensiveCostState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return [];
      }
    },
    []
  );

  /**
   * 查询变动成本数据
   */
  const fetchVariableCostData = useCallback(
    async (
      dimension: string,
      cutoffDate: string,
      filterParams?: Record<string, string>
    ) => {
      setVariableCostState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        logger.info('成本分析 API 查询执行（变动成本）');

        const response = await apiClient.getCostAnalysis({
          analysisType: 'variableCost',
          dimension,
          cutoffDate,
          ...filterParams,
        });

        const result = Array.isArray(response) ? response as VariableCostData[] : [];

        const summary: CostSummary = {
          totalPremium: result.reduce((sum, r) => sum + (r.total_premium || 0), 0),
          totalClaims: result.reduce(
            (sum, r) => sum + (r.total_reported_claims || 0),
            0
          ),
          totalFee: result.reduce((sum, r) => sum + (r.total_fee || 0), 0),
          policyCount: result.reduce((sum, r) => sum + (r.policy_count || 0), 0),
          avgClaimRatio:
            result.length > 0
              ? result.reduce((sum, r) => sum + (r.earned_claim_ratio || 0), 0) /
                result.filter((r) => r.earned_claim_ratio !== null).length
              : null,
          avgExpenseRatio:
            result.length > 0
              ? result.reduce((sum, r) => sum + (r.expense_ratio || 0), 0) /
                result.filter((r) => r.expense_ratio !== null).length
              : null,
        };

        setVariableCostState({
          data: result,
          loading: false,
          error: null,
          summary,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] Variable Cost Error:', errorMessage);
        setVariableCostState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return [];
      }
    },
    []
  );

  /**
   * 查询已赚保费数据
   */
  const fetchEarnedPremiumData = useCallback(
    async (
      cutoffDate: string,
      filterParams?: Record<string, string>,
      _detailFilter?: { policyMonth?: string; orgLevel3?: string }
    ) => {
      setEarnedPremiumState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        logger.info('成本分析 API 查询执行（已赚保费）');

        const response = await apiClient.getCostAnalysis({
          type: 'earned',
          cutoffDate,
          ...filterParams,
        });

        const detailData = Array.isArray(response) ? response as EarnedPremiumData[] : [];
        const summaryData: EarnedPremiumSummaryData[] = [];

        setEarnedPremiumState({
          data: detailData,
          summaryData,
          loading: false,
          error: null,
        });

        return { detailData, summaryData };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] Earned Premium Error:', errorMessage);
        setEarnedPremiumState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return { detailData: [], summaryData: [] };
      }
    },
    []
  );

  /**
   * 查询新口径已赚保费数据（V3：4个年度表 + 汇总表）
   */
  const fetchNewEarnedPremiumData = useCallback(
    async (filterParams?: Record<string, string>) => {
      setNewEarnedPremiumState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        logger.info('成本分析 API 查询执行（新口径已赚保费）');

        const response = await apiClient.getCostAnalysis({
          type: 'earned-new',
          ...filterParams,
        });

        const responseData = response as Record<string, unknown> || {};
        const policy2025In2025Data = (responseData.policy2025In2025 || []) as Policy2025In2025Data[];
        const policy2025In2026Data = (responseData.policy2025In2026 || []) as Policy2025In2026Data[];
        const policy2026In2026Data = (responseData.policy2026In2026 || []) as Policy2026In2026Data[];
        const policy2026In2027Data = (responseData.policy2026In2027 || []) as Policy2026In2027Data[];

        // 前端计算汇总数据
        const summaryData = calculateRolling12MonthSummary(
          policy2025In2025Data,
          policy2025In2026Data,
          policy2026In2026Data
        );
        logger.debug('[CostAnalysis] Summary calculated in frontend:', summaryData);

        setNewEarnedPremiumState({
          policy2025In2025Data,
          policy2025In2026Data,
          policy2026In2026Data,
          policy2026In2027Data,
          summaryData,
          loading: false,
          error: null,
        });

        return {
          policy2025In2025Data,
          policy2025In2026Data,
          policy2026In2026Data,
          policy2026In2027Data,
          summaryData,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] New Earned Premium Error:', errorMessage);
        setNewEarnedPremiumState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return {
          policy2025In2025Data: [],
          policy2025In2026Data: [],
          policy2026In2026Data: [],
          policy2026In2027Data: [],
          summaryData: [],
        };
      }
    },
    []
  );

  /**
   * 查询综合费用率预测数据
   */
  const fetchExpenseRatioForecastData = useCallback(
    async (filterParams?: Record<string, string>, operatingCostRate: number = 9) => {
      setExpenseRatioForecastState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        logger.info('成本分析 API 查询执行（费用率预测）');

        const response = await apiClient.getCostAnalysis({
          type: 'expense-forecast',
          operatingCostRate: String(operatingCostRate),
          ...filterParams,
        });

        const responseData = response as Record<string, unknown> || {};
        const summaryData = (responseData.summaryData || []) as NewEarnedPremiumSummaryData[];
        const monthlyExpenseData = (responseData.monthlyExpenseData || []) as MonthlyExpenseData[];

        // 计算预测数据
        const forecastData: ExpenseRatioForecastData[] = summaryData.map((summary) => {
          const [year, month] = summary.stat_month.split('-').map(Number);

          const expenseWindowEnd = new Date(year, month - 1, 0);
          const expenseWindowStart = new Date(year, month - 1 - 11, 1);

          const expenseWindowStartStr = `${expenseWindowStart.getFullYear()}-${String(expenseWindowStart.getMonth() + 1).padStart(2, '0')}`;
          const expenseWindowEndStr = `${expenseWindowEnd.getFullYear()}-${String(expenseWindowEnd.getMonth() + 1).padStart(2, '0')}`;

          const expenseInWindow = monthlyExpenseData.filter((item) => {
            return item.policy_month >= expenseWindowStartStr && item.policy_month <= expenseWindowEndStr;
          });

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
            earned_from_2025: summary.earned_from_2025,
            earned_from_2026: summary.earned_from_2026,
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

        setExpenseRatioForecastState({
          forecastData,
          monthlyExpenseData,
          loading: false,
          error: null,
        });

        return { forecastData, monthlyExpenseData };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '查询失败';
        logger.error('[CostAnalysis] Expense Ratio Forecast Error:', errorMessage);
        setExpenseRatioForecastState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return { forecastData: [], monthlyExpenseData: [] };
      }
    },
    []
  );

  /**
   * 根据子Tab获取对应的fetch函数
   */
  const fetchDataBySubTab = useCallback(
    async (
      subTab: CostSubTab,
      dimension: string,
      cutoffDate: string,
      filterParams?: Record<string, string>
    ) => {
      switch (subTab) {
        case 'claim':
          return fetchClaimRatioData(dimension, cutoffDate, filterParams);
        case 'expense':
          return fetchExpenseRatioData(dimension, cutoffDate, filterParams);
        case 'comprehensive':
          return fetchComprehensiveCostData(dimension, cutoffDate, filterParams);
        case 'variable':
          return fetchVariableCostData(dimension, cutoffDate, filterParams);
        case 'earned':
          return fetchEarnedPremiumData(cutoffDate, filterParams);
        case 'earned-new':
          return fetchNewEarnedPremiumData(filterParams);
        default:
          return [];
      }
    },
    [
      fetchClaimRatioData,
      fetchExpenseRatioData,
      fetchComprehensiveCostData,
      fetchVariableCostData,
      fetchEarnedPremiumData,
      fetchNewEarnedPremiumData,
    ]
  );

  /**
   * 重置所有状态
   */
  const reset = useCallback(() => {
    setClaimRatioState({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });
    setExpenseRatioState({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });
    setComprehensiveCostState({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });
    setVariableCostState({
      data: [],
      loading: false,
      error: null,
      summary: initialSummary,
    });
    setEarnedPremiumState({
      data: [],
      summaryData: [],
      loading: false,
      error: null,
    });
    setNewEarnedPremiumState({
      policy2025In2025Data: [],
      policy2025In2026Data: [],
      policy2026In2026Data: [],
      policy2026In2027Data: [],
      summaryData: [],
      loading: false,
      error: null,
    });
    setExpenseRatioForecastState({
      forecastData: [],
      monthlyExpenseData: [],
      loading: false,
      error: null,
    });
  }, []);

  return {
    // 状态
    claimRatioState,
    expenseRatioState,
    comprehensiveCostState,
    variableCostState,
    earnedPremiumState,
    newEarnedPremiumState,
    expenseRatioForecastState,
    // 方法
    fetchClaimRatioData,
    fetchExpenseRatioData,
    fetchComprehensiveCostData,
    fetchVariableCostData,
    fetchEarnedPremiumData,
    fetchNewEarnedPremiumData,
    fetchExpenseRatioForecastData,
    fetchDataBySubTab,
    reset,
  };
}
