import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient, type PerformanceBundleResponse } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import { queryKeys } from '@/shared/api/query-keys';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceSummaryExpandDims,
  PerformanceTimePeriod,
} from './usePerformanceSummary';

interface UsePerformanceBundleProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  expandDims: PerformanceSummaryExpandDims;
  enabled?: boolean;
}

interface UsePerformanceBundleResult {
  bundle: PerformanceBundleResponse | null;
  loading: boolean;
  error: string | null;
}

export function usePerformanceBundle({
  filters,
  segmentTag,
  timePeriod,
  growthMode,
  expandDims,
  enabled = true,
}: UsePerformanceBundleProps): UsePerformanceBundleResult {
  const { isOrgUser, userOrg } = useRBAC();

  const defaultDrillPath = isOrgUser && userOrg
    ? [{ dimension: 'org_level_3', value: userOrg }]
    : [];
  const defaultGroupBy = isOrgUser ? 'salesman' : 'org_level_3';

  const params = {
    ...buildFilterParams(filters, { isOrgUser, userOrg }),
    drillPath: defaultDrillPath,
    groupBy: defaultGroupBy,
    segmentTag,
    timePeriod,
    growthMode,
    expandDims,
  };

  const { data, isFetching, error } = useQuery<PerformanceBundleResponse, Error>({
    queryKey: queryKeys.performanceBundle(params as Record<string, unknown>),
    queryFn: () => apiClient.getPerformanceBundle(params),
    enabled,
  });

  return {
    bundle: data ?? null,
    loading: isFetching,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}
