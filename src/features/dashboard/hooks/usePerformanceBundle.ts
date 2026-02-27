import { useEffect, useRef, useState } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient, type PerformanceBundleResponse } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
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
  const [bundle, setBundle] = useState<PerformanceBundleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const params = {
          ...buildFilterParams(filters, { isOrgUser, userOrg }),
          segmentTag,
          timePeriod,
          growthMode,
          expandDims,
        };
        const result = await apiClient.getPerformanceBundle(params);
        if (fetchId !== fetchIdRef.current) return;
        setBundle(result);
      } catch (err) {
        if (fetchId !== fetchIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
        }
      }
    };

    void run();
  }, [enabled, expandDims, filters, growthMode, isOrgUser, segmentTag, timePeriod, userOrg]);

  return { bundle, loading, error };
}
