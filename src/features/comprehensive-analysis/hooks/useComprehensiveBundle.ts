import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/shared/api/client';
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
  reload: () => Promise<void>;
}

const logger = new Logger('ComprehensiveBundle');

export function useComprehensiveBundle(
  filters: AdvancedFilterState,
  maxDataDate?: string
): UseComprehensiveBundleResult {
  const { isOrgUser, userOrg } = useRBAC();
  const [data, setData] = useState<ComprehensiveViewModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
    const cutoffDate = filters.policy_date_end ?? maxDataDate;
    if (cutoffDate) {
      filterParams.cutoffDate = cutoffDate;
    }
    filterParams.granularity = 'monthly';
    return filterParams;
  }, [filters, isOrgUser, maxDataDate, userOrg]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getComprehensiveBundle(params);
      const thresholds = mergeThresholds(response.meta.thresholds);
      const overviewRows = adaptOverviewRows(response);
      const alertRows = response.overview.alerts.length > 0
        ? response.overview.alerts
        : buildOverviewAlerts(overviewRows, thresholds);

      setData({
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
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '综合分析数据加载失败';
      logger.error('failed to load comprehensive bundle', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

