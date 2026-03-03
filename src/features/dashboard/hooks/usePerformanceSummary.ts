import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';

export type PerformanceSegmentTag =
  | 'all'
  | 'non_business_passenger'
  | 'business_passenger'
  | 'business_truck'
  | 'non_business_truck'
  | 'motorcycle';
export type PerformanceTimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type PerformanceGrowthMode = 'mom' | 'yoy';
export type PerformanceSummaryExpandDims = 'none' | 'energy' | 'business_nature' | 'energy_business_nature';

export interface PerformanceSummaryRow {
  coverage_combination: string;
  row_label: string;
  row_level: number;
  expand_key: string | null;
  premium: number;
  auto_count: number;
  avg_premium: number;
  plan_premium: number | null;
  achievement_rate: number | null;
  growth_rate: number | null;
  nev_rate: number;
  renewal_rate: number;
  transfer_business_rate: number;
  new_car_rate: number;
  transfer_rate: number;
}

interface UsePerformanceSummaryProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  expandDims: PerformanceSummaryExpandDims;
  prefetchedRows?: PerformanceSummaryRow[];
  enabled?: boolean;
}

interface UsePerformanceSummaryResult {
  rows: PerformanceSummaryRow[];
  loading: boolean;
  error: string | null;
}

function mapSummaryRow(row: Record<string, unknown>): PerformanceSummaryRow {
  return {
    coverage_combination: String(row.coverage_combination ?? ''),
    row_label: String(row.row_label ?? row.coverage_combination ?? ''),
    row_level: Number(row.row_level ?? 0),
    expand_key: row.expand_key == null ? null : String(row.expand_key),
    premium: Number(row.premium ?? 0),
    auto_count: Number(row.auto_count ?? 0),
    avg_premium: Number(row.avg_premium ?? 0),
    plan_premium: row.plan_premium == null ? null : Number(row.plan_premium),
    achievement_rate: row.achievement_rate == null ? null : Number(row.achievement_rate),
    growth_rate: row.growth_rate == null ? null : Number(row.growth_rate),
    nev_rate: Number(row.nev_rate ?? 0),
    renewal_rate: Number(row.renewal_rate ?? 0),
    transfer_business_rate: Number(row.transfer_business_rate ?? 0),
    new_car_rate: Number(row.new_car_rate ?? 0),
    transfer_rate: Number(row.transfer_rate ?? 0),
  };
}

export function usePerformanceSummary({
  filters,
  segmentTag,
  timePeriod,
  growthMode,
  expandDims,
  prefetchedRows,
  enabled = true,
}: UsePerformanceSummaryProps): UsePerformanceSummaryResult {
  const { isOrgUser, userOrg } = useRBAC();

  const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
  delete filterParams.customerCategories;

  const params: Record<string, string> = {
    ...filterParams,
    segmentTag,
    timePeriod,
    growthMode,
    expandDims,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance-summary', params],
    queryFn: () => apiClient.getPerformanceSummary(params),
    enabled: enabled && !prefetchedRows,
    select: (result) => (result?.rows || []).map(mapSummaryRow),
  });

  const rows = prefetchedRows ?? data ?? [];

  return {
    rows,
    loading: prefetchedRows ? false : isLoading,
    error: prefetchedRows ? null : (error ? (error instanceof Error ? error.message : String(error)) : null),
  };
}
