import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { queryKeys } from '@/shared/api/query-keys';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { Logger } from '@/shared/utils/logger';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { AdvancedFilterState } from '@/shared/types';
import {
  adaptCostRows,
  adaptExpenseRows,
  adaptExpenseSurplusRows,
  adaptLossQuadrantRows,
  adaptLossTrendRows,
  adaptOverviewRows,
  adaptOverviewSummary,
  adaptPremiumRows,
  adaptRoiRows,
} from '../adapters';
import { buildOverviewAlerts, mergeThresholds } from '../rules';
import type { ComprehensiveViewModel } from '../types';

interface UseComprehensiveBundleResult {
  data: ComprehensiveViewModel | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const logger = new Logger('ComprehensiveBundle');

export function useComprehensiveBundle(
  filters: AdvancedFilterState,
  maxDataDate?: string
): UseComprehensiveBundleResult {
  const { isOrgUser, userOrg } = useRBAC();
  const queryClient = useQueryClient();

  const params = useMemo(() => {
    const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
    const cutoffDate = filters.policy_date_end ?? maxDataDate;
    if (cutoffDate) {
      filterParams.cutoffDate = cutoffDate;
    }
    filterParams.granularity = 'monthly';
    return filterParams;
  }, [filters, isOrgUser, maxDataDate, userOrg]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.comprehensiveBundle(params),
    queryFn: () => apiClient.getComprehensiveBundle(params),
    select: (response) => {
      const thresholds = mergeThresholds(response.meta.thresholds);
      const overviewRows = adaptOverviewRows(response);
      const alertRows =
        response.overview.alerts.length > 0
          ? response.overview.alerts
          : buildOverviewAlerts(overviewRows, thresholds);

      const viewModel: ComprehensiveViewModel = {
        meta: {
          cutoffDate: response.meta.cutoffDate,
          maxDataDate: response.meta.maxDataDate,
          planYear: response.meta.planYear,
          orgScope: response.meta.orgScope,
          permissionFilter: response.meta.permissionFilter,
          thresholds,
          timeProgress: response.meta.timeProgress ?? null,
        },
        overview: {
          summary: adaptOverviewSummary(response),
          rows: overviewRows,
          alerts: alertRows,
        },
        premium: {
          rows: adaptPremiumRows(response),
        },
        cost: {
          rows: adaptCostRows(response),
        },
        loss: {
          quadrantRows: adaptLossQuadrantRows(response),
          trendRows: adaptLossTrendRows(response),
        },
        expense: {
          rows: adaptExpenseRows(response),
          surplusRows: adaptExpenseSurplusRows(response),
        },
        roi: {
          rows: adaptRoiRows(response),
        },
      };

      return viewModel;
    },
  });

  const reload = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.comprehensiveBundle(params),
    });
  };

  const errorMessage = error instanceof Error
    ? (() => {
        logger.error('failed to load comprehensive bundle', error);
        return error.message;
      })()
    : error != null
      ? '综合分析数据加载失败'
      : null;

  return {
    data: data ?? null,
    loading: isLoading,
    error: errorMessage,
    reload,
  };
}
