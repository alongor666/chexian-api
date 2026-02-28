import { useCallback, useEffect, useState, useRef } from 'react';
import { formatPremiumWan, formatSalesmanName } from '../../../shared/utils/formatters';
import { createLogger } from '../../../shared/utils/logger';
import { useLoadingStates } from '../../../shared/hooks';
import { apiClient, isRequestAbortError } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { SalesmanSummaryRow } from '../types';
import { useRBAC } from '../../../shared/hooks/useRBAC';

const logger = createLogger('usePremiumDashboardData');

export interface UsePremiumDashboardDataOptions {
  filters: AdvancedFilterState;
  prefetched?: {
    allBusinessTop10: SalesmanSummaryRow[];
    qualityBusinessTop10: SalesmanSummaryRow[];
  };
  enabled?: boolean;
}

export interface UsePremiumDashboardDataResult {
  allBusinessTop10: SalesmanSummaryRow[];
  qualityBusinessTop10: SalesmanSummaryRow[];
  loading: Record<'table', boolean>;
  refresh: () => void;
}

export const usePremiumDashboardData = ({
  filters,
  prefetched,
  enabled = true,
}: UsePremiumDashboardDataOptions): UsePremiumDashboardDataResult => {
  const { isOrgUser, userOrg } = useRBAC();
  const [allBusinessTop10, setAllBusinessTop10] = useState<SalesmanSummaryRow[]>([]);
  const [qualityBusinessTop10, setQualityBusinessTop10] = useState<SalesmanSummaryRow[]>([]);
  const requestIdRef = useRef(0);

  const { loading, setLoading } = useLoadingStates(['table'] as const);

  useEffect(() => {
    if (!prefetched) return;
    setAllBusinessTop10(prefetched.allBusinessTop10 || []);
    setQualityBusinessTop10(prefetched.qualityBusinessTop10 || []);
    setLoading('table', false);
  }, [prefetched, setLoading]);

  const refreshFromApi = useCallback(async (requestId: number) => {
    const params = buildFilterParams(filters, { isOrgUser, userOrg });

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
          salesman_name: formatSalesmanName(String(row.salesman_name ?? '')),
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
  }, [filters, setLoading]);

  const refresh = useCallback(() => {
    if (prefetched) {
      setAllBusinessTop10(prefetched.allBusinessTop10 || []);
      setQualityBusinessTop10(prefetched.qualityBusinessTop10 || []);
      setLoading('table', false);
      return;
    }
    if (!enabled) return;

    const requestId = ++requestIdRef.current;
    void refreshFromApi(requestId);
  }, [enabled, prefetched, refreshFromApi, setLoading]);

  return {
    allBusinessTop10,
    qualityBusinessTop10,
    loading,
    refresh,
  };
};
