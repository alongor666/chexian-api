import { useEffect, useRef, useState } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient, type DashboardBundleResponse } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
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
  const [bundle, setBundle] = useState<DashboardBundleResponse | null>(null);
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
          granularity: timeViewToGranularity(timeView),
          perspective,
          rankingLimit: '10',
        };
        const result = await apiClient.getDashboardBundle(params);
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
  }, [enabled, filters, isOrgUser, perspective, timeView, userOrg]);

  return { bundle, loading, error };
}
