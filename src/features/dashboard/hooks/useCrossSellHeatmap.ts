/**
 * 交叉销售热力图 Hook
 *
 * 返回最近15个时段所有分组维度的热力图数据
 * 支持车辆类别、座位险保额、时间粒度过滤、维度切换
 */

import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import { queryKeys } from '@/shared/api/query-keys';
import type { VehicleCategory, SeatCoverageLevel } from './useCrossSellTimePeriod';

export type CrossSellHeatmapTimePeriod = 'day' | 'week' | 'month' | 'quarter';

export interface CrossSellHeatmapDrillStep {
  dimension: CrossSellHeatmapDimension;
  value: string;
}

export type CrossSellHeatmapDimension = 'org_level_3' | 'team' | 'salesman' | 'coverage_combination' | 'energy_type' | 'business_nature';

export const CROSS_SELL_HEATMAP_DIMENSION_LABELS: Record<CrossSellHeatmapDimension, string> = {
  org_level_3: '三级机构',
  team: '团队',
  salesman: '业务员',
  coverage_combination: '险别组合',
  energy_type: '能源类型',
  business_nature: '新转续',
};

export interface HeatmapPoint {
  date: string;
  org_level_3: string;
  auto_count: number;
  driver_count: number;
  driver_policy_count: number;
  driver_premium: number;
  penetration_base_premium: number;
  rate: number;
  penetration_rate: number | null;
  avg_premium: number;
  achievement_rate: number | null;
}

interface UseCrossSellHeatmapProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  timePeriod?: CrossSellHeatmapTimePeriod;
  groupByDimension?: CrossSellHeatmapDimension;
  drillFilter?: CrossSellHeatmapDrillStep[];
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
  groupByDimension = 'org_level_3',
  drillFilter = [],
  enabled = true,
}: UseCrossSellHeatmapProps): UseCrossSellHeatmapReturn {
  const { isOrgUser, userOrg } = useRBAC();

  const baseParams = buildFilterParams(filters, { isOrgUser, userOrg });

  const params: Record<string, string> = {
    ...baseParams,
    vehicleCategory,
    timePeriod,
    groupByDimension,
    drillFilter: JSON.stringify(drillFilter),
  };
  if (seatCoverageLevel) {
    params.seatCoverageLevel = seatCoverageLevel;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.crossSellHeatmap(params),
    queryFn: () => apiClient.crossSell.heatmap(params),
    enabled,
    select: (result) =>
      (result?.rows || []).map((r) => ({
        date: String(r.date ?? ''),
        org_level_3: String(r.org_level_3 ?? ''),
        auto_count: Number(r.auto_count ?? 0),
        driver_count: Number(r.driver_count ?? 0),
        driver_policy_count: Number(r.driver_policy_count ?? 0),
        driver_premium: Number(r.driver_premium ?? 0),
        penetration_base_premium: Number(r.penetration_base_premium ?? 0),
        rate: Number(r.rate ?? 0),
        penetration_rate: r.penetration_rate == null ? null : Number(r.penetration_rate),
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
