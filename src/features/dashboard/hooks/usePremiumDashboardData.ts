import { useCallback, useState, useRef } from 'react';
import { formatPremiumWan } from '../../../shared/utils/formatters';
import { createLogger } from '../../../shared/utils/logger';
import { useLoadingStates } from '../../../shared/hooks';
import { apiClient, isRequestAbortError } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { buildWhereClauseFromFilters } from '../../../shared/utils/queryBuilder';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { RoseChartDatum, SalesmanSummaryRow } from '../types';

const logger = createLogger('usePremiumDashboardData');

export interface UsePremiumDashboardDataOptions {
  filters: AdvancedFilterState;
  enabled?: boolean;
}

export interface UsePremiumDashboardDataResult {
  allBusinessTop10: SalesmanSummaryRow[];
  qualityBusinessTop10: SalesmanSummaryRow[];
  customerCategoryData: RoseChartDatum[];
  coverageCombinationData: RoseChartDatum[];
  terminalSourceData: RoseChartDatum[];
  loading: Record<'table' | 'customerCategory' | 'coverageCombination' | 'terminalSource', boolean>;
  refresh: () => void;
}

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

export const usePremiumDashboardData = ({
  filters,
  enabled = true,
}: UsePremiumDashboardDataOptions): UsePremiumDashboardDataResult => {
  const [allBusinessTop10, setAllBusinessTop10] = useState<SalesmanSummaryRow[]>([]);
  const [qualityBusinessTop10, setQualityBusinessTop10] = useState<SalesmanSummaryRow[]>([]);
  const [customerCategoryData, setCustomerCategoryData] = useState<RoseChartDatum[]>([]);
  const [coverageCombinationData, setCoverageCombinationData] = useState<RoseChartDatum[]>([]);
  const [terminalSourceData, setTerminalSourceData] = useState<RoseChartDatum[]>([]);
  const requestIdRef = useRef(0);

  const { loading, setLoading } = useLoadingStates([
    'table',
    'customerCategory',
    'coverageCombination',
    'terminalSource',
  ] as const);

  const refreshFromApi = useCallback(async (requestId: number) => {
    const params = buildFilterParams(filters);

    // 表格数据：业务员排名（传递完整筛选参数）
    setLoading('table', true);
    try {
      const [allBusiness, qualityBusiness] = await Promise.all([
        apiClient.getSalesmanRanking(10, {
          rankingType: 'all',
          ...params,
        }),
        apiClient.getSalesmanRanking(10, {
          rankingType: 'quality',
          ...params,
        }),
      ]);

      if (requestId !== requestIdRef.current) return;

      const mapApiRows = (rows: any[]): SalesmanSummaryRow[] =>
        rows.map((row: any) => ({
          salesman_name: String(row.salesman_name ?? ''),
          org_level_3: String(row.org_level_3 ?? ''),
          total_premium: formatPremiumWan(Number(row.total_premium ?? 0)),
          policy_count: Number(row.policy_count ?? 0),
        }));

      setAllBusinessTop10(mapApiRows(allBusiness));
      setQualityBusinessTop10(mapApiRows(qualityBusiness));
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (!isRequestAbortError(err)) logger.error('Table API Query Failed', err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading('table', false);
      }
    }

    // 玫瑰图数据：通过 custom SQL 查询（使用 buildWhereClauseFromFilters 构建 WHERE）
    const whereClause = buildWhereClauseFromFilters(filters);
    const roseQueries = [
      { key: 'customerCategory' as const, dim: 'customer_category', setter: setCustomerCategoryData },
      { key: 'coverageCombination' as const, dim: 'coverage_combination', setter: setCoverageCombinationData },
      { key: 'terminalSource' as const, dim: "CASE WHEN is_telemarketing THEN '电销' ELSE '非电销' END", setter: setTerminalSourceData },
    ];

    for (const { key, dim, setter } of roseQueries) {
      setLoading(key, true);
      try {
        const sql = buildDimensionShareSql(dim, 'SUM(premium)', whereClause);
        const rows = await apiClient.executeCustomQuery(sql);
        if (requestId !== requestIdRef.current) return;
        setter(rows.map((row: any) => ({
          name: String(row.dim_key ?? '未知'),
          value: Number(row.value ?? 0),
        })));
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        if (!isRequestAbortError(err)) logger.error(`${key} API Query Failed`, err);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(key, false);
        }
      }
    }
  }, [filters, setLoading]);

  const refresh = useCallback(() => {
    if (!enabled) return;

    const requestId = ++requestIdRef.current;
    void refreshFromApi(requestId);
  }, [enabled, refreshFromApi]);

  return {
    allBusinessTop10,
    qualityBusinessTop10,
    customerCategoryData,
    coverageCombinationData,
    terminalSourceData,
    loading,
    refresh,
  };
};
