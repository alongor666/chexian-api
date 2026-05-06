import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient, type DashboardBundleResponse } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { queryKeys } from '@/shared/api/query-keys';
import type { TimeView } from './useTrendData';
import type { ViewPerspective } from '@/shared/types/view-perspective';
import { useRBAC } from '@/shared/hooks/useRBAC';

function timeViewToGranularity(timeView: TimeView): 'day' | 'week' | 'month' {
  switch (timeView) {
    case 'daily':
      return 'day';
    case 'weekly':
      return 'week';
    case 'monthly':
      return 'month';
    default:
      return 'week';
  }
}

interface UseDashboardBundleProps {
  filters: AdvancedFilterState;
  timeView: TimeView;
  perspective: ViewPerspective;
  enabled?: boolean;
}

interface UseDashboardBundleResult {
  bundle: DashboardBundleResponse | null;
  loading: boolean;
  error: string | null;
}

export function useDashboardBundle({
  filters,
  timeView,
  perspective,
  enabled = true,
}: UseDashboardBundleProps): UseDashboardBundleResult {
  const { isOrgUser, userOrg } = useRBAC();
  const hasDateRange = Boolean(filters.policy_date_start && filters.policy_date_end);

  const params = {
    ...buildFilterParams(filters, { isOrgUser, userOrg }),
    granularity: timeViewToGranularity(timeView),
    perspective,
    rankingLimit: '10',
  };

  const { data, isLoading, error } = useQuery<DashboardBundleResponse, Error>({
    queryKey: queryKeys.dashboardBundle(params),
    queryFn: () => apiClient.getDashboardBundle(params),
    enabled: enabled && hasDateRange,
  });

  return {
    bundle: data ?? null,
    loading: hasDateRange ? isLoading : enabled,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
