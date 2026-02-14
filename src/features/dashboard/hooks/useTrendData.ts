import { useState, useEffect, useCallback, useRef } from 'react';
import { createLogger } from '../../../shared/utils/logger';
import { apiClient } from '../../../shared/api/client';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import type { AdvancedFilterState } from '../../../shared/types/data';
import type { ViewPerspective } from '../../../shared/types/view-perspective';

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
  perspective: _perspective = 'premium',
}: UseTrendDataOptions): UseTrendDataResult => {
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [qualityBusinessData] = useState<QualityBusinessDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [qualityBusinessLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const trendRequestIdRef = useRef(0);

  const fetchTrendFromApi = useCallback(async (requestId: number) => {
    try {
      const params = buildFilterParams(filters);
      const granularity = timeViewToGranularity(timeView);
      logger.info('趋势 API 查询执行', { timeView, granularity });

      const trendResponse = await apiClient.getTrend(granularity, params);

      if (requestId !== trendRequestIdRef.current) return;

      const orgLabel = hasOrgFilter ? (filters.org_level_3?.[0] || '机构') : '四川';
      const transformedData: TrendDataPoint[] = trendResponse.map((item) => ({
        time_period: item.time_period,
        org_level_3: item.org_level_3 || orgLabel,
        premium: item.premium,
        next_month_ratio: item.next_month_ratio ?? 0,
      }));

      setTrendData(transformedData);
      logger.info(`趋势 API 查询成功，获取 ${transformedData.length} 条数据`);
    } catch (err) {
      if (requestId !== trendRequestIdRef.current) return;
      throw err;
    }
  }, [filters, timeView, hasOrgFilter]);

  const fetchTrendData = useCallback(async () => {
    if (!enabled) return;

    const requestId = ++trendRequestIdRef.current;
    setLoading(true);
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
