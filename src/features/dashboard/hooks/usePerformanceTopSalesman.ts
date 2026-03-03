import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { formatSalesmanName } from '@/shared/utils/formatters';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceTimePeriod,
} from './usePerformanceSummary';

export interface PerformanceTopSalesmanRow {
  dimension_name: string;
  premium: number;
  auto_count: number;
  plan_premium: number | null;
  achievement_rate: number | null;
  growth_rate: number | null;
  quadrant?: string;
  nev_rate: number;
  renewal_rate: number;
  transfer_business_rate: number;
  new_car_rate: number;
  transfer_rate: number;
}

interface UsePerformanceTopSalesmanProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  prefetchedRows?: Array<Record<string, unknown>>;
  enabled?: boolean;
}

interface UsePerformanceTopSalesmanReturn {
  rows: PerformanceTopSalesmanRow[];
  loading: boolean;
  error: string | null;
}

function mapTopSalesmanRow(row: Record<string, unknown>): PerformanceTopSalesmanRow {
  return {
    dimension_name: formatSalesmanName(String(row.dimension_name ?? '')),
    premium: Number(row.premium ?? 0),
    auto_count: Number(row.auto_count ?? 0),
    plan_premium: row.plan_premium == null ? null : Number(row.plan_premium),
    achievement_rate: row.achievement_rate == null ? null : Number(row.achievement_rate),
    growth_rate: row.growth_rate == null ? null : Number(row.growth_rate),
    quadrant: row.quadrant == null ? undefined : String(row.quadrant),
    nev_rate: Number(row.nev_rate ?? 0),
    renewal_rate: Number(row.renewal_rate ?? 0),
    transfer_business_rate: Number(row.transfer_business_rate ?? 0),
    new_car_rate: Number(row.new_car_rate ?? 0),
    transfer_rate: Number(row.transfer_rate ?? 0),
  };
}

export function usePerformanceTopSalesman({
  filters,
  segmentTag,
  timePeriod,
  growthMode,
  prefetchedRows,
  enabled = true,
}: UsePerformanceTopSalesmanProps): UsePerformanceTopSalesmanReturn {
  const { isOrgUser, userOrg } = useRBAC();

  const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
  delete filterParams.customerCategories;

  const params: Record<string, string> = {
    ...filterParams,
    segmentTag,
    timePeriod,
    growthMode,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance-top-salesman', params],
    queryFn: () => apiClient.getPerformanceTopSalesman(params),
    enabled: enabled && !prefetchedRows,
    select: (result) => (result?.rows || []).map(mapTopSalesmanRow),
  });

  const rows = prefetchedRows ? prefetchedRows.map(mapTopSalesmanRow) : (data ?? []);

  return {
    rows,
    loading: prefetchedRows ? false : isLoading,
    error: prefetchedRows ? null : (error ? (error instanceof Error ? error.message : String(error)) : null),
  };
}
