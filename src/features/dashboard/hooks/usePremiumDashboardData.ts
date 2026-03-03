import { useQuery } from '@tanstack/react-query';
import { formatPremiumWan, formatSalesmanName } from '../../../shared/utils/formatters';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { queryKeys } from '../../../shared/api/query-keys';
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

const mapApiRows = (rows: any[]): SalesmanSummaryRow[] =>
  rows.map((row: any) => ({
    salesman_name: formatSalesmanName(String(row.salesman_name ?? '')),
    org_level_3: String(row.org_level_3 ?? ''),
    total_premium: formatPremiumWan(Number(row.total_premium ?? 0)),
    policy_count: Number(row.policy_count ?? 0),
  }));

export const usePremiumDashboardData = ({
  filters,
  prefetched,
  enabled = true,
}: UsePremiumDashboardDataOptions): UsePremiumDashboardDataResult => {
  const { isOrgUser, userOrg } = useRBAC();
  const params = buildFilterParams(filters, { isOrgUser, userOrg });

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.salesmanRanking(10, params),
    queryFn: async () => {
      logger.info('业务员排名 API 查询执行', params);

      const [allBusiness, qualityBusiness] = await Promise.all([
        apiClient.getSalesmanRanking(10, { rankingType: 'all', ...params }),
        apiClient.getSalesmanRanking(10, { rankingType: 'quality', ...params }),
      ]);

      return {
        allBusinessTop10: mapApiRows(allBusiness),
        qualityBusinessTop10: mapApiRows(qualityBusiness),
      };
    },
    enabled: enabled && !prefetched,
  });

  const allBusinessTop10 = prefetched?.allBusinessTop10 ?? data?.allBusinessTop10 ?? [];
  const qualityBusinessTop10 = prefetched?.qualityBusinessTop10 ?? data?.qualityBusinessTop10 ?? [];
  const tableLoading = prefetched ? false : isLoading;

  return {
    allBusinessTop10,
    qualityBusinessTop10,
    loading: { table: tableLoading },
    refresh: () => { void refetch(); },
  };
};
