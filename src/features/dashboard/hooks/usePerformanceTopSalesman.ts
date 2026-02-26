import { useState, useEffect, useRef, useCallback } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type {
  PerformanceGrowthMode,
  PerformanceTimePeriod,
  PerformanceVehicleCategory,
} from './usePerformanceSummary';

export interface PerformanceTopSalesmanRow {
  dimension_name: string;
  org_level_3: string;
  premium: number;
  auto_count: number;
  achievement_rate: number | null;
  growth_rate: number | null;
  nev_rate: number;
  renewal_rate: number;
  transfer_business_rate: number;
  new_car_rate: number;
  transfer_rate: number;
}

interface UsePerformanceTopSalesmanProps {
  filters: AdvancedFilterState;
  vehicleCategory: PerformanceVehicleCategory;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  enabled?: boolean;
}

interface UsePerformanceTopSalesmanReturn {
  rows: PerformanceTopSalesmanRow[];
  loading: boolean;
  error: string | null;
}

export function usePerformanceTopSalesman({
  filters,
  vehicleCategory,
  timePeriod,
  growthMode,
  enabled = true,
}: UsePerformanceTopSalesmanProps): UsePerformanceTopSalesmanReturn {
  const { isOrgUser, userOrg } = useRBAC();
  const [rows, setRows] = useState<PerformanceTopSalesmanRow[]>([]);
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

      const result = await apiClient.getPerformanceTopSalesman(params);
      if (fetchId !== fetchIdRef.current) return;

      setRows((result?.rows || []).map((row) => ({
        dimension_name: String(row.dimension_name ?? ''),
        org_level_3: String(row.org_level_3 ?? ''),
        premium: Number(row.premium ?? 0),
        auto_count: Number(row.auto_count ?? 0),
        achievement_rate: row.achievement_rate == null ? null : Number(row.achievement_rate),
        growth_rate: row.growth_rate == null ? null : Number(row.growth_rate),
        nev_rate: Number(row.nev_rate ?? 0),
        renewal_rate: Number(row.renewal_rate ?? 0),
        transfer_business_rate: Number(row.transfer_business_rate ?? 0),
        new_car_rate: Number(row.new_car_rate ?? 0),
        transfer_rate: Number(row.transfer_rate ?? 0),
      })));
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

