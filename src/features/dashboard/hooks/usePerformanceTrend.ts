import { useState, useEffect, useRef, useCallback } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { PerformanceVehicleCategory } from './usePerformanceSummary';

export type PerformanceTrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PerformanceTrendPoint {
  time_period: string;
  premium: number;
  auto_count: number;
}

interface UsePerformanceTrendProps {
  filters: AdvancedFilterState;
  vehicleCategory: PerformanceVehicleCategory;
  granularity: PerformanceTrendGranularity;
  enabled?: boolean;
}

interface UsePerformanceTrendResult {
  rows: PerformanceTrendPoint[];
  loading: boolean;
  error: string | null;
}

export function usePerformanceTrend({
  filters,
  vehicleCategory,
  granularity,
  enabled = true,
}: UsePerformanceTrendProps): UsePerformanceTrendResult {
  const { isOrgUser, userOrg } = useRBAC();
  const [rows, setRows] = useState<PerformanceTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {
        ...buildFilterParams(filters, { isOrgUser, userOrg }),
        vehicleCategory,
        granularity,
      };

      const result = await apiClient.getPerformanceTrend(params);
      if (fetchId !== fetchIdRef.current) return;

      setRows(
        (result?.rows || []).map((row) => ({
          time_period: String(row.time_period ?? ''),
          premium: Number(row.premium ?? 0),
          auto_count: Number(row.auto_count ?? 0),
        }))
      );
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, filters, granularity, isOrgUser, userOrg, vehicleCategory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, loading, error };
}

