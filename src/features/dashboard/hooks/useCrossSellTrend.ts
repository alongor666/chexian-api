/**
 * 驾乘险推介率走势 Hook
 * Cross-Sell Recommendation Rate Trend Hook
 *
 * 按时间粒度（日/周/月/季度）返回 4 条险别组合的推介率时序数据
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { VehicleCategory, SeatCoverageLevel } from './useCrossSellTimePeriod';

export type TrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface TrendPoint {
  time_period: string;
  coverage_combination: string;
  rate: number;
  avg_premium: number;
  auto_count: number;
}

interface UseCrossSellTrendProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  granularity: TrendGranularity;
  enabled?: boolean;
  requestKey?: string;
}

interface UseCrossSellTrendReturn {
  rows: TrendPoint[];
  loading: boolean;
  error: string | null;
}

export function useCrossSellTrend({
  filters,
  vehicleCategory,
  seatCoverageLevel,
  granularity,
  enabled = true,
  requestKey,
}: UseCrossSellTrendProps): UseCrossSellTrendReturn {
  const { isOrgUser, userOrg } = useRBAC();
  const [rows, setRows] = useState<TrendPoint[]>([]);
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
      if (seatCoverageLevel) {
        params.seatCoverageLevel = seatCoverageLevel;
      }
      const result = await apiClient.getCrossSellTrend(params);
      if (fetchId !== fetchIdRef.current) return;
      setRows(
        (result?.rows || []).map((r) => ({
          time_period: String(r.time_period ?? ''),
          coverage_combination: String(r.coverage_combination ?? ''),
          rate: Number(r.rate ?? 0),
          avg_premium: Number(r.avg_premium ?? 0),
          auto_count: Number(r.auto_count ?? 0),
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
  }, [filters, vehicleCategory, seatCoverageLevel, granularity, enabled, isOrgUser, userOrg, requestKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, loading, error };
}
