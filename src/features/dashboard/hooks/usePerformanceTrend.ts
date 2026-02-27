import { useState, useEffect, useRef, useCallback } from 'react';
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

export function usePerformanceTrend({
  filters,
  segmentTag,
  granularity,
  prefetchedRows,
  enabled = true,
}: UsePerformanceTrendProps): UsePerformanceTrendResult {
  const { isOrgUser, userOrg } = useRBAC();
  const [series, setSeries] = useState<PerformanceTrendSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (prefetchedRows) {
      const grouped = new Map<string, PerformanceTrendSeries>();
      prefetchedRows.forEach((row) => {
        const lineKey = String(row.line_key ?? 'overall');
        const current = grouped.get(lineKey);
        if (!current) {
          grouped.set(lineKey, {
            line_key: lineKey,
            line_label: String(row.line_label ?? lineKey),
            line_order: Number(row.line_order ?? 99),
            points: [{
              time_period: String(row.time_period ?? ''),
              premium: Number(row.premium ?? 0),
              auto_count: Number(row.auto_count ?? 0),
            }],
          });
          return;
        }
        current.points.push({
          time_period: String(row.time_period ?? ''),
          premium: Number(row.premium ?? 0),
          auto_count: Number(row.auto_count ?? 0),
        });
      });

      setSeries(Array.from(grouped.values())
        .sort((a, b) => a.line_order - b.line_order)
        .map((item) => ({
          ...item,
          points: item.points.sort((a, b) => a.time_period.localeCompare(b.time_period)),
        })));
      setLoading(false);
      setError(null);
      return;
    }
    if (!enabled) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const filterParams = buildFilterParams(filters, { isOrgUser, userOrg });
      delete filterParams.customerCategories;

      const params: Record<string, string> = {
        ...filterParams,
        segmentTag,
        granularity,
      };

      const result = await apiClient.getPerformanceTrend(params);
      if (fetchId !== fetchIdRef.current) return;

      const grouped = new Map<string, PerformanceTrendSeries>();
      (result?.rows || []).forEach((row) => {
        const lineKey = String(row.line_key ?? 'overall');
        const current = grouped.get(lineKey);
        if (!current) {
          grouped.set(lineKey, {
            line_key: lineKey,
            line_label: String(row.line_label ?? lineKey),
            line_order: Number(row.line_order ?? 99),
            points: [{
              time_period: String(row.time_period ?? ''),
              premium: Number(row.premium ?? 0),
              auto_count: Number(row.auto_count ?? 0),
            }],
          });
          return;
        }
        current.points.push({
          time_period: String(row.time_period ?? ''),
          premium: Number(row.premium ?? 0),
          auto_count: Number(row.auto_count ?? 0),
        });
      });

      const mapped = Array.from(grouped.values())
        .sort((a, b) => a.line_order - b.line_order)
        .map((item) => ({
          ...item,
          points: item.points.sort((a, b) => a.time_period.localeCompare(b.time_period)),
        }));

      setSeries(mapped);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, filters, granularity, isOrgUser, prefetchedRows, segmentTag, userOrg]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { series, loading, error };
}
