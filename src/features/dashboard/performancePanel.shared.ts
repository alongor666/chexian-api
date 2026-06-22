// 从 PerformanceAnalysisPanel.tsx 抽出的共享类型 / 常量 / 纯 helper（b331 拆分·行为零变更）。
// 依赖方向：本文件 → @/shared + ./hooks + ./performanceStatus 等；**禁止** import ../PerformanceAnalysisPanel（避免循环）。
import type { TabItem } from '@/shared/ui/Tabs';
import type { AdvancedFilterState } from '@/shared/types/data';
import { cn } from '@/shared/styles';
import { formatCount, formatWanAdaptive } from '@/shared/utils/formatters';
import {
  classifyAchievementBand,
  classifyGrowthBand,
  getAchievementTextClass,
  getGrowthTextClass,
} from './performanceStatus';
import type { PerformanceDimension } from './hooks/usePerformanceDrilldown';
import type {
  PerformanceGrowthMode,
  PerformanceTimePeriod,
  PerformanceSegmentTag,
} from './hooks/usePerformanceSummary';
import type { HeatmapDimension } from './hooks/usePerformanceOrgHeatmap';
import type { HeatmapMetric } from './performance/PerformanceOrgHeatmapV2';
import type { PerformanceHeatmapSelection } from './utils/performanceHeatmapSelection';

export interface PerformanceAnalysisPanelProps {
  filters: AdvancedFilterState;
  segmentTag: PerformanceSegmentTag;
  timePeriod: PerformanceTimePeriod;
  growthMode: PerformanceGrowthMode;
  onTimePeriodChange?: (v: PerformanceTimePeriod) => void;
  onGrowthModeChange?: (v: PerformanceGrowthMode) => void;
  defaultHeatmapMetric?: HeatmapMetric;
}

export interface PerformanceDrilldownPrefetchedData {
  summary: Record<string, unknown> | null;
  rows: Array<Record<string, unknown>>;
}

export function resolvePerformanceDrilldownPrefetched(
  prefetched: PerformanceDrilldownPrefetchedData | undefined,
  useLegacyDrilldown: boolean
): PerformanceDrilldownPrefetchedData | undefined {
  return useLegacyDrilldown ? undefined : prefetched;
}

export const PERFORMANCE_HEATMAP_PERIOD_COUNT = 15;

/** 热力图下钻可选维度，静态常量（模块级，避免组件每次渲染重建数组） */
export const PERF_HEATMAP_DRILL_DIMENSIONS: { key: HeatmapDimension; label: string }[] = [
  { key: 'org_level_3', label: '三级机构' },
  { key: 'team', label: '团队' },
  { key: 'salesman', label: '业务员' },
  { key: 'customer_category', label: '客户类别' },
  { key: 'coverage_combination', label: '险别组合' },
  { key: 'energy_type', label: '能源类型' },
  { key: 'business_nature', label: '新转续' },
  { key: 'insurance_grade', label: '风险评分' },
];

function getPerformanceHeatmapPeriodUnit(timePeriod: PerformanceTimePeriod): string {
  switch (timePeriod) {
    case 'day':
      return '天';
    case 'week':
      return '周';
    case 'month':
      return '月';
    case 'quarter':
      return '季度';
    case 'year':
      return '年';
    default:
      return '天';
  }
}

export function getPerformanceHeatmapTitle(timePeriod: PerformanceTimePeriod, dimensionLabel = '三级机构'): string {
  return `${dimensionLabel}连续${PERFORMANCE_HEATMAP_PERIOD_COUNT}${getPerformanceHeatmapPeriodUnit(timePeriod)}热力图`;
}

export function getPerformanceDrilldownTitle(
  currentGroupBy: PerformanceDimension | null,
  currentDimensionLabel: string,
  heatmapSelection: PerformanceHeatmapSelection | null
): string {
  if (!currentGroupBy) {
    return '下钻分析';
  }

  const details = [`已选维度：${currentDimensionLabel}`];
  if (heatmapSelection?.org) {
    details.push(`热力图机构：${heatmapSelection.org}`);
  }
  return `下钻分析（${details.join(' · ')}）`;
}

export const SEGMENT_TABS: TabItem[] = [
  { key: 'all', label: '全部' },
  { key: 'non_business_passenger', label: '非营客' },
  { key: 'business_passenger', label: '营客' },
  { key: 'business_truck', label: '营货' },
  { key: 'non_business_truck', label: '非营货' },
  { key: 'motorcycle', label: '摩托车' },
];

export const TIME_PERIOD_TABS: TabItem[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
  { key: 'year', label: '年' },
];

export const GROWTH_MODE_TABS: TabItem[] = [
  { key: 'mom', label: '环比' },
  { key: 'yoy', label: '同比' },
];

export const SEGMENT_OPTIONS = [
  { value: 'all', label: '全部客户' },
  { value: 'non_business_passenger', label: '非营客' },
  { value: 'business_passenger', label: '营客' },
  { value: 'business_truck', label: '营货' },
  { value: 'non_business_truck', label: '非营货' },
  { value: 'motorcycle', label: '摩托车' },
];

export const EXPAND_DIMS_TABS: TabItem[] = [
  { key: 'none', label: '不展开' },
  { key: 'energy', label: '油电' },
  { key: 'business_nature', label: '新转续' },
  { key: 'energy_business_nature', label: '油电+新转续' },
];

export const SUMMARY_ORDER = ['整体', '主全', '交三', '单交'];

export function mapTimePeriodToTrendGranularity(timePeriod: PerformanceTimePeriod): 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' {
  switch (timePeriod) {
    case 'day':
      return 'daily';
    case 'week':
      return 'weekly';
    case 'month':
      return 'monthly';
    case 'quarter':
      return 'quarterly';
    case 'year':
      return 'yearly';
    default:
      return 'daily';
  }
}

export function formatPremiumWanDisplay(value: number | null | undefined): string {
  return formatWanAdaptive(value);
}

export function formatAvgPremiumDisplay(value: number): string {
  return `${formatCount(value)}元`;
}

export function safeNumber(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return value;
}

export function getRateTextClass(field: 'achievement' | 'growth', value: number | null): string {
  if (field === 'achievement') {
    return cn(getAchievementTextClass(classifyAchievementBand(value)), 'font-semibold');
  }
  return cn(getGrowthTextClass(classifyGrowthBand(value)), 'font-semibold');
}

export function sortWithNull(value: number | null, order: 'asc' | 'desc'): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return order === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return value;
}

export type GroupSortKey =
  | 'group_name'
  | 'premium'
  | 'plan_premium'
  | 'auto_count'
  | 'achievement_rate'
  | 'growth_rate'
  | 'nev_rate'
  | 'renewal_rate'
  | 'transfer_business_rate'
  | 'new_car_rate'
  | 'transfer_rate';

export type TopSortKey =
  | 'dimension_name'
  | 'premium'
  | 'plan_premium'
  | 'auto_count'
  | 'achievement_rate'
  | 'growth_rate'
  | 'nev_rate'
  | 'renewal_rate'
  | 'transfer_business_rate'
  | 'new_car_rate'
  | 'transfer_rate';

export type SortOrder = 'asc' | 'desc';
