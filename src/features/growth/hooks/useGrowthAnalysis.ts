/**
 * 增长率分析Hook（API 模式）
 * Growth Analysis Hook
 *
 * 提供增长率计算和分析功能
 * 通过后端 API 获取数据
 */

import { useState, useCallback, useRef } from 'react';
import { apiClient } from '../../../shared/api/client';
import { createLogger } from '../../../shared/utils/logger';
import { formatSalesmanName } from '../../../shared/utils/formatters';
import { deriveGrowthYearWindow, shiftDateBackOneYear } from '../utils/yearWindow';
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
  /** 附加筛选参数（来自 buildFilterParams，直接传递给后端 API） */
  additionalFilterParams?: Record<string, string>;
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
   * 请求序号守卫（BACKLOG 2026-06-11-claude-3ab3e3）
   *
   * fetchGrowthFromApi / analyzeDualMetricComparison 均无请求序号防护：
   * 快速切换分析类型/增长率类型/对比预设时，多个请求并发在途，慢请求
   * 晚回但先发起的旧请求可能"后到"，覆盖新请求已写入的 state，UI 短暂
   * 显示与当前所选条件不符的数据（竞态）。
   *
   * 用两个独立 useRef 计数器分别守卫两条独立数据流（growth 分析 state
   * 与 dual-metric 对比 state 是两套 setState，互不干扰，各自独立计数）：
   * 每次发起请求前自增并记录"发起时的序号"，响应回来后与"当前最新序号"
   * 比对，非最新则丢弃（不写 state）。不引入 AbortController（传输层
   * cancelRequest 语义已在 main 上定过调，本次不改传输层）。
   */
  const growthRequestSeqRef = useRef(0);
  const dualMetricRequestSeqRef = useRef(0);

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
    baselineStart: string,
    baselineEnd: string,
    filters?: Record<string, any>
  ) => {
    // 请求序号守卫：发起请求前自增并记录本次序号，响应回来后与最新序号比对
    const requestSeq = ++growthRequestSeqRef.current;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      logger.info('增长分析 API 查询执行', { startDate, endDate, baselineStart, baselineEnd });

      const response = await apiClient.getGrowthAnalysis(
        startDate,
        endDate,
        baselineStart,
        baselineEnd,
        filters
      );

      const data: GrowthData[] = Array.isArray(response) ? response.map((item: Record<string, unknown>) => {
        const rawSalesmanName = item.salesman_name != null ? String(item.salesman_name) : '';

        return {
          current_value: Number(item.current_value ?? item.current_premium ?? 0),
          previous_value: Number(item.previous_value ?? item.previous_premium ?? 0),
          growth_rate: item.growth_rate != null ? Number(item.growth_rate) : null,
          time_period: String(item.time_period ?? item.period ?? ''),
          org_level_3: item.org_level_3 != null ? String(item.org_level_3) : undefined,
          salesman_name: rawSalesmanName ? formatSalesmanName(rawSalesmanName) : undefined,
          // 传递 MTD/YTD 上下文字段（由 daily-context 查询返回）
          period_total_current: item.period_total_current !== undefined ? Number(item.period_total_current) : undefined,
          period_total_previous: item.period_total_previous !== undefined ? Number(item.period_total_previous) : undefined,
          period_growth_rate: item.period_growth_rate !== undefined ? Number(item.period_growth_rate) : undefined,
          ytd_total_current: item.ytd_total_current !== undefined ? Number(item.ytd_total_current) : undefined,
          ytd_total_previous: item.ytd_total_previous !== undefined ? Number(item.ytd_total_previous) : undefined,
          ytd_growth_rate: item.ytd_growth_rate !== undefined ? Number(item.ytd_growth_rate) : undefined,
        };
      }) : [];

      const summary = calculateSummary(data);

      // 竞态守卫：响应回来时序号已非最新（更新的请求已发起）→ 丢弃，不覆盖新结果
      if (requestSeq !== growthRequestSeqRef.current) {
        logger.info('增长分析 API 响应已过期，丢弃（请求序号非最新）', { requestSeq, latest: growthRequestSeqRef.current });
        return { success: true, data, summary, stale: true };
      }

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

      // 竞态守卫：过期请求的失败也不应覆盖更新请求已写入的 state
      if (requestSeq !== growthRequestSeqRef.current) {
        return { success: false, error: errorMessage, data: [], summary: { avgGrowthRate: 0, positiveGrowthPeriods: 0, totalPeriods: 0, maxGrowthRate: 0, minGrowthRate: 0 }, stale: true };
      }

      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return { success: false, error: errorMessage, data: [], summary: { avgGrowthRate: 0, positiveGrowthPeriods: 0, totalPeriods: 0, maxGrowthRate: 0, minGrowthRate: 0 } };
    }
  }, [calculateSummary]);

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
      const baselineStart = `${currentYear - 1}-01-01`;
      const baselineEnd = `${currentYear - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      return await fetchGrowthFromApi(startDate, endDate, baselineStart, baselineEnd, { growthType: 'yoy', timeView: 'monthly' });
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
        summary: { avgGrowthRate: 0, positiveGrowthPeriods: 0, totalPeriods: 0, maxGrowthRate: 0, minGrowthRate: 0 },
      };
    }
  }, [fetchGrowthFromApi]);

  /**
   * 分析机构保费增长率
   *
   * BACKLOG 2026-06-11-claude-2e311d：startDate/endDate 改由 analysisYear
   * （即 filters.analysis_year，与同面板 daily-detail 分支同源）派生，不再
   * 一律用 new Date() 当前年——用户切到往年时不再误查当前年数据。
   * yoy 基期改用 shiftDateBackOneYear（闰年 2/29 安全回退上年 2/28）。
   */
  const analyzeOrgPremiumGrowth = useCallback(async (
    orgName?: string,
    growthType: GrowthType = 'yoy',
    timeView: 'monthly' | 'quarterly' = 'monthly',
    _perspective: ViewPerspective = 'premium',
    additionalFilterParams?: Record<string, string>,
    analysisYear?: number
  ) => {
    const { startDate, endDate } = deriveGrowthYearWindow(analysisYear);

    let baselineStart: string;
    let baselineEnd: string;

    if (growthType === 'yoy') {
      baselineStart = shiftDateBackOneYear(startDate);
      baselineEnd = shiftDateBackOneYear(endDate);
    } else {
      const now = new Date();
      const prevMonth = new Date(now);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      baselineStart = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
      baselineEnd = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    const filters: Record<string, any> = { growthType, timeView, ...additionalFilterParams };
    if (orgName) {
      filters.orgName = orgName;
    }

    return await fetchGrowthFromApi(startDate, endDate, baselineStart, baselineEnd, filters);
  }, [fetchGrowthFromApi]);

  /**
   * 分析业务员业绩增长率
   *
   * BACKLOG 2026-06-11-claude-2e311d：同 analyzeOrgPremiumGrowth，年份窗口
   * 改由 analysisYear 派生。
   */
  const analyzeSalesmanGrowth = useCallback(async (
    salesmanName: string,
    growthType: GrowthType = 'yoy',
    _perspective: ViewPerspective = 'premium',
    additionalFilterParams?: Record<string, string>,
    analysisYear?: number
  ) => {
    const { startDate, endDate } = deriveGrowthYearWindow(analysisYear);

    let baselineStart: string;
    let baselineEnd: string;

    if (growthType === 'yoy') {
      baselineStart = shiftDateBackOneYear(startDate);
      baselineEnd = shiftDateBackOneYear(endDate);
    } else {
      const now = new Date();
      const prevMonth = new Date(now);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      baselineStart = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
      baselineEnd = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    return await fetchGrowthFromApi(startDate, endDate, baselineStart, baselineEnd, {
      salesmanName,
      growthType,
      ...additionalFilterParams,
    });
  }, [fetchGrowthFromApi]);

  /**
   * 分析KPI指标增长率
   *
   * BACKLOG 2026-06-11-claude-2e311d：同 analyzeOrgPremiumGrowth，年份窗口
   * 改由 analysisYear 派生；基期沿用原有"始终按 yoy 方式"计算（保持修复前
   * 行为不变，本次仅修复年份来源与闰年安全性，不改变 growthType 语义）。
   */
  const analyzeKPIGrowth = useCallback(async (
    kpiMetric: string,
    growthType: 'yoy' | 'mom' | 'ytd' = 'yoy',
    dimension?: string[],
    additionalFilterParams?: Record<string, string>,
    analysisYear?: number
  ) => {
    const { startDate, endDate } = deriveGrowthYearWindow(analysisYear);
    const baselineStart = shiftDateBackOneYear(startDate);
    const baselineEnd = shiftDateBackOneYear(endDate);

    return await fetchGrowthFromApi(startDate, endDate, baselineStart, baselineEnd, {
      metric: kpiMetric,
      growthType,
      dimension: dimension?.join(','),
      ...additionalFilterParams,
    });
  }, [fetchGrowthFromApi]);

  /**
   * 自定义期间比较
   */
  const analyzeCustomPeriod = useCallback(async (
    currentPeriod: { startDate: string; endDate: string },
    baselinePeriod: { startDate: string; endDate: string },
    metric: string = 'SUM(premium)',
    groupBy?: string[],
    additionalFilterParams?: Record<string, string>
  ) => {
    // growthType=custom 强制走自定义期间比较（currentPeriod vs baselinePeriod），
    // 并把 metric（保费/件数视角）与 groupBy（按机构/业务员）传给后端，
    // 否则后端会退化为默认 yoy 月度序列且不分组。关键参数置于 additionalFilterParams
    // 之后，避免被筛选参数意外覆盖。
    return await fetchGrowthFromApi(
      currentPeriod.startDate,
      currentPeriod.endDate,
      baselinePeriod.startDate,
      baselinePeriod.endDate,
      {
        ...additionalFilterParams,
        growthType: 'custom',
        metric,
        ...(groupBy && groupBy.length > 0 ? { groupBy: groupBy.join(',') } : {}),
      },
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

    const apiFilters: Record<string, any> = {
      ...filters.additionalFilterParams,
      // 请求 daily-context 类型，后端将返回带 MTD/YTD 上下文的日度数据
      type: 'daily-context',
      growthType: 'custom',
    };
    // additionalFilterParams 中的 orgNames 是 RBAC 强制值（机构用户），手选机构不得覆盖
    // （后端 filter-params 中 orgNames 优先级最高）。BACKLOG 2026-07-03-claude-37cb58。
    if (!apiFilters.orgNames && filters.orgLevel3 && filters.orgLevel3.length > 0) {
      apiFilters.orgNames = filters.orgLevel3.join(',');
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
   *
   * BACKLOG 2026-06-11-claude-3ab3e3：dualMetricRequestSeqRef 独立于
   * growthRequestSeqRef 计数（两条数据流各自的 state 互不干扰），快速切换
   * 对比预设/分组维度时，旧的慢请求即使后回来也不会覆盖新请求已写入的
   * comparisonData（调用方 GrowthAnalysisPanel 的 setComparisonData 只在
   * result.success 时写入，故此处仍返回 success:true + data:[] 让调用方
   * 感知"已过期"但不因此报错；调用方可选择忽略 stale 响应）。
   */
  const analyzeDualMetricComparison = useCallback(async (
    currentPeriod: { startDate: string; endDate: string },
    previousPeriod: { startDate: string; endDate: string },
    groupBy: string[] = ['org_level_3'],
    additionalFilterParams?: Record<string, string>
  ): Promise<{ success: boolean; data: DualMetricComparisonData[]; error?: string; stale?: boolean }> => {
    const requestSeq = ++dualMetricRequestSeqRef.current;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      logger.info('双指标对比 API 查询执行');

      const response = await apiClient.getGrowthAnalysis(
        currentPeriod.startDate,
        currentPeriod.endDate,
        previousPeriod.startDate,
        previousPeriod.endDate,
        { growthType: 'custom', type: 'dual-metric', groupBy: groupBy.join(','), ...additionalFilterParams }
      );

      const useSalesmanDisplay = groupBy.includes('salesman_name');

      const data: DualMetricComparisonData[] = Array.isArray(response) ? response.map((row: Record<string, unknown>) => ({
        dim_key: useSalesmanDisplay
          ? formatSalesmanName(String(row.dim_key ?? row.salesman_name ?? '-'))
          : String(row.dim_key ?? row.org_level_3 ?? '-'),
        current_premium: Number(row.current_premium ?? 0),
        previous_premium: Number(row.previous_premium ?? 0),
        current_count: Number(row.current_count ?? 0),
        previous_count: Number(row.previous_count ?? 0),
        premium_growth_rate: row.premium_growth_rate != null ? Number(row.premium_growth_rate) : null,
        count_growth_rate: row.count_growth_rate != null ? Number(row.count_growth_rate) : null,
      })) : [];

      // 竞态守卫：响应回来时序号已非最新 → 丢弃，调用方不应据此更新 UI
      if (requestSeq !== dualMetricRequestSeqRef.current) {
        logger.info('双指标对比 API 响应已过期，丢弃（请求序号非最新）', { requestSeq, latest: dualMetricRequestSeqRef.current });
        return { success: false, data: [], stale: true };
      }

      setState(prev => ({
        ...prev,
        loading: false,
        error: null,
      }));

      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      if (requestSeq !== dualMetricRequestSeqRef.current) {
        return { success: false, data: [], error: errorMessage, stale: true };
      }

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
