/**
 * 成本分析 fetcher 纯函数
 *
 * 从 useCostAnalysis 抽出的 8 个 API 调用：每个 fetcher 是纯 async 函数，
 * 接受查询参数，返回 { data, summary } 或对应的结构化结果。
 * 不依赖 React state，不持有 setter，错误一律抛出由调用方处理。
 *
 * Hook 入口 useCostAnalysis 用 useCallback 包装这些 fetcher + setState + try-catch。
 */

import { apiClient } from '../../../shared/api/client';
import {
  buildClaimRatioSummary,
  buildExpenseRatioSummary,
  buildFullSummary,
  calculateRolling12MonthSummary,
  calculateExpenseRatioForecast,
} from '../utils/cost-summary-calc';
import type {
  ClaimRatioData,
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  EarnedPremiumData,
  EarnedPremiumSummaryData,
  CostSummary,
  SameYearEarnedRow,
  CrossYearEarnedRow,
  NewEarnedPremiumSummaryData,
  MonthlyExpenseData,
  ExpenseRatioForecastData,
} from '../types/costTypes';

// ==================== 公共结果类型 ====================

interface FetchResult<T> {
  data: T[];
  summary: CostSummary;
}

// ==================== Fetcher 实现 ====================

export async function fetchClaimRatio(
  dimension: string,
  cutoffDate: string,
  filterParams?: Record<string, string>
): Promise<FetchResult<ClaimRatioData>> {
  const response = await apiClient.getCostAnalysis({
    analysisType: 'claimRatio',
    dimension,
    cutoffDate,
    ...filterParams,
  });
  const data = Array.isArray(response) ? (response as ClaimRatioData[]) : [];
  return { data, summary: buildClaimRatioSummary(data) };
}

export async function fetchExpenseRatio(
  dimension: string,
  cutoffDate: string,
  filterParams?: Record<string, string>
): Promise<FetchResult<ExpenseRatioData>> {
  const response = await apiClient.getCostAnalysis({
    analysisType: 'expenseRatio',
    dimension,
    cutoffDate,
    ...filterParams,
  });
  const data = Array.isArray(response) ? (response as ExpenseRatioData[]) : [];
  return { data, summary: buildExpenseRatioSummary(data) };
}

export async function fetchComprehensiveCost(
  dimension: string,
  cutoffDate: string,
  filterParams?: Record<string, string>
): Promise<FetchResult<ComprehensiveCostData>> {
  const response = await apiClient.getCostAnalysis({
    analysisType: 'comprehensiveCost',
    dimension,
    cutoffDate,
    ...filterParams,
  });
  const data = Array.isArray(response) ? (response as ComprehensiveCostData[]) : [];
  return { data, summary: buildFullSummary(data) };
}

export async function fetchVariableCost(
  dimension: string,
  cutoffDate: string,
  filterParams?: Record<string, string>
): Promise<FetchResult<VariableCostData>> {
  const response = await apiClient.getCostAnalysis({
    analysisType: 'variableCost',
    dimension,
    cutoffDate,
    ...filterParams,
  });
  const data = Array.isArray(response) ? (response as VariableCostData[]) : [];
  return { data, summary: buildFullSummary(data) };
}

/** 变动成本 KPI：固定 dimension=org_level_3，不接受 dimension 参数 */
export async function fetchVariableCostKpi(
  cutoffDate: string,
  filterParams?: Record<string, string>
): Promise<FetchResult<VariableCostData>> {
  const response = await apiClient.getCostAnalysis({
    analysisType: 'variableCost',
    dimension: 'org_level_3',
    cutoffDate,
    ...filterParams,
  });
  const data = Array.isArray(response) ? (response as VariableCostData[]) : [];
  return { data, summary: buildFullSummary(data) };
}

export async function fetchEarnedPremium(
  cutoffDate: string,
  filterParams?: Record<string, string>
): Promise<{ detailData: EarnedPremiumData[]; summaryData: EarnedPremiumSummaryData[] }> {
  const response = await apiClient.getCostAnalysis({
    type: 'earned',
    cutoffDate,
    ...filterParams,
  });
  const detailData = Array.isArray(response) ? (response as EarnedPremiumData[]) : [];
  // 前端不算 summary（保留原行为）
  return { detailData, summaryData: [] };
}

interface NewEarnedPremiumResult {
  anchorYear: number;
  policyPrevInPrevData: SameYearEarnedRow[];
  policyPrevInCurrData: CrossYearEarnedRow[];
  policyCurrInCurrData: SameYearEarnedRow[];
  policyCurrInNextData: CrossYearEarnedRow[];
  summaryData: NewEarnedPremiumSummaryData[];
}

/** 后端未回传锚定年时的兜底：取本地当前年（与后端北京时区口径差异仅出现在跨年时刻附近） */
export function fallbackAnchorYear(): number {
  return new Date().getFullYear();
}

export async function fetchNewEarnedPremium(
  filterParams?: Record<string, string>
): Promise<NewEarnedPremiumResult> {
  const response = await apiClient.getCostAnalysis({
    type: 'earned-new',
    ...filterParams,
  });

  const responseData = (response as Record<string, unknown>) || {};
  const anchorYear = Number(responseData.anchorYear) || fallbackAnchorYear();
  const policyPrevInPrevData = (responseData.policyPrevInPrev || []) as SameYearEarnedRow[];
  const policyPrevInCurrData = (responseData.policyPrevInCurr || []) as CrossYearEarnedRow[];
  const policyCurrInCurrData = (responseData.policyCurrInCurr || []) as SameYearEarnedRow[];
  const policyCurrInNextData = (responseData.policyCurrInNext || []) as CrossYearEarnedRow[];

  const summaryData = calculateRolling12MonthSummary(
    policyPrevInPrevData,
    policyPrevInCurrData,
    policyCurrInCurrData,
    anchorYear
  );

  return {
    anchorYear,
    policyPrevInPrevData,
    policyPrevInCurrData,
    policyCurrInCurrData,
    policyCurrInNextData,
    summaryData,
  };
}

interface ExpenseRatioForecastFetchResult {
  anchorYear: number;
  forecastData: ExpenseRatioForecastData[];
  monthlyExpenseData: MonthlyExpenseData[];
}

export async function fetchExpenseRatioForecast(
  filterParams?: Record<string, string>,
  operatingCostRate: number = 9
): Promise<ExpenseRatioForecastFetchResult> {
  const response = await apiClient.getCostAnalysis({
    type: 'expense-forecast',
    operatingCostRate: String(operatingCostRate),
    ...filterParams,
  });

  const responseData = (response as Record<string, unknown>) || {};
  const anchorYear = Number(responseData.anchorYear) || fallbackAnchorYear();
  const summaryData = (responseData.summaryData || []) as NewEarnedPremiumSummaryData[];
  const monthlyExpenseData = (responseData.monthlyExpenseData || []) as MonthlyExpenseData[];

  const forecastData = calculateExpenseRatioForecast(
    summaryData,
    monthlyExpenseData,
    operatingCostRate
  );

  return { anchorYear, forecastData, monthlyExpenseData };
}
