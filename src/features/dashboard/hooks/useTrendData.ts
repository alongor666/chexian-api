import { useMemo } from 'react';
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
 * 双Y轴柱状+折线组合图数据点
 */
export interface PremiumTrendBarData {
  time_period: string;             // 对齐后的时间标签（去年份前缀）
  display_label: string;           // X轴显示标签
  current_premium: number;         // 本年保费（原值）
  prev_premium: number;            // 上年同期保费（原值）
  yoy_rate: number | null;         // 当期同比增长率
  achievement_rate: number | null; // 累计计划达成率（仅有计划时非null）
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
  /** 年度保费计划总额（万元），用于计算达成率折线。0 或 undefined 表示无计划 */
  planTotal?: number;
}

/**
 * useTrendData Hook 返回值
 */
export interface UseTrendDataResult {
  trendData: TrendDataPoint[];
  qualityBusinessData: QualityBusinessDataPoint[];
  barChartData: PremiumTrendBarData[];
  loading: boolean;
  qualityBusinessLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * 从 time_period 中提取年份和去年份后的对齐 key
 * - daily: "2026-03-15" → year="2026", key="-03-15"
 * - weekly: "2026-W12" → year="2026", key="-W12"
 * - monthly: "2026-03" → year="2026", key="-03"
 */
function splitTimePeriod(tp: string): { year: string; key: string } {
  const year = tp.slice(0, 4);
  const key = tp.slice(4); // everything after the 4-digit year
  return { year, key };
}

/**
 * 计算给定日期在一年中的天数进度 (0~1)
 */
function calcTimeProgress(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const year = d.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);
  const daysInYear = (endOfYear.getTime() - startOfYear.getTime()) / (1000 * 3600 * 24);
  const dayOfYear = (d.getTime() - startOfYear.getTime()) / (1000 * 3600 * 24) + 1;
  return Math.min(dayOfYear / daysInYear, 1);
}

/**
 * 将 time_period 对齐 key 转为可用于计算 timeProgress 的日期字符串
 */
function alignKeyToDate(key: string, currentYear: string): string {
  // monthly: "-03" → "2026-03-28" (月末近似)
  if (/^-\d{2}$/.test(key)) {
    const month = parseInt(key.slice(1));
    // 用下月1日-1天得到月末
    const lastDay = new Date(parseInt(currentYear), month, 0).getDate();
    return `${currentYear}-${key.slice(1)}-${String(lastDay).padStart(2, '0')}`;
  }
  // weekly: "-W12" → 估算为该周中间的日期
  if (/^-W\d{2}$/.test(key)) {
    const week = parseInt(key.slice(2));
    // 近似：第 week 周约在第 week*7 天
    const approxDay = Math.min(week * 7, 365);
    const d = new Date(parseInt(currentYear), 0, approxDay);
    return d.toISOString().slice(0, 10);
  }
  // daily: "-03-15" → "2026-03-15"
  return `${currentYear}${key}`;
}

/**
 * 将 time_period 的 key 转为人类可读的 X 轴标签
 */
function keyToDisplayLabel(key: string, timeView: TimeView): string {
  if (timeView === 'monthly' && /^-\d{2}$/.test(key)) {
    return `${parseInt(key.slice(1))}月`;
  }
  if (timeView === 'weekly' && /^-W\d{2}$/.test(key)) {
    return `W${key.slice(2)}`;
  }
  // daily: "-03-15" → "03-15"
  if (key.startsWith('-')) return key.slice(1);
  return key;
}

/**
 * 从趋势原始数据加工出双Y轴柱状+折线图数据
 */
function buildBarChartData(
  trendData: TrendDataPoint[],
  analysisYear: number,
  timeView: TimeView,
  planTotal?: number,
): PremiumTrendBarData[] {
  if (trendData.length === 0) return [];

  const currentYear = String(analysisYear);
  const prevYear = String(analysisYear - 1);

  // 1. 按 key 聚合（跨机构 SUM）
  const currentMap = new Map<string, number>();
  const prevMap = new Map<string, number>();

  for (const row of trendData) {
    const tp = row.time_period ?? '';
    if (!tp) continue;
    const { year, key } = splitTimePeriod(tp);
    const premium = row.premium ?? 0;
    if (year === currentYear) {
      currentMap.set(key, (currentMap.get(key) ?? 0) + premium);
    } else if (year === prevYear) {
      prevMap.set(key, (prevMap.get(key) ?? 0) + premium);
    }
  }

  // 2. 合并所有 key 并排序
  const allKeys = Array.from(new Set([...currentMap.keys(), ...prevMap.keys()])).sort();

  // 3. 构建结果，逐步累计当年保费
  let cumulativePremium = 0;
  const hasPlan = planTotal != null && planTotal > 0;

  return allKeys.map((key) => {
    const currentPremium = currentMap.get(key) ?? 0;
    const prevPremium = prevMap.get(key) ?? 0;
    cumulativePremium += currentPremium;

    const yoyRate = prevPremium > 0
      ? (currentPremium - prevPremium) / prevPremium
      : null;

    let achievementRate: number | null = null;
    if (hasPlan) {
      const dateStr = alignKeyToDate(key, currentYear);
      const progress = calcTimeProgress(dateStr);
      if (progress > 0) {
        const cumulativeWan = cumulativePremium / 10000;
        achievementRate = cumulativeWan / (planTotal * progress);
      }
    }

    return {
      time_period: key,
      display_label: keyToDisplayLabel(key, timeView),
      current_premium: currentPremium,
      prev_premium: prevPremium,
      yoy_rate: yoyRate,
      achievement_rate: achievementRate,
    };
  });
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
  planTotal,
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

  const analysisYear = filters.analysis_year ?? new Date().getFullYear();
  const barChartData = useMemo(
    () => buildBarChartData(trendData, analysisYear, timeView, planTotal),
    [trendData, analysisYear, timeView, planTotal],
  );

  return {
    trendData,
    qualityBusinessData,
    barChartData,
    loading,
    qualityBusinessLoading: loading,
    error: prefetched ? null : (error instanceof Error ? error : null),
    refresh: () => { void refetch(); },
  };
};
