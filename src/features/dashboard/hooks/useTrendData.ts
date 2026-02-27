import { useState, useEffect, useCallback, useRef } from 'react';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { ViewPerspective } from '../../../shared/types/view-perspective';
import { useRBAC } from '../../../shared/hooks/useRBAC';

const logger = createLogger('useTrendData');

/**
 * 时间视图类型
 */
export type TimeView = 'daily' | 'weekly' | 'monthly';

/**
 * 趋势数据点类型
 */
export interface TrendDataPoint {
  time_period: string;
  org_level_3: string;
  premium: number;
  next_month_ratio: number;
}

/**
 * 优质业务数据点类型
 */
export interface QualityBusinessDataPoint {
  time_period: string;
  quality_premium: number;
  total_premium: number;
  quality_ratio: number;
}

/**
 * useTrendData Hook 参数
 */
export interface UseTrendDataOptions {
  filters: AdvancedFilterState;
  timeView: TimeView;
  hasOrgFilter: boolean;
  enabled?: boolean;
  perspective?: ViewPerspective;
}

/**
 * useTrendData Hook 返回值
 */
export interface UseTrendDataResult {
  trendData: TrendDataPoint[];
  qualityBusinessData: QualityBusinessDataPoint[];
  loading: boolean;
  qualityBusinessLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * TimeView 转换为 API granularity 参数
 */
function timeViewToGranularity(timeView: TimeView): 'day' | 'week' | 'month' {
  switch (timeView) {
    case 'daily':
      return 'day';
    case 'weekly':
      return 'week';
    case 'monthly':
      return 'month';
    default:
      return 'day';
  }
}

/**
 * 趋势数据获取 Hook（API-only 模式）
 */
export const useTrendData = ({
  filters,
  timeView,
  hasOrgFilter,
  enabled = true,
  perspective = 'premium',
}: UseTrendDataOptions): UseTrendDataResult => {
  const { isOrgUser, userOrg } = useRBAC();
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [qualityBusinessData, setQualityBusinessData] = useState<QualityBusinessDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [qualityBusinessLoading, setQualityBusinessLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const trendRequestIdRef = useRef(0);

  const fetchTrendFromApi = useCallback(async (requestId: number) => {
    try {
      const currentParams = {
        ...buildFilterParams(filters, { isOrgUser, userOrg }),
        perspective,
      };

      // Construct params for previous year
      const prevFilters = { ...filters };
      if (prevFilters.policy_date_start) {
        prevFilters.policy_date_start = prevFilters.policy_date_start.replace(/^\d{4}/, String((filters.analysis_year || new Date().getFullYear()) - 1));
      }
      if (prevFilters.policy_date_end) {
        prevFilters.policy_date_end = prevFilters.policy_date_end.replace(/^\d{4}/, String((filters.analysis_year || new Date().getFullYear()) - 1));
      }
      if (prevFilters.analysis_year) {
        prevFilters.analysis_year -= 1;
      }
      const prevParams = {
        ...buildFilterParams(prevFilters, { isOrgUser, userOrg }),
        perspective,
      };

      const granularity = timeViewToGranularity(timeView);
      logger.info('趋势 API 查询执行 (含同比)', { timeView, granularity });

      const [trendResponseCurrent, trendResponsePrev, qualityTrendResponse] = await Promise.all([
        apiClient.getTrend(granularity, currentParams),
        apiClient.getTrend(granularity, prevParams),
        apiClient.getQualityBusinessTrend(granularity, currentParams),
      ]);

      if (requestId !== trendRequestIdRef.current) return;

      const orgLabel = hasOrgFilter ? (filters.org_level_3?.[0] || '机构') : '四川';

      const combineTrendData = (response: any[]) => response.map((item) => ({
        time_period: item.time_period,
        org_level_3: item.org_level_3 || orgLabel,
        premium: item.premium,
        next_month_ratio: item.next_month_ratio ?? 0,
      }));

      const transformedData: TrendDataPoint[] = [
        ...combineTrendData(trendResponsePrev),
        ...combineTrendData(trendResponseCurrent)
      ];
      const transformedQualityData: QualityBusinessDataPoint[] = qualityTrendResponse.map((item) => ({
        time_period: item.time_period,
        quality_premium: item.quality_premium ?? 0,
        total_premium: item.total_premium ?? 0,
        quality_ratio: item.quality_ratio ?? 0,
      }));

      setTrendData(transformedData);
      setQualityBusinessData(transformedQualityData);
      logger.info(`趋势 API 查询成功，获取 ${transformedData.length} 条趋势数据，${transformedQualityData.length} 条优质业务数据`);
    } catch (err) {
      if (requestId !== trendRequestIdRef.current) return;
      throw err;
    }
  }, [filters, timeView, hasOrgFilter, perspective]);

  const fetchTrendData = useCallback(async () => {
    if (!enabled) return;

    const requestId = ++trendRequestIdRef.current;
    setLoading(true);
    setQualityBusinessLoading(true);
    setError(null);

    try {
      await fetchTrendFromApi(requestId);
    } catch (err) {
      if (requestId !== trendRequestIdRef.current) return;
      logger.error('趋势查询错误:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      if (requestId === trendRequestIdRef.current) {
        setLoading(false);
        setQualityBusinessLoading(false);
      }
    }
  }, [enabled, fetchTrendFromApi]);

  useEffect(() => {
    void fetchTrendData();
  }, [fetchTrendData]);

  const refresh = useCallback(() => {
    void fetchTrendData();
  }, [fetchTrendData]);

  return {
    trendData,
    qualityBusinessData,
    loading,
    qualityBusinessLoading,
    error,
    refresh,
  };
};
