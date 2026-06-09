/**
 * 驾意险推介率走势 Hook
 * Cross-Sell Recommendation Rate Trend Hook
 *
 * 按时间粒度（日/周/月/季度）返回 4 条险别组合的推介率时序数据
 */

import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import { queryKeys } from '@/shared/api/query-keys';
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

  const params: Record<string, string> = {
    ...buildFilterParams(filters, { isOrgUser, userOrg }),
    vehicleCategory,
    granularity,
  };
  if (seatCoverageLevel) {
    params.seatCoverageLevel = seatCoverageLevel;
  }
  if (requestKey) {
    params._requestKey = requestKey;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.crossSellTrend(params),
    queryFn: () => apiClient.crossSell.trend(params),
    enabled,
    select: (result) =>
      (result?.rows || []).map((r) => ({
        time_period: String(r.time_period ?? ''),
        coverage_combination: String(r.coverage_combination ?? ''),
        rate: Number(r.rate ?? 0),
        avg_premium: Number(r.avg_premium ?? 0),
        auto_count: Number(r.auto_count ?? 0),
      })),
  });

  return {
    rows: data ?? [],
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}
