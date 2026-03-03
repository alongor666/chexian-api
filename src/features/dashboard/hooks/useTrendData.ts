import { useQuery } from '@tanstack/react-query';
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
  prefetched?: {
    trendData: TrendDataPoint[];
    qualityBusinessData: QualityBusinessDataPoint[];
  };
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
 * 趋势数据获取 Hook（React Query 模式）
 */
export const useTrendData = ({
  filters,
  timeView,
  hasOrgFilter,
  prefetched,
  enabled = true,
  perspective = 'premium',
}: UseTrendDataOptions): UseTrendDataResult => {
  const { isOrgUser, userOrg } = useRBAC();
  const granularity = timeViewToGranularity(timeView);

  const currentParams = {
    ...buildFilterParams(filters, { isOrgUser, userOrg }),
    perspective,
  };

  // 构建上年参数
  const prevFilters = { ...filters };
  if (prevFilters.policy_date_start) {
    prevFilters.policy_date_start = prevFilters.policy_date_start.replace(
      /^\d{4}/,
      String((filters.analysis_year ?? new Date().getFullYear()) - 1),
    );
  }
  if (prevFilters.policy_date_end) {
    prevFilters.policy_date_end = prevFilters.policy_date_end.replace(
      /^\d{4}/,
      String((filters.analysis_year ?? new Date().getFullYear()) - 1),
    );
  }
  if (prevFilters.analysis_year) {
    prevFilters.analysis_year -= 1;
  }
  const prevParams = {
    ...buildFilterParams(prevFilters, { isOrgUser, userOrg }),
    perspective,
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['trend-bundle', granularity, currentParams, prevParams, hasOrgFilter],
    queryFn: async () => {
      logger.info('趋势 API 查询执行 (含同比)', { timeView, granularity });

      const [trendResponseCurrent, trendResponsePrev, qualityTrendResponse] = await Promise.all([
        apiClient.getTrend(granularity, currentParams),
        apiClient.getTrend(granularity, prevParams),
        apiClient.getQualityBusinessTrend(granularity, currentParams),
      ]);

      const orgLabel = hasOrgFilter ? (filters.org_level_3?.[0] ?? '机构') : '四川';

      const combineTrendData = (response: any[]): TrendDataPoint[] =>
        response.map((item) => ({
          time_period: item.time_period,
          org_level_3: item.org_level_3 || orgLabel,
          premium: item.premium,
          next_month_ratio: item.next_month_ratio ?? 0,
        }));

      const trendData: TrendDataPoint[] = [
        ...combineTrendData(trendResponsePrev),
        ...combineTrendData(trendResponseCurrent),
      ];

      const qualityBusinessData: QualityBusinessDataPoint[] = qualityTrendResponse.map((item) => ({
        time_period: item.time_period,
        quality_premium: item.quality_premium ?? 0,
        total_premium: item.total_premium ?? 0,
        quality_ratio: item.quality_ratio ?? 0,
      }));

      logger.info(
        `趋势 API 查询成功，获取 ${trendData.length} 条趋势数据，${qualityBusinessData.length} 条优质业务数据`,
      );

      return { trendData, qualityBusinessData };
    },
    enabled: enabled && !prefetched,
  });

  const trendData = prefetched?.trendData ?? data?.trendData ?? [];
  const qualityBusinessData = prefetched?.qualityBusinessData ?? data?.qualityBusinessData ?? [];
  const loading = prefetched ? false : isLoading;

  return {
    trendData,
    qualityBusinessData,
    loading,
    qualityBusinessLoading: loading,
    error: prefetched ? null : (error instanceof Error ? error : null),
    refresh: () => { void refetch(); },
  };
};
