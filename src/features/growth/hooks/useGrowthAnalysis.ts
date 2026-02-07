/**
 * 增长率分析Hook（API 模式）
 * Growth Analysis Hook
 *
 * 提供增长率计算和分析功能
 * 通过后端 API 获取数据
 */

import { useState, useCallback } from 'react';
import { apiClient } from '../../../shared/api/client';
import { createLogger } from '../../../shared/utils/logger';
import type { ViewPerspective } from '../../../shared/types';

const logger = createLogger('useGrowthAnalysis');

/**
 * 增长率数据接口
 */
export interface GrowthData {
  time_period?: string;
  current_value: number;
  previous_value: number;
  growth_rate: number | null;
  period_total_current?: number;
  period_total_previous?: number;
  period_growth_rate?: number | null;
  ytd_total_current?: number;
  ytd_total_previous?: number;
  ytd_growth_rate?: number | null;
  [key: string]: string | number | null | undefined;
}

/**
 * 双指标对比数据接口
 */
export interface DualMetricComparisonData {
  dim_key: string;
  current_premium: number;
  previous_premium: number;
  current_count: number;
  previous_count: number;
  premium_growth_rate: number | null;
  count_growth_rate: number | null;
  [key: string]: string | number | null | undefined;
}

/**
 * 增长率分析结果接口
 */
export interface GrowthAnalysisResult {
  data: GrowthData[];
  loading: boolean;
  error: string | null;
  summary: {
    avgGrowthRate: number;
    positiveGrowthPeriods: number;
    totalPeriods: number;
    maxGrowthRate: number;
    minGrowthRate: number;
  };
}

/**
 * 增长分析筛选器参数接口
 */
export interface GrowthAnalysisFilters {
  /** 三级机构列表 */
  orgLevel3?: string[];
  /** 视角（保费/件数） */
  perspective?: ViewPerspective;
  /** 附加 WHERE 条件（来自 buildWhereClauseFromFilters） */
  additionalWhereClause?: string;
}

type GrowthType = 'yoy' | 'mom' | 'ytd' | 'custom';

/**
 * 使用增长率分析的Hook（API 模式）
 */
export function useGrowthAnalysis() {
  const [state, setState] = useState<GrowthAnalysisResult>({
    data: [],
    loading: false,
    error: null,
    summary: {
      avgGrowthRate: 0,
      positiveGrowthPeriods: 0,
      totalPeriods: 0,
      maxGrowthRate: 0,
      minGrowthRate: 0,
    },
  });

  /**
   * 计算增长率分析摘要
   */
  const calculateSummary = useCallback((data: GrowthData[]) => {
    const validGrowthRates = data
      .map(item => item.growth_rate)
      .filter(rate => rate !== null && !isNaN(rate)) as number[];

    if (validGrowthRates.length === 0) {
      return {
        avgGrowthRate: 0,
        positiveGrowthPeriods: 0,
        totalPeriods: 0,
        maxGrowthRate: 0,
        minGrowthRate: 0,
      };
    }

    return {
      avgGrowthRate: validGrowthRates.reduce((sum, rate) => sum + rate, 0) / validGrowthRates.length,
      positiveGrowthPeriods: validGrowthRates.filter(rate => rate > 0).length,
      totalPeriods: validGrowthRates.length,
      maxGrowthRate: Math.max(...validGrowthRates),
      minGrowthRate: Math.min(...validGrowthRates),
    };
  }, []);

  /**
   * 通用 API 增长分析调用
   */
  const fetchGrowthFromApi = useCallback(async (
    startDate: string,
    endDate: string,
    compareStartDate: string,
    compareEndDate: string,
    filters?: Record<string, any>
  ) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      logger.info('增长分析 API 查询执行', { startDate, endDate, compareStartDate, compareEndDate });

      const response = await apiClient.getGrowthAnalysis(
        startDate,
        endDate,
        compareStartDate,
        compareEndDate,
        filters
      );

      const data: GrowthData[] = Array.isArray(response) ? response.map((item: Record<string, unknown>) => ({
        current_value: Number(item.current_value ?? item.current_premium ?? 0),
        previous_value: Number(item.previous_value ?? item.previous_premium ?? 0),
        growth_rate: item.growth_rate !== undefined ? Number(item.growth_rate) : null,
        time_period: String(item.time_period ?? item.period ?? ''),
      })) : [];

      const summary = calculateSummary(data);

      setState({
        data,
        loading: false,
        error: null,
        summary,
      });

      logger.info('增长分析 API 查询成功');
      return { success: true, data, summary };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      logger.error('增长分析 API 查询失败:', error);

      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return { success: false, error: errorMessage, data: [], summary: state.summary };
    }
  }, [calculateSummary, state.summary]);

  /**
   * 执行增长率分析（通用入口，保持接口兼容）
   */
  const analyzeGrowth = useCallback(async (
    _config: unknown,
    _customQueryGenerator?: unknown
  ) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const startDate = `${currentYear}-01-01`;
      const endDate = now.toISOString().split('T')[0];
      const compareStartDate = `${currentYear - 1}-01-01`;
      const compareEndDate = `${currentYear - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      return await fetchGrowthFromApi(startDate, endDate, compareStartDate, compareEndDate);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return {
        success: false,
        error: errorMessage,
        data: [],
        summary: state.summary,
      };
    }
  }, [fetchGrowthFromApi, state.summary]);

  /**
   * 分析机构保费增长率
   */
  const analyzeOrgPremiumGrowth = useCallback(async (
    orgName?: string,
    growthType: GrowthType = 'yoy',
    _timeView: 'monthly' | 'quarterly' = 'monthly',
    _perspective: ViewPerspective = 'premium',
    _additionalWhereClause?: string
  ) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startDate = `${currentYear}-01-01`;
    const endDate = now.toISOString().split('T')[0];

    let compareStartDate: string;
    let compareEndDate: string;

    if (growthType === 'yoy') {
      compareStartDate = `${currentYear - 1}-01-01`;
      compareEndDate = `${currentYear - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    } else {
      const prevMonth = new Date(now);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      compareStartDate = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
      compareEndDate = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    const filters: Record<string, any> = {};
    if (orgName) {
      filters.orgName = orgName;
    }

    return await fetchGrowthFromApi(startDate, endDate, compareStartDate, compareEndDate, filters);
  }, [fetchGrowthFromApi]);

  /**
   * 分析业务员业绩增长率
   */
  const analyzeSalesmanGrowth = useCallback(async (
    salesmanName: string,
    growthType: GrowthType = 'yoy',
    _perspective: ViewPerspective = 'premium',
    _additionalWhereClause?: string
  ) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startDate = `${currentYear}-01-01`;
    const endDate = now.toISOString().split('T')[0];

    let compareStartDate: string;
    let compareEndDate: string;

    if (growthType === 'yoy') {
      compareStartDate = `${currentYear - 1}-01-01`;
      compareEndDate = `${currentYear - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    } else {
      const prevMonth = new Date(now);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      compareStartDate = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
      compareEndDate = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    return await fetchGrowthFromApi(startDate, endDate, compareStartDate, compareEndDate, {
      salesmanName,
    });
  }, [fetchGrowthFromApi]);

  /**
   * 分析KPI指标增长率
   */
  const analyzeKPIGrowth = useCallback(async (
    kpiMetric: string,
    growthType: 'yoy' | 'mom' | 'ytd' = 'yoy',
    dimension?: string[],
    _additionalWhereClause?: string
  ) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startDate = `${currentYear}-01-01`;
    const endDate = now.toISOString().split('T')[0];
    const compareStartDate = `${currentYear - 1}-01-01`;
    const compareEndDate = `${currentYear - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return await fetchGrowthFromApi(startDate, endDate, compareStartDate, compareEndDate, {
      metric: kpiMetric,
      growthType,
      dimension: dimension?.join(','),
    });
  }, [fetchGrowthFromApi]);

  /**
   * 自定义期间比较
   */
  const analyzeCustomPeriod = useCallback(async (
    currentPeriod: { startDate: string; endDate: string },
    baselinePeriod: { startDate: string; endDate: string },
    _metric: string = 'SUM(premium)',
    _groupBy?: string[],
    _additionalWhereClause?: string
  ) => {
    return await fetchGrowthFromApi(
      currentPeriod.startDate,
      currentPeriod.endDate,
      baselinePeriod.startDate,
      baselinePeriod.endDate,
    );
  }, [fetchGrowthFromApi]);

  /**
   * 分析每日增长详情（带月度上下文）
   */
  const analyzeDailyGrowthDetail = useCallback(async (
    currentStartDate: string,
    currentEndDate: string,
    filters: GrowthAnalysisFilters = {}
  ) => {
    const getPrevDate = (dateStr: string) => {
      const d = new Date(dateStr);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString().split('T')[0];
    };

    const prevStartDate = getPrevDate(currentStartDate);
    const prevEndDate = getPrevDate(currentEndDate);

    const apiFilters: Record<string, any> = {};
    if (filters.orgLevel3 && filters.orgLevel3.length > 0) {
      apiFilters.orgName = filters.orgLevel3.join(',');
    }
    if (filters.perspective) {
      apiFilters.perspective = filters.perspective;
    }

    return await fetchGrowthFromApi(
      currentStartDate,
      currentEndDate,
      prevStartDate,
      prevEndDate,
      apiFilters
    );
  }, [fetchGrowthFromApi]);

  /**
   * 双指标对比分析（保费+件数）
   */
  const analyzeDualMetricComparison = useCallback(async (
    currentPeriod: { startDate: string; endDate: string },
    previousPeriod: { startDate: string; endDate: string },
    groupBy: string[] = ['org_level_3'],
    _whereClause?: string
  ): Promise<{ success: boolean; data: DualMetricComparisonData[]; error?: string }> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      logger.info('双指标对比 API 查询执行');

      const response = await apiClient.getGrowthAnalysis(
        currentPeriod.startDate,
        currentPeriod.endDate,
        previousPeriod.startDate,
        previousPeriod.endDate,
        { type: 'dual-metric', groupBy: groupBy.join(',') }
      );

      const data: DualMetricComparisonData[] = Array.isArray(response) ? response.map((row: Record<string, unknown>) => ({
        dim_key: String(row.dim_key ?? row.org_level_3 ?? '-'),
        current_premium: Number(row.current_premium ?? 0),
        previous_premium: Number(row.previous_premium ?? 0),
        current_count: Number(row.current_count ?? 0),
        previous_count: Number(row.previous_count ?? 0),
        premium_growth_rate: row.premium_growth_rate !== undefined ? Number(row.premium_growth_rate) : null,
        count_growth_rate: row.count_growth_rate !== undefined ? Number(row.count_growth_rate) : null,
      })) : [];

      setState(prev => ({
        ...prev,
        loading: false,
        error: null,
      }));

      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return { success: false, data: [], error: errorMessage };
    }
  }, []);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setState({
      data: [],
      loading: false,
      error: null,
      summary: {
        avgGrowthRate: 0,
        positiveGrowthPeriods: 0,
        totalPeriods: 0,
        maxGrowthRate: 0,
        minGrowthRate: 0,
      },
    });
  }, []);

  return {
    ...state,
    analyzeGrowth,
    analyzeOrgPremiumGrowth,
    analyzeSalesmanGrowth,
    analyzeKPIGrowth,
    analyzeCustomPeriod,
    analyzeDailyGrowthDetail,
    analyzeDualMetricComparison,
    reset,
  };
}
