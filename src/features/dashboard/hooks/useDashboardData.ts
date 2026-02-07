import { useCallback, useState, useRef } from 'react';
import { apiClient } from '../../../shared/api/client';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import { formatPremiumWan } from '../../../shared/utils/formatters';
import { createLogger } from '../../../shared/utils/logger';
import { useLoadingStates } from '../../../shared/hooks';
import type { KpiData } from '../../../shared/types/data';
import type { RoseChartDatum, SalesmanTableRow, TopNChartDatum } from '../types';

const logger = createLogger('useDashboardData');

/**
 * API 模式筛选参数
 */
export interface ApiFilters {
  startDate?: string;
  endDate?: string;
  orgLevel3?: string;
  salesmanName?: string;
}

export interface UseDashboardDataOptions {
  whereClause: string;
  filters?: ApiFilters;
  enabled?: boolean;
}

/** 数据加载状态键 */
export type DataLoadingKey =
  | 'kpi'
  | 'chart'
  | 'table'
  | 'customerCategory'
  | 'coverageCombination'
  | 'terminalSource';

/** 错误信息结构 */
export interface DataError {
  message: string;
  timestamp: number;
  retryable: boolean;
}

export interface UseDashboardDataResult {
  kpis: KpiData;
  chartData: TopNChartDatum[];
  tableData: SalesmanTableRow[];
  customerCategoryData: RoseChartDatum[];
  coverageCombinationData: RoseChartDatum[];
  terminalSourceData: RoseChartDatum[];
  loading: Record<DataLoadingKey, boolean>;
  errors: Record<DataLoadingKey, DataError | null>;
  hasErrors: boolean;
  clearErrors: () => void;
  clearError: (key: DataLoadingKey) => void;
  refresh: () => void;
}

/** 初始错误状态 */
const initialErrors: Record<DataLoadingKey, DataError | null> = {
  kpi: null,
  chart: null,
  table: null,
  customerCategory: null,
  coverageCombination: null,
  terminalSource: null,
};

/**
 * 生成维度占比查询 SQL（内联版本）
 */
function buildDimensionShareSql(
  dimensionExpr: string,
  metric: string,
  whereClause: string
): string {
  return `
    SELECT
      COALESCE(${dimensionExpr}, '未知') as dim_key,
      ${metric} as value
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY COALESCE(${dimensionExpr}, '未知')
    ORDER BY value DESC
  `;
}

export const useDashboardData = ({
  whereClause,
  filters = {},
  enabled = true,
}: UseDashboardDataOptions): UseDashboardDataResult => {
  const [kpis, setKpis] = useState<KpiData>({});
  const [chartData, setChartData] = useState<TopNChartDatum[]>([]);
  const [tableData, setTableData] = useState<SalesmanTableRow[]>([]);
  const [customerCategoryData, setCustomerCategoryData] = useState<RoseChartDatum[]>([]);
  const [coverageCombinationData, setCoverageCombinationData] = useState<RoseChartDatum[]>([]);
  const [terminalSourceData, setTerminalSourceData] = useState<RoseChartDatum[]>([]);

  const [errors, setErrors] = useState<Record<DataLoadingKey, DataError | null>>(initialErrors);

  const { isDataLoaded } = useDataStatus();

  const requestIdRef = useRef(0);

  const { loading, setLoading } = useLoadingStates([
    'kpi',
    'chart',
    'table',
    'customerCategory',
    'coverageCombination',
    'terminalSource',
  ] as const);

  const setError = useCallback((key: DataLoadingKey, error: Error | string | null) => {
    if (error === null) {
      setErrors(prev => ({ ...prev, [key]: null }));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError = message.includes('fetch') || message.includes('network') || message.includes('401');

    setErrors(prev => ({
      ...prev,
      [key]: {
        message,
        timestamp: Date.now(),
        retryable: isNetworkError || message.includes('timeout'),
      },
    }));

    logger.error(`[useDashboardData] ${key} 错误`, { message, retryable: isNetworkError });
  }, []);

  const clearErrors = useCallback(() => {
    setErrors(initialErrors);
  }, []);

  const clearError = useCallback((key: DataLoadingKey) => {
    setErrors(prev => ({ ...prev, [key]: null }));
  }, []);

  const hasErrors = Object.values(errors).some(e => e !== null);

  const refreshApi = useCallback(async (requestId: number) => {
    logger.info('[API Mode] 开始从后端获取数据', { filters, requestId });

    clearErrors();

    const checkValid = () => requestId === requestIdRef.current;

    // KPI 数据
    setLoading('kpi', true);
    setError('kpi', null);
    try {
      const kpiResult = await apiClient.getKpi(filters);

      if (!checkValid()) {
        logger.debug('[API Mode] KPI 结果已过期，丢弃');
        return;
      }

      setKpis({
        total_premium: kpiResult.total_premium,
        policy_count: kpiResult.policy_count,
        org_count: kpiResult.org_count,
        salesman_count: kpiResult.salesman_count,
        per_capita_premium: kpiResult.per_capita_premium,
        renewal_rate: kpiResult.renewal_rate,
        nev_rate: kpiResult.nev_rate,
        quality_business_rate: kpiResult.quality_business_rate,
        commercial_insurance_rate: kpiResult.commercial_insurance_rate,
      });
      logger.debug('[API Mode] KPI 数据获取成功', kpiResult);
    } catch (err) {
      if (checkValid()) {
        setError('kpi', err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (checkValid()) {
        setLoading('kpi', false);
      }
    }

    if (!checkValid()) return;

    // 业务员排名（用于图表）
    setLoading('chart', true);
    setError('chart', null);
    try {
      const rankingResult = await apiClient.getSalesmanRanking(20, filters);

      if (!checkValid()) {
        logger.debug('[API Mode] 图表结果已过期，丢弃');
        return;
      }

      const chartItems = rankingResult.map((row: Record<string, unknown>) => ({
        dim_key: String(row.salesman_name ?? row.dim_key ?? ''),
        value: Number(row.total_premium ?? row.premium ?? row.value ?? 0),
      }));
      setChartData(chartItems);
      logger.debug('[API Mode] 图表数据获取成功', { count: chartItems.length });
    } catch (err) {
      if (checkValid()) {
        setError('chart', err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (checkValid()) {
        setLoading('chart', false);
      }
    }

    if (!checkValid()) return;

    // 业务员明细表
    setLoading('table', true);
    setError('table', null);
    try {
      const tableResult = await apiClient.getSalesmanRanking(100, filters);

      if (!checkValid()) {
        logger.debug('[API Mode] 表格结果已过期，丢弃');
        return;
      }

      const tableItems = tableResult.map((row: Record<string, unknown>) => ({
        salesman_name: String(row.salesman_name ?? ''),
        org_level_3: String(row.org_level_3 ?? ''),
        signed_premium: formatPremiumWan(Number(row.total_premium ?? row.signed_premium ?? 0)),
        policy_count: Number(row.policy_count ?? 0),
      }));
      setTableData(tableItems);
      logger.debug('[API Mode] 表格数据获取成功', { count: tableItems.length });
    } catch (err) {
      if (checkValid()) {
        setError('table', err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (checkValid()) {
        setLoading('table', false);
      }
    }

    if (!checkValid()) return;

    // 玫瑰图数据 - 使用自定义 SQL 查询
    const roseQueries = [
      { key: 'customerCategory' as DataLoadingKey, expr: 'customer_category', setter: setCustomerCategoryData },
      { key: 'coverageCombination' as DataLoadingKey, expr: 'coverage_combination', setter: setCoverageCombinationData },
      { key: 'terminalSource' as DataLoadingKey, expr: "CASE WHEN is_telemarketing THEN '电销' ELSE '非电销' END", setter: setTerminalSourceData },
    ];

    for (const { key, expr, setter } of roseQueries) {
      if (!checkValid()) return;

      setLoading(key, true);
      setError(key, null);
      try {
        const sql = buildDimensionShareSql(expr, 'SUM(premium)', whereClause);
        const result = await apiClient.executeCustomQuery(sql);

        if (!checkValid()) {
          logger.debug(`[API Mode] ${key} 结果已过期，丢弃`);
          continue;
        }

        const data = result.map((row: Record<string, unknown>) => ({
          name: String(row.dim_key ?? ''),
          value: Number(row.value ?? 0),
        }));
        setter(data);
        logger.debug(`[API Mode] ${key} 数据获取成功`, { count: data.length });
      } catch (err) {
        if (checkValid()) {
          setError(key, err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (checkValid()) {
          setLoading(key, false);
        }
      }
    }
  }, [filters, whereClause, setLoading, setError, clearErrors]);

  const refresh = useCallback(() => {
    if (!enabled) return;

    const requestId = ++requestIdRef.current;

    logger.info('[useDashboardData] 开始刷新', {
      requestId,
      isDataLoaded,
    });

    refreshApi(requestId);
  }, [enabled, isDataLoaded, refreshApi]);

  return {
    kpis,
    chartData,
    tableData,
    customerCategoryData,
    coverageCombinationData,
    terminalSourceData,
    loading,
    errors,
    hasErrors,
    clearErrors,
    clearError,
    refresh,
  };
};
