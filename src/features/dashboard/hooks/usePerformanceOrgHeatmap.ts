import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { PerformanceGrowthMode, PerformanceSegmentTag, PerformanceTimePeriod } from './usePerformanceSummary';

export interface PerformanceOrgHeatmapRow {
  orgLevel3: string;
  policyDate: string;
  premium: number;
  planPremium: number | null;
  achievementRate: number | null;
  momGrowthRate: number | null;
  yoyGrowthRate: number | null;
}

interface UsePerformanceOrgHeatmapProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  growthMode: PerformanceGrowthMode;
  timePeriod: PerformanceTimePeriod;
  enabled?: boolean;
}

interface UsePerformanceOrgHeatmapResult {
  rows: PerformanceOrgHeatmapRow[];
  loading: boolean;
  error: string | null;
}

function mapHeatmapRow(row: Record<string, unknown>): PerformanceOrgHeatmapRow {
  return {
    orgLevel3: String(row.org_level_3 ?? ''),
    policyDate: String(row.policy_date ?? ''),
    premium: Number(row.premium ?? 0),
    planPremium: row.plan_premium == null ? null : Number(row.plan_premium),
    achievementRate: row.achievement_rate == null ? null : Number(row.achievement_rate),
    momGrowthRate: row.mom_growth_rate == null ? null : Number(row.mom_growth_rate),
    yoyGrowthRate: row.yoy_growth_rate == null ? null : Number(row.yoy_growth_rate),
  };
}

export function usePerformanceOrgHeatmap({
  filters,
  segmentTag,
  growthMode,
  timePeriod,
  enabled = true,
}: UsePerformanceOrgHeatmapProps): UsePerformanceOrgHeatmapResult {
  const { isOrgUser, userOrg } = useRBAC();
  const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
  delete filterParams.customerCategories;

  const params: Record<string, string> = {
    ...filterParams,
    segmentTag,
    growthMode,
    timePeriod,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance-org-heatmap', params],
    queryFn: () => apiClient.getPerformanceOrgHeatmap(params),
    select: (result) => (result?.rows || []).map(mapHeatmapRow),
    enabled,
  });

  return {
    rows: data ?? [],
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
