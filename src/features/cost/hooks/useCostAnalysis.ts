/**
 * 成本分析Hook（API 模式）
 *
 * 提供 8 个 fetcher + 8 个状态 + 路由 + reset。本入口为薄壳，
 * 纯计算抽至 ../utils/cost-summary-calc.ts，API 调用抽至 ./cost-fetchers.ts。
 * Hook 公开 API（参数 / 返回值 / 类型）100% 兼容重构前。
 */

import { useState, useCallback } from 'react';
import { Logger } from '@/shared/utils/logger';
import { initialSummary } from '../utils/cost-summary-calc';
import {
  fetchClaimRatio,
  fetchExpenseRatio,
  fetchComprehensiveCost,
  fetchVariableCost,
  fetchVariableCostKpi,
  fetchEarnedPremium,
  fetchNewEarnedPremium,
  fetchExpenseRatioForecast,
  fallbackAnchorYear,
} from './cost-fetchers';
import type {
  ClaimRatioData,
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  EarnedPremiumData,
  EarnedPremiumSummaryData,
  CostSummary,
  CostSubTab,
  NewEarnedPremiumResultV3,
  ExpenseRatioForecastResult,
} from '../types/costTypes';

const logger = new Logger('CostAnalysis');

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

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '查询失败';

// ==================== Hook 实现 ====================

export function useCostAnalysis() {
  const [claimRatioState, setClaimRatioState] = useState<ClaimRatioResult>({
    data: [],
    loading: false,
    error: null,
    summary: initialSummary,
  });

  const [expenseRatioState, setExpenseRatioState] = useState<ExpenseRatioResult>({
    data: [],
    loading: false,
    error: null,
    summary: initialSummary,
  });

  const [comprehensiveCostState, setComprehensiveCostState] = useState<ComprehensiveCostResult>({
    data: [],
    loading: false,
    error: null,
    summary: initialSummary,
  });

  const [variableCostState, setVariableCostState] = useState<VariableCostResult>({
    data: [],
    loading: false,
    error: null,
    summary: initialSummary,
  });

  const [variableCostKpiState, setVariableCostKpiState] = useState<VariableCostResult>({
    data: [],
    loading: false,
    error: null,
    summary: initialSummary,
  });

  const [earnedPremiumState, setEarnedPremiumState] = useState<EarnedPremiumResult>({
    data: [],
    summaryData: [],
    loading: false,
    error: null,
  });

  const [newEarnedPremiumState, setNewEarnedPremiumState] = useState<NewEarnedPremiumResultV3>({
    anchorYear: fallbackAnchorYear(),
    policyPrevInPrevData: [],
    policyPrevInCurrData: [],
    policyCurrInCurrData: [],
    policyCurrInNextData: [],
    summaryData: [],
    loading: false,
    error: null,
  });

  const [expenseRatioForecastState, setExpenseRatioForecastState] =
    useState<ExpenseRatioForecastResult>({
      anchorYear: fallbackAnchorYear(),
      forecastData: [],
      monthlyExpenseData: [],
      loading: false,
      error: null,
    });

  const fetchClaimRatioData = useCallback(
    async (dimension: string, cutoffDate: string, filterParams?: Record<string, string>) => {
      setClaimRatioState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（赔付率）');
        const { data, summary } = await fetchClaimRatio(dimension, cutoffDate, filterParams);
        setClaimRatioState({ data, loading: false, error: null, summary });
        logger.info('成本分析 API 查询成功（赔付率）');
        return data;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] Claim Ratio Error:', errorMessage);
        setClaimRatioState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return [];
      }
    },
    []
  );

  const fetchExpenseRatioData = useCallback(
    async (dimension: string, cutoffDate: string, filterParams?: Record<string, string>) => {
      setExpenseRatioState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（费用率）');
        const { data, summary } = await fetchExpenseRatio(dimension, cutoffDate, filterParams);
        setExpenseRatioState({ data, loading: false, error: null, summary });
        return data;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] Expense Ratio Error:', errorMessage);
        setExpenseRatioState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return [];
      }
    },
    []
  );

  const fetchComprehensiveCostData = useCallback(
    async (dimension: string, cutoffDate: string, filterParams?: Record<string, string>) => {
      setComprehensiveCostState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（综合成本）');
        const { data, summary } = await fetchComprehensiveCost(dimension, cutoffDate, filterParams);
        setComprehensiveCostState({ data, loading: false, error: null, summary });
        return data;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] Comprehensive Cost Error:', errorMessage);
        setComprehensiveCostState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return [];
      }
    },
    []
  );

  const fetchVariableCostData = useCallback(
    async (dimension: string, cutoffDate: string, filterParams?: Record<string, string>) => {
      setVariableCostState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（变动成本）');
        const { data, summary } = await fetchVariableCost(dimension, cutoffDate, filterParams);
        setVariableCostState({ data, loading: false, error: null, summary });
        return data;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] Variable Cost Error:', errorMessage);
        setVariableCostState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return [];
      }
    },
    []
  );

  const fetchVariableCostKpiData = useCallback(
    async (cutoffDate: string, filterParams?: Record<string, string>) => {
      setVariableCostKpiState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（变动成本KPI）');
        const { data, summary } = await fetchVariableCostKpi(cutoffDate, filterParams);
        setVariableCostKpiState({ data, loading: false, error: null, summary });
        return data;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] Variable Cost KPI Error:', errorMessage);
        setVariableCostKpiState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return [];
      }
    },
    []
  );

  const fetchEarnedPremiumData = useCallback(
    async (
      cutoffDate: string,
      filterParams?: Record<string, string>,
      _detailFilter?: { policyMonth?: string; orgLevel3?: string }
    ) => {
      setEarnedPremiumState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（已赚保费）');
        const { detailData, summaryData } = await fetchEarnedPremium(cutoffDate, filterParams);
        setEarnedPremiumState({ data: detailData, summaryData, loading: false, error: null });
        return { detailData, summaryData };
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] Earned Premium Error:', errorMessage);
        setEarnedPremiumState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return { detailData: [], summaryData: [] };
      }
    },
    []
  );

  const fetchNewEarnedPremiumData = useCallback(
    async (filterParams?: Record<string, string>) => {
      setNewEarnedPremiumState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（新口径已赚保费）');
        const result = await fetchNewEarnedPremium(filterParams);
        logger.debug('[CostAnalysis] Summary calculated in frontend:', result.summaryData);
        setNewEarnedPremiumState({ ...result, loading: false, error: null });
        return result;
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        logger.error('[CostAnalysis] New Earned Premium Error:', errorMessage);
        setNewEarnedPremiumState((prev) => ({ ...prev, loading: false, error: errorMessage }));
        return {
          anchorYear: fallbackAnchorYear(),
          policyPrevInPrevData: [],
          policyPrevInCurrData: [],
          policyCurrInCurrData: [],
          policyCurrInNextData: [],
          summaryData: [],
        };
      }
    },
    []
  );

  const fetchExpenseRatioForecastData = useCallback(
    async (filterParams?: Record<string, string>, operatingCostRate: number = 9) => {
      setExpenseRatioForecastState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        logger.info('成本分析 API 查询执行（费用率预测）');
        const { anchorYear, forecastData, monthlyExpenseData } = await fetchExpenseRatioForecast(
          filterParams,
          operatingCostRate
        );
        setExpenseRatioForecastState({
          anchorYear,
          forecastData,
          monthlyExpenseData,
          loading: false,
          error: null,
        });
        return { forecastData, monthlyExpenseData };
      } catch (error) {
        const errorMessage = toErrorMessage(error);
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

  const reset = useCallback(() => {
    const ratioInit = { data: [], loading: false, error: null, summary: initialSummary };
    setClaimRatioState(ratioInit);
    setExpenseRatioState(ratioInit);
    setComprehensiveCostState(ratioInit);
    setVariableCostState(ratioInit);
    setVariableCostKpiState(ratioInit);
    setEarnedPremiumState({ data: [], summaryData: [], loading: false, error: null });
    setNewEarnedPremiumState({
      anchorYear: fallbackAnchorYear(),
      policyPrevInPrevData: [],
      policyPrevInCurrData: [],
      policyCurrInCurrData: [],
      policyCurrInNextData: [],
      summaryData: [],
      loading: false,
      error: null,
    });
    setExpenseRatioForecastState({
      anchorYear: fallbackAnchorYear(),
      forecastData: [],
      monthlyExpenseData: [],
      loading: false,
      error: null,
    });
  }, []);

  return {
    claimRatioState,
    expenseRatioState,
    comprehensiveCostState,
    variableCostState,
    variableCostKpiState,
    earnedPremiumState,
    newEarnedPremiumState,
    expenseRatioForecastState,
    fetchClaimRatioData,
    fetchExpenseRatioData,
    fetchComprehensiveCostData,
    fetchVariableCostData,
    fetchVariableCostKpiData,
    fetchEarnedPremiumData,
    fetchNewEarnedPremiumData,
    fetchExpenseRatioForecastData,
    fetchDataBySubTab,
    reset,
  };
}
