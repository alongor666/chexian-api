import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '@/shared/types/data';
import { apiClient } from '@/shared/api/client';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { useRBAC } from '@/shared/hooks/useRBAC';
import type { PerformanceSegmentTag } from './usePerformanceSummary';

export type PerformanceTrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PerformanceTrendPoint {
  time_period: string;
  premium: number;
  auto_count: number;
}

export interface PerformanceTrendSeries {
  line_key: string;
  line_label: string;
  line_order: number;
  points: PerformanceTrendPoint[];
}

interface UsePerformanceTrendProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  granularity: PerformanceTrendGranularity;
  prefetchedRows?: Array<Record<string, unknown>>;
  enabled?: boolean;
}

interface UsePerformanceTrendResult {
  series: PerformanceTrendSeries[];
  loading: boolean;
  error: string | null;
}

function groupRowsToSeries(rows: Array<Record<string, unknown>>): PerformanceTrendSeries[] {
  const grouped = new Map<string, PerformanceTrendSeries>();

  rows.forEach((row) => {
    const lineKey = String(row.line_key ?? 'overall');
    const current = grouped.get(lineKey);
    const point: PerformanceTrendPoint = {
      time_period: String(row.time_period ?? ''),
      premium: Number(row.premium ?? 0),
      auto_count: Number(row.auto_count ?? 0),
    };

    if (!current) {
      grouped.set(lineKey, {
        line_key: lineKey,
        line_label: String(row.line_label ?? lineKey),
        line_order: Number(row.line_order ?? 99),
        points: [point],
      });
      return;
    }

    const updated: PerformanceTrendSeries = {
      ...current,
      points: [...current.points, point],
    };
    grouped.set(lineKey, updated);
  });

  return Array.from(grouped.values())
    .sort((a, b) => a.line_order - b.line_order)
    .map((item) => ({
      ...item,
      points: [...item.points].sort((a, b) => a.time_period.localeCompare(b.time_period)),
    }));
}

export function usePerformanceTrend({
  filters,
  segmentTag,
  granularity,
  prefetchedRows,
  enabled = true,
}: UsePerformanceTrendProps): UsePerformanceTrendResult {
  const { isOrgUser, userOrg } = useRBAC();

  const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
  delete filterParams.customerCategories;

  const params: Record<string, string> = {
    ...filterParams,
    segmentTag,
    granularity,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance-trend', params],
    queryFn: () => apiClient.performance.trend(params),
    enabled: enabled && !prefetchedRows,
    select: (result) => groupRowsToSeries(result?.rows || []),
  });

  const series = prefetchedRows ? groupRowsToSeries(prefetchedRows) : (data ?? []);

  return {
    series,
    loading: prefetchedRows ? false : isLoading,
    error: prefetchedRows ? null : (error ? (error instanceof Error ? error.message : String(error)) : null),
  };
}
