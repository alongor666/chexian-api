import { useState, useEffect, useRef, useCallback } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';

export type PerformanceVehicleCategory = 'passenger' | 'business_passenger' | 'truck' | 'motorcycle';
export type PerformanceTimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type PerformanceGrowthMode = 'mom' | 'yoy';

export interface PerformanceSummaryRow {
  coverage_combination: string;
  premium: number;
  auto_count: number;
  avg_premium: number;
  growth_rate: number | null;
}

interface UsePerformanceSummaryProps {
  filters: AdvancedFilterState;
  vehicleCategory: PerformanceVehicleCategory;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  enabled?: boolean;
}

interface UsePerformanceSummaryResult {
  rows: PerformanceSummaryRow[];
  loading: boolean;
  error: string | null;
}

export function usePerformanceSummary({
  filters,
  vehicleCategory,
  timePeriod,
  growthMode,
  enabled = true,
}: UsePerformanceSummaryProps): UsePerformanceSummaryResult {
  const { isOrgUser, userOrg } = useRBAC();
  const [rows, setRows] = useState<PerformanceSummaryRow[]>([]);
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
        timePeriod,
        growthMode,
      };

      const result = await apiClient.getPerformanceSummary(params);
      if (fetchId !== fetchIdRef.current) return;

      const mapped = (result?.rows || []).map((row) => ({
        coverage_combination: String(row.coverage_combination ?? ''),
        premium: Number(row.premium ?? 0),
        auto_count: Number(row.auto_count ?? 0),
        avg_premium: Number(row.avg_premium ?? 0),
        growth_rate: row.growth_rate == null ? null : Number(row.growth_rate),
      }));

      setRows(mapped);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, filters, growthMode, isOrgUser, timePeriod, userOrg, vehicleCategory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, loading, error };
}

