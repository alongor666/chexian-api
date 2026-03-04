/**
 * 交叉销售热力图 Hook
 *
 * 返回最近14个时段所有三级机构的热力图数据
 * 支持车辆类别、座位险保额、时间粒度过滤
 */

import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import { queryKeys } from '@/shared/api/query-keys';
import type { VehicleCategory, SeatCoverageLevel } from './useCrossSellTimePeriod';

export type CrossSellHeatmapTimePeriod = 'day' | 'week' | 'month' | 'quarter';

export interface HeatmapPoint {
  date: string;
  org_level_3: string;
  auto_count: number;
  driver_count: number;
  rate: number;
  avg_premium: number;
  achievement_rate: number | null;
}

interface UseCrossSellHeatmapProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  timePeriod?: CrossSellHeatmapTimePeriod;
  enabled?: boolean;
}

interface UseCrossSellHeatmapReturn {
  rows: HeatmapPoint[];
  loading: boolean;
  error: string | null;
}

export function useCrossSellHeatmap({
  filters,
  vehicleCategory,
  seatCoverageLevel,
  timePeriod = 'day',
  enabled = true,
}: UseCrossSellHeatmapProps): UseCrossSellHeatmapReturn {
  const { isOrgUser, userOrg } = useRBAC();

  const baseParams = buildFilterParams(filters, { isOrgUser, userOrg });

  const params: Record<string, string> = {
    ...baseParams,
    vehicleCategory,
    timePeriod,
  };
  if (seatCoverageLevel) {
    params.seatCoverageLevel = seatCoverageLevel;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.crossSellHeatmap(params),
    queryFn: () => apiClient.getCrossSellHeatmap(params),
    enabled,
    select: (result) =>
      (result?.rows || []).map((r) => ({
        date: String(r.date ?? ''),
        org_level_3: String(r.org_level_3 ?? ''),
        auto_count: Number(r.auto_count ?? 0),
        driver_count: Number(r.driver_count ?? 0),
        rate: Number(r.rate ?? 0),
        avg_premium: Number(r.avg_premium ?? 0),
        achievement_rate: r.achievement_rate == null ? null : Number(r.achievement_rate),
      })),
  });

  return {
    rows: data ?? [],
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}
