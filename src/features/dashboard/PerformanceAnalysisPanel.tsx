import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import type { AdvancedFilterState } from '@/shared/types/data';
import { Tabs } from '@/shared/ui/Tabs';
import type { TabItem } from '@/shared/ui/Tabs';
import {
  StickyTableFrame,
  DrilldownBreadcrumb,
  DrilldownCell,
  DrilldownLoadingOverlay,
  DrilldownExhaustedBanner,
} from '@/shared/ui';
import type { DrilldownBreadcrumbStep } from '@/shared/ui';
import { SectionTitle, SectionBlock } from '@/shared/ui/SectionTitle';
import { useDataStatus } from '@/shared/contexts/DataContext';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { useScopeLabel } from '@/shared/hooks/useScopeLabel';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatPercent, formatWanAdaptive, formatTeamName, formatSalesmanName } from '@/shared/utils/formatters';
import { useTheme } from '@/shared/theme';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { buttonStyles, cardStyles, cn, colorClasses, colors, stickyTableStyles, textStyles, toggleButtonStyles } from '@/shared/styles';
import { ENABLE_BUNDLE_ROUTES } from '@/shared/api/client';
import {
  classifyAchievementBand,
  classifyGrowthBand,
  classifyPerformanceQuadrant,
  getAchievementTextClass,
  getGrowthTextClass,
  getQuadrantLabel,
  PERFORMANCE_ACHIEVEMENT_THRESHOLD,
  PERFORMANCE_GROWTH_THRESHOLD,
  PERFORMANCE_QUADRANT_META,
} from './performanceStatus';
import {
  PERFORMANCE_DIMENSION_LABELS,
  usePerformanceDrilldown,
  type PerformanceDimension,
  type PerformanceRow,
} from './hooks/usePerformanceDrilldown';
import {
  usePerformanceSummary,
  type PerformanceGrowthMode,
  type PerformanceTimePeriod,
  type PerformanceSegmentTag,
  type PerformanceSummaryExpandDims,
  type PerformanceSummaryRow,
} from './hooks/usePerformanceSummary';
import { usePerformanceTrend } from './hooks/usePerformanceTrend';
import { PerformanceTrendChart } from './PerformanceTrendChart';
import { usePerformanceTopSalesman, type PerformanceTopSalesmanRow } from './hooks/usePerformanceTopSalesman';
import { usePerformanceBundle } from './hooks/usePerformanceBundle';
import {
  usePerformanceOrgHeatmap,
  type HeatmapDimension,
  HEATMAP_DIMENSION_LABELS,
  type HeatmapDrillStep,
} from './hooks/usePerformanceOrgHeatmap';
import {
  type PerformanceHeatmapSelection,
} from './utils/performanceHeatmapSelection';
import { getConditionalDimensions } from '@/shared/config/drilldown-dimensions';
import { PerformanceOrgHeatmapV2, HeatmapFocusPanel } from './performance/PerformanceOrgHeatmapV2';
import type { HeatmapMetric } from './performance/PerformanceOrgHeatmapV2';

interface PerformanceAnalysisPanelProps {
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

const SEGMENT_TABS: TabItem[] = [
  { key: 'all', label: '全部' },
  { key: 'non_business_passenger', label: '非营客' },
  { key: 'business_passenger', label: '营客' },
  { key: 'business_truck', label: '营货' },
  { key: 'non_business_truck', label: '非营货' },
  { key: 'motorcycle', label: '摩托车' },
];

const TIME_PERIOD_TABS: TabItem[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
  { key: 'year', label: '年' },
];

const GROWTH_MODE_TABS: TabItem[] = [
  { key: 'mom', label: '环比' },
  { key: 'yoy', label: '同比' },
];

const SEGMENT_OPTIONS = [
  { value: 'all', label: '全部客户' },
  { value: 'non_business_passenger', label: '非营客' },
  { value: 'business_passenger', label: '营客' },
  { value: 'business_truck', label: '营货' },
  { value: 'non_business_truck', label: '非营货' },
  { value: 'motorcycle', label: '摩托车' },
];

export const PerformanceHeaderActions: React.FC<{
  segmentTag: PerformanceSegmentTag;
  onSegmentTagChange: (v: PerformanceSegmentTag) => void;
  onReset: () => void;
  onOpenAdvanced: () => void;
  activeFilterCount: number;
}> = ({ segmentTag, onSegmentTagChange, onReset, onOpenAdvanced, activeFilterCount }) => (
  <div className="flex items-center gap-2">
    <select
      value={segmentTag}
      onChange={(e) => onSegmentTagChange(e.target.value as PerformanceSegmentTag)}
      className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2 py-1.5 text-xs cursor-pointer')}
    >
      {SEGMENT_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
    <button type="button" onClick={onReset} className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2 py-1.5 text-xs')}>
      <RotateCcw size={14} className="mr-1" />重置
    </button>
    <button type="button" onClick={onOpenAdvanced} className={cn(buttonStyles.base, buttonStyles.primary, 'px-2 py-1.5 text-xs')}>
      <SlidersHorizontal size={14} className="mr-1" />筛选
      {activeFilterCount > 0 && (
        <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px]">
          {activeFilterCount}
        </span>
      )}
    </button>
  </div>
);

const EXPAND_DIMS_TABS: TabItem[] = [
  { key: 'none', label: '不展开' },
  { key: 'energy', label: '油电' },
  { key: 'business_nature', label: '新转续' },
  { key: 'energy_business_nature', label: '油电+新转续' },
];


const SUMMARY_ORDER = ['整体', '主全', '交三', '单交'];

function mapTimePeriodToTrendGranularity(timePeriod: PerformanceTimePeriod): 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' {
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

// SectionTitle 和 SectionBlock 已提取到 @/shared/ui/SectionTitle

function formatPremiumWanDisplay(value: number | null | undefined): string {
  return formatWanAdaptive(value);
}

function formatAvgPremiumDisplay(value: number): string {
  return `${formatCount(value)}元`;
}

function safeNumber(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return value;
}

function getRateTextClass(field: 'achievement' | 'growth', value: number | null): string {
  if (field === 'achievement') {
    return cn(getAchievementTextClass(classifyAchievementBand(value)), 'font-semibold');
  }
  return cn(getGrowthTextClass(classifyGrowthBand(value)), 'font-semibold');
}

function sortWithNull(value: number | null, order: 'asc' | 'desc'): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return order === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return value;
}

function DistributionChart({
  rows,
  loading,
  error,
}: {
  rows: PerformanceRow[];
  loading: boolean;
  error: string | null;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const { resolvedTheme } = useTheme();

  const points = useMemo(() => {
    const filtered = rows.filter((row) => row.achievement_rate !== null && row.growth_rate !== null);
    const maxCount = Math.max(...filtered.map((item) => safeNumber(item.auto_count)), 1);

    return filtered.map((row) => {
      const achievement = safeNumber(row.achievement_rate);
      const growth = safeNumber(row.growth_rate);
      const autoCount = Math.max(0, safeNumber(row.auto_count));
      const quadrant = classifyPerformanceQuadrant(achievement, growth);
      const symbolSize = 12 + (autoCount / maxCount) * 18;
      const color = quadrant === 'unknown'
        ? colors.neutral[400]
        : PERFORMANCE_QUADRANT_META[quadrant].color;

      return {
        name: row.group_name,
        value: [achievement, growth, autoCount],
        quadrant,
        itemStyle: {
          color,
          opacity: 0.86,
        },
        symbolSize,
      };
    });
  }, [rows]);

  const axisRange = useMemo(() => {
    if (points.length === 0) {
      return { xMin: 80, xMax: 120, yMin: -5, yMax: 20 };
    }
    const xs = points.map((p) => Number(p.value[0] || 0));
    const ys = points.map((p) => Number(p.value[1] || 0));
    return {
      xMin: Math.min(80, Math.floor(Math.min(...xs) - 5)),
      xMax: Math.max(120, Math.ceil(Math.max(...xs) + 5)),
      yMin: Math.min(-5, Math.floor(Math.min(...ys) - 2)),
      yMax: Math.max(20, Math.ceil(Math.max(...ys) + 2)),
    };
  }, [points]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;
    if (!chart) return;
    if (loading) return;

    if (error) {
      chart.clear();
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: `加载失败: ${error}`,
            fill: colors.danger.DEFAULT,
            fontSize: 13,
          },
        },
      });
      return;
    }

    if (points.length === 0) {
      chart.clear();
      chart.setOption({
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: '暂无达成率/增长率分布数据',
            fill: colors.neutral[400],
            fontSize: 13,
          },
        },
      });
      return;
    }

    const bucket = {
      high_growth_high_achievement: points.filter((item) => item.quadrant === 'high_growth_high_achievement'),
      high_growth_low_achievement: points.filter((item) => item.quadrant === 'high_growth_low_achievement'),
      low_growth_high_achievement: points.filter((item) => item.quadrant === 'low_growth_high_achievement'),
      low_growth_low_achievement: points.filter((item) => item.quadrant === 'low_growth_low_achievement'),
    };

    const scatterSymbolSize = (_value: unknown, params: any) => {
      const data = params?.data;
      if (typeof data?.symbolSize === 'number') return data.symbolSize;
      return 16;
    };

    const isDark = resolvedTheme === 'dark';
    const textColor = isDark ? '#f0f0f0' : '#333';
    const subTextColor = isDark ? '#a3a3a3' : '#666';

    const option: EChartsOption = {
      textStyle: { color: textColor },
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const value = params?.value || [0, 0, 0];
          const achievement = Number(value[0] || 0);
          const growth = Number(value[1] || 0);
          const count = Number(value[2] || 0);
          const quadrant = params?.data?.quadrant;
          const quadrantLabel = typeof quadrant === 'string' ? getQuadrantLabel(quadrant as any) : '-';
          return [
            `<div style="font-size:12px;line-height:1.6;">`,
            `<div style="font-weight:600;">${params?.name || ''}</div>`,
            `<div>达成率：${formatPercent(achievement)}</div>`,
            `<div>增长率：${formatPercent(growth)}</div>`,
            `<div>车险件数：${formatCount(count)}</div>`,
            `<div>象限：${quadrantLabel}</div>`,
            `</div>`,
          ].join('');
        },
      },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { color: subTextColor },
        data: ['高增长高达成（优秀）', '高增长低达成（异常）', '低增长高达成（预警）', '低增长低达成（危险）'],
      },
      grid: {
        left: '7%',
        right: '6%',
        top: 54,
        bottom: 46,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: '达成率',
        nameTextStyle: { color: subTextColor },
        min: axisRange.xMin,
        max: axisRange.xMax,
        axisLabel: { formatter: '{value}%', color: subTextColor },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: '增长率',
        nameTextStyle: { color: subTextColor },
        min: axisRange.yMin,
        max: axisRange.yMax,
        axisLabel: { formatter: '{value}%', color: subTextColor },
        splitLine: { show: false },
      },
      series: [
        {
          name: '背景',
          type: 'scatter',
          data: [],
          symbolSize: scatterSymbolSize,
          markArea: {
            silent: true,
            itemStyle: { opacity: 0.08 },
            data: [
              [
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: PERFORMANCE_GROWTH_THRESHOLD, itemStyle: { color: colors.success.DEFAULT } },
                { xAxis: axisRange.xMax, yAxis: axisRange.yMax },
              ],
              [
                { xAxis: axisRange.xMin, yAxis: PERFORMANCE_GROWTH_THRESHOLD, itemStyle: { color: colors.warning.DEFAULT } },
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: axisRange.yMax },
              ],
              [
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: axisRange.yMin, itemStyle: { color: '#fa8c16' } },
                { xAxis: axisRange.xMax, yAxis: PERFORMANCE_GROWTH_THRESHOLD },
              ],
              [
                { xAxis: axisRange.xMin, yAxis: axisRange.yMin, itemStyle: { color: colors.danger.DEFAULT } },
                { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD, yAxis: PERFORMANCE_GROWTH_THRESHOLD },
              ],
            ],
          },
        },
        {
          name: '高增长高达成（优秀）',
          type: 'scatter',
          data: bucket.high_growth_high_achievement,
          symbolSize: scatterSymbolSize,
        },
        {
          name: '高增长低达成（异常）',
          type: 'scatter',
          data: bucket.high_growth_low_achievement,
          symbolSize: scatterSymbolSize,
        },
        {
          name: '低增长高达成（预警）',
          type: 'scatter',
          data: bucket.low_growth_high_achievement,
          symbolSize: scatterSymbolSize,
        },
        {
          name: '低增长低达成（危险）',
          type: 'scatter',
          data: bucket.low_growth_low_achievement,
          symbolSize: scatterSymbolSize,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              type: 'dashed',
              color: colors.neutral[500],
              width: 1,
            },
            data: [
              { xAxis: PERFORMANCE_ACHIEVEMENT_THRESHOLD },
              { yAxis: PERFORMANCE_GROWTH_THRESHOLD },
            ],
          },
        },
      ],
    };

    chart.setOption(option, true);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, [axisRange, error, loading, points, resolvedTheme]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <h3 className={textStyles.titleSmall}>达成率+增长率分布图</h3>
      <div className={cn(textStyles.caption, colorClasses.text.neutralLight)}>
        分界线：达成率 {PERFORMANCE_ACHIEVEMENT_THRESHOLD}% / 增长率 {PERFORMANCE_GROWTH_THRESHOLD}%。
      </div>
      <div ref={chartRef} className="h-[360px] w-full" />
    </section>
  );
}

function DimensionPicker({
  available,
  onSelect,
  onCancel,
  title,
}: {
  available: PerformanceDimension[];
  onSelect: (dim: PerformanceDimension) => void;
  onCancel: () => void;
  title: string;
}) {
  if (available.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={onCancel}>
      <div
        className={cn(cardStyles.spacious, 'min-w-[320px] max-w-[90vw]')}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className={cn(textStyles.titleSmall, 'mb-4')}>{title}</h3>
        <div className="grid grid-cols-2 gap-2">
          {available.map((dim) => (
            <button
              key={dim}
              onClick={() => onSelect(dim)}
              className={cn(
                'px-3 py-2 rounded-lg border text-left transition-colors',
                colorClasses.border.neutral,
                colorClasses.text.neutralDark,
                'hover:bg-neutral-50'
              )}
            >
              {PERFORMANCE_DIMENSION_LABELS[dim]}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className={cn('mt-4 w-full px-3 py-2 rounded-lg border transition-colors', colorClasses.border.neutral)}
        >
          取消
        </button>
      </div>
    </div>
  );
}

type GroupSortKey =
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

type TopSortKey =
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

type SortOrder = 'asc' | 'desc';

export const PerformanceAnalysisPanel: React.FC<PerformanceAnalysisPanelProps> = ({
  filters,
  segmentTag,
  timePeriod,
  growthMode,
  onTimePeriodChange,
  onGrowthModeChange,
  defaultHeatmapMetric,
}) => {
  const { isDataLoaded } = useDataStatus();
  const { salesmanTeamMap } = useGlobalFilters();
  const { prefix: scopePrefix } = useScopeLabel(filters, salesmanTeamMap);

  const [expandDims, setExpandDims] = useState<PerformanceSummaryExpandDims>('none');
  const [expandedCoverage, setExpandedCoverage] = useState<Record<string, boolean>>({});

  const [showPicker, setShowPicker] = useState(false);


  const [groupSortKey, setGroupSortKey] = useState<GroupSortKey>('premium');
  const [groupSortOrder, setGroupSortOrder] = useState<SortOrder>('desc');

  const [topSortKey, setTopSortKey] = useState<TopSortKey>('achievement_rate');
  const [topSortOrder, setTopSortOrder] = useState<SortOrder>('asc');
  const [hasDrillInteraction, setHasDrillInteraction] = useState(false);
  const [heatmapSelection, setHeatmapSelection] = useState<PerformanceHeatmapSelection | null>(null);

  const trendGranularity = useMemo(() => mapTimePeriodToTrendGranularity(timePeriod), [timePeriod]);
  const fallbackToLegacy = !ENABLE_BUNDLE_ROUTES;
  const performanceBundle = usePerformanceBundle({
    filters,
    segmentTag,
    timePeriod,
    growthMode,
    expandDims,
    enabled: isDataLoaded && ENABLE_BUNDLE_ROUTES,
  });

  const [heatmapDimension, setHeatmapDimension] = useState<HeatmapDimension>('org_level_3');
  // 热力图下钻状态
  const [heatmapDrillPath, setHeatmapDrillPath] = useState<HeatmapDrillStep[]>([]);
  const [heatmapGroupBy, setHeatmapGroupBy] = useState<HeatmapDimension>('org_level_3');
  const [showHeatmapPicker, setShowHeatmapPicker] = useState(false);
  const [pendingHeatmapRow, setPendingHeatmapRow] = useState<string | null>(null);

  const PERF_HEATMAP_DRILL_DIMENSIONS: { key: HeatmapDimension; label: string }[] = [
    { key: 'org_level_3', label: '三级机构' },
    { key: 'team', label: '团队' },
    { key: 'salesman', label: '业务员' },
    { key: 'customer_category', label: '客户类别' },
    { key: 'coverage_combination', label: '险别组合' },
    { key: 'energy_type', label: '能源类型' },
    { key: 'business_nature', label: '新转续' },
    { key: 'insurance_grade', label: '风险评分' },
  ];

  // 维度分段控件分组（组织 / 业务）。label 全部从 HEATMAP_DIMENSION_LABELS SSOT 取，
  // 改 SSOT 自动跟进，避免硬编码。
  const HEATMAP_DIM_GROUPS: { groupLabel: string; keys: HeatmapDimension[] }[] = [
    { groupLabel: '组织', keys: ['org_level_3', 'team', 'salesman'] },
    {
      groupLabel: '业务',
      keys: ['customer_category', 'coverage_combination', 'energy_type', 'business_nature', 'insurance_grade'],
    },
  ];

  const handlePerfHeatmapRowClick = (org: string) => {
    setPendingHeatmapRow(org);
    setShowHeatmapPicker(true);
  };

  const handlePerfHeatmapDimSelect = (dim: HeatmapDimension) => {
    if (!pendingHeatmapRow) return;
    const newStep: HeatmapDrillStep = { dimension: heatmapGroupBy, value: pendingHeatmapRow };
    setHeatmapDrillPath((prev) => [...prev, newStep]);
    setHeatmapGroupBy(dim);
    setShowHeatmapPicker(false);
    setPendingHeatmapRow(null);
  };

  const handlePerfHeatmapBreadcrumbClick = (index: number) => {
    if (index < 0) {
      setHeatmapDrillPath([]);
      setHeatmapGroupBy('org_level_3');
      return;
    }
    const nextDim = heatmapDrillPath[index + 1]?.dimension as HeatmapDimension | undefined;
    setHeatmapDrillPath(heatmapDrillPath.slice(0, index + 1));
    if (nextDim) setHeatmapGroupBy(nextDim);
  };

  const activeHeatmapGroupBy = heatmapDrillPath.length === 0 ? heatmapDimension : heatmapGroupBy;

  const heatmapQuery = usePerformanceOrgHeatmap({
    filters,
    segmentTag,
    growthMode,
    timePeriod,
    groupByDimension: activeHeatmapGroupBy,
    drillFilter: heatmapDrillPath,
    enabled: isDataLoaded,
  });

  const summaryQuery = usePerformanceSummary({
    filters,
    segmentTag,
    timePeriod,
    growthMode,
    expandDims,
    prefetchedRows: (performanceBundle.bundle?.summary.rows as PerformanceSummaryRow[] | undefined),
    enabled: isDataLoaded && (fallbackToLegacy || Boolean(performanceBundle.error)),
  });

  const trendQuery = usePerformanceTrend({
    filters,
    segmentTag,
    granularity: trendGranularity,
    prefetchedRows: performanceBundle.bundle?.trend.rows as Array<Record<string, unknown>> | undefined,
    enabled: isDataLoaded && (fallbackToLegacy || Boolean(performanceBundle.error)),
  });

  const drilldownPrefetched = useMemo<PerformanceDrilldownPrefetchedData | undefined>(() => {
    if (!performanceBundle.bundle?.drilldown) return undefined;
    return {
      summary: performanceBundle.bundle.drilldown.summary,
      rows: performanceBundle.bundle.drilldown.rows,
    };
  }, [performanceBundle.bundle?.drilldown]);

  const useLegacyDrilldown = fallbackToLegacy || Boolean(performanceBundle.error) || hasDrillInteraction;
  const drilldownQuery = usePerformanceDrilldown({
    filters,
    segmentTag,
    timePeriod,
    growthMode,
    heatmapSelection,
    prefetched: resolvePerformanceDrilldownPrefetched(drilldownPrefetched, useLegacyDrilldown),
    enabled: isDataLoaded && useLegacyDrilldown,
  });

  const topSalesmanQuery = usePerformanceTopSalesman({
    filters,
    segmentTag,
    timePeriod,
    growthMode,
    prefetchedRows: performanceBundle.bundle?.topSalesman.rows as Array<Record<string, unknown>> | undefined,
    enabled: isDataLoaded && (fallbackToLegacy || Boolean(performanceBundle.error)),
  });

  useEffect(() => {
    setExpandedCoverage({});
  }, [expandDims, segmentTag, timePeriod, growthMode]);

  useEffect(() => {
    setHasDrillInteraction(false);
    setShowPicker(false);
    setHeatmapSelection(null);
    drilldownQuery.reset();
  }, [segmentTag, timePeriod, growthMode]);

  const drilldownLoading = useLegacyDrilldown ? drilldownQuery.loading : performanceBundle.loading;
  const drilldownError = useLegacyDrilldown ? drilldownQuery.error : null;

  const parentSummaryRows = useMemo(() => {
    const rows = summaryQuery.rows.filter((row) => row.row_level === 0);
    const rowMap = new Map(rows.map((row) => [row.coverage_combination, row]));
    const ordered = SUMMARY_ORDER
      .map((key) => rowMap.get(key))
      .filter((item): item is PerformanceSummaryRow => Boolean(item));
    const rest = rows.filter((row) => !SUMMARY_ORDER.includes(row.coverage_combination));
    return [...ordered, ...rest];
  }, [summaryQuery.rows]);

  const childSummaryMap = useMemo(() => {
    const map = new Map<string, PerformanceSummaryRow[]>();
    summaryQuery.rows
      .filter((row) => row.row_level === 1)
      .forEach((row) => {
        const list = map.get(row.coverage_combination) || [];
        list.push(row);
        map.set(row.coverage_combination, list);
      });
    return map;
  }, [summaryQuery.rows]);

  const sortedGroupRows = useMemo(() => {
    const rows = [...drilldownQuery.rows];
    return rows.sort((a, b) => {
      if (groupSortKey === 'group_name') {
        const diff = a.group_name.localeCompare(b.group_name);
        return groupSortOrder === 'asc' ? diff : -diff;
      }

      const aVal = groupSortKey === 'achievement_rate' || groupSortKey === 'growth_rate' || groupSortKey === 'plan_premium'
        ? sortWithNull(a[groupSortKey], groupSortOrder)
        : safeNumber(a[groupSortKey]);
      const bVal = groupSortKey === 'achievement_rate' || groupSortKey === 'growth_rate' || groupSortKey === 'plan_premium'
        ? sortWithNull(b[groupSortKey], groupSortOrder)
        : safeNumber(b[groupSortKey]);

      return groupSortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [drilldownQuery.rows, groupSortKey, groupSortOrder]);

  const sortedTopRows = useMemo(() => {
    const rows = [...topSalesmanQuery.rows];
    return rows.sort((a, b) => {
      if (topSortKey === 'dimension_name') {
        const diff = a.dimension_name.localeCompare(b.dimension_name);
        return topSortOrder === 'asc' ? diff : -diff;
      }

      const aVal = topSortKey === 'achievement_rate' || topSortKey === 'growth_rate' || topSortKey === 'plan_premium'
        ? sortWithNull(a[topSortKey], topSortOrder)
        : safeNumber(a[topSortKey]);
      const bVal = topSortKey === 'achievement_rate' || topSortKey === 'growth_rate' || topSortKey === 'plan_premium'
        ? sortWithNull(b[topSortKey], topSortOrder)
        : safeNumber(b[topSortKey]);

      return topSortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [topSalesmanQuery.rows, topSortKey, topSortOrder]);

  const handleGroupSort = (key: GroupSortKey) => {
    if (groupSortKey === key) {
      setGroupSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setGroupSortKey(key);
    setGroupSortOrder(key === 'group_name' ? 'asc' : 'desc');
  };

  const handleTopSort = (key: TopSortKey) => {
    if (topSortKey === key) {
      setTopSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setTopSortKey(key);
    setTopSortOrder(key === 'achievement_rate' ? 'asc' : 'desc');
  };

  const handleInitialDimensionPick = () => {
    setShowPicker(true);
  };

  /** DrilldownCell 行内选择维度 → 直接下钻 */
  const handleCellDrillDown = (rowValue: string, dimension: string) => {
    setHasDrillInteraction(true);
    drilldownQuery.drillDown(rowValue, dimension as PerformanceDimension);
  };

  /** DimensionPicker（仅初始选维度 + 热力图入口） */
  const handleDimensionSelect = (dimension: PerformanceDimension) => {
    setHasDrillInteraction(true);
    if (heatmapSelection) {
      drilldownQuery.drillFromRoot(heatmapSelection.org, dimension, 'org_level_3');
    } else {
      drilldownQuery.selectDimension(dimension);
    }
    setShowPicker(false);
  };

  const handleHeatmapCellClick = ({ org, date }: { org: string; date: string }) => {
    setHasDrillInteraction(false);
    setHeatmapSelection({ org, date });
    drilldownQuery.reset();
    setShowPicker(true);
  };

  const handleDrillReset = () => {
    setHasDrillInteraction(false);
    setShowPicker(false);
    setHeatmapSelection(null);
    drilldownQuery.reset();
  };

  const isDrillClickable = drilldownQuery.availableDimensions.length > 0;
  const currentDimensionLabel = drilldownQuery.currentGroupBy
    ? PERFORMANCE_DIMENSION_LABELS[drilldownQuery.currentGroupBy]
    : '维度';

  const toggleCoverageExpand = (coverage: string) => {
    setExpandedCoverage((prev) => ({ ...prev, [coverage]: !prev[coverage] }));
  };

  const segmentLabel = String(SEGMENT_TABS.find((item) => item.key === segmentTag)?.label || '全部');
  const timeLabel = String(TIME_PERIOD_TABS.find((item) => item.key === timePeriod)?.label || '日');
  const growthLabel = String(GROWTH_MODE_TABS.find((item) => item.key === growthMode)?.label || '环比');
  const summaryTitle = `险别组合业绩${growthLabel}（${segmentLabel} · ${timeLabel}）`;

  return (
    <div className="space-y-5">
      <SectionBlock id="performance-heatmap">
        <SectionTitle
          title={getPerformanceHeatmapTitle(timePeriod, HEATMAP_DIMENSION_LABELS[activeHeatmapGroupBy])}
          rightContent={
            onTimePeriodChange && onGrowthModeChange ? (
              <div className="flex items-center gap-2">
                <Tabs
                  items={TIME_PERIOD_TABS}
                  activeKey={timePeriod}
                  onChange={(k) => onTimePeriodChange(k as PerformanceTimePeriod)}
                  variant="pills"
                  size="mini"
                />
                <Tabs
                  items={GROWTH_MODE_TABS}
                  activeKey={growthMode}
                  onChange={(k) => onGrowthModeChange(k as PerformanceGrowthMode)}
                  variant="pills"
                  size="mini"
                />
              </div>
            ) : undefined
          }
          leftContent={
            heatmapDrillPath.length === 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {HEATMAP_DIM_GROUPS.map((group) => (
                  <div key={group.groupLabel} className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">{group.groupLabel}</span>
                    <div
                      role="radiogroup"
                      aria-label={`${group.groupLabel}维度`}
                      className="inline-flex rounded-md bg-neutral-100 dark:bg-white/5 p-0.5 text-xs"
                    >
                      {group.keys.map((key) => {
                        const active = heatmapDimension === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={cn(
                              'px-2.5 py-1 rounded-[5px] transition-colors',
                              active ? toggleButtonStyles.active : toggleButtonStyles.inactive,
                            )}
                            onClick={() => {
                              setHeatmapDimension(key);
                              setHeatmapGroupBy(key);
                            }}
                          >
                            {HEATMAP_DIMENSION_LABELS[key]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium',
                    colorClasses.bg.primary,
                    colorClasses.text.primaryDark,
                  )}
                  aria-label={`已下钻 ${heatmapDrillPath.length} 层`}
                >
                  下钻 <span className="font-numeric">{heatmapDrillPath.length}</span> 层
                </span>
                <button
                  className="hover:text-primary hover:underline cursor-pointer"
                  onClick={() => handlePerfHeatmapBreadcrumbClick(-1)}
                >
                  全部
                </button>
                {heatmapDrillPath.map((step, i) => (
                  <React.Fragment key={i}>
                    <span>/</span>
                    <button
                      className={cn(
                        'hover:text-primary hover:underline cursor-pointer',
                        i === heatmapDrillPath.length - 1 ? 'text-neutral-700 dark:text-neutral-200 font-medium' : ''
                      )}
                      onClick={() => handlePerfHeatmapBreadcrumbClick(i)}
                    >
                      {step.value}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )
          }
        />
        {showHeatmapPicker && (
          <div className={cn(cardStyles.base, `p-3 ${colorClasses.bg.primary} border ${colorClasses.border.primary}`)}>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 mb-2">
              选择 <strong>{pendingHeatmapRow}</strong> 的下钻维度：
            </p>
            <div className="flex flex-wrap gap-2">
              {PERF_HEATMAP_DRILL_DIMENSIONS.filter((d) => d.key !== activeHeatmapGroupBy).map((d) => (
                <button
                  key={d.key}
                  className={`px-3 py-1 text-xs rounded-full bg-white dark:bg-neutral-800 border ${colorClasses.border.primary} hover:bg-primary-bg cursor-pointer`}
                  onClick={() => handlePerfHeatmapDimSelect(d.key)}
                >
                  {d.label}
                </button>
              ))}
              <button
                className="px-3 py-1 text-xs rounded-full bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 cursor-pointer"
                onClick={() => { setShowHeatmapPicker(false); setPendingHeatmapRow(null); }}
              >
                取消
              </button>
            </div>
          </div>
        )}
        <PerformanceOrgHeatmapV2
          rows={heatmapQuery.rows}
          loading={heatmapQuery.loading}
          error={heatmapQuery.error}
          growthMode={growthMode}
          timePeriod={timePeriod}
          dimensionLabel={HEATMAP_DIMENSION_LABELS[activeHeatmapGroupBy]}
          groupByDimension={activeHeatmapGroupBy}
          defaultHeatmapMetric={defaultHeatmapMetric}
          onCellClick={handleHeatmapCellClick}
          onRowClick={handlePerfHeatmapRowClick}
        />
      </SectionBlock>

      <HeatmapFocusPanel
        activeCell={heatmapSelection}
        row={heatmapSelection ? heatmapQuery.rows.find(
          (r) => r.orgLevel3 === heatmapSelection.org && r.policyDate === heatmapSelection.date
        ) : undefined}
        metric={defaultHeatmapMetric ?? 'growth'}
        growthMode={growthMode}
        onDrillClick={() => setShowPicker(true)}
        onClear={() => setHeatmapSelection(null)}
      />

      <SectionBlock id="performance-summary">
      <SectionTitle title={summaryTitle} />
      <section className={cn(cardStyles.standard, 'p-0 overflow-hidden')}>
        <div className="px-4 pt-3">
          <Tabs
            items={EXPAND_DIMS_TABS}
            activeKey={expandDims}
            onChange={(key) => setExpandDims(key as PerformanceSummaryExpandDims)}
            variant="pills"
            size="small"
          />
        </div>
        {summaryQuery.error ? (
          <div className={cn('p-4', colorClasses.text.danger)}>加载失败: {summaryQuery.error}</div>
        ) : (
          <StickyTableFrame maxHeight={620}>
            <table className="w-full text-sm">
              <thead className={cn('bg-neutral-50 dark:bg-surface-2 border-b border-neutral-200 dark:border-subtle', stickyTableStyles.header)}>
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-600">险别组合</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">车险保费(万元)</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">车险计划(万元)</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">车险件数</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">件均保费</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">达成率</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">增长率</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">新能源占比</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">续保占比</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">转保占比</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">新保占比</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">过户转保占比</th>
                </tr>
              </thead>
              <tbody>
                {summaryQuery.loading && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-neutral-400">数据加载中...</td>
                  </tr>
                )}
                {!summaryQuery.loading && parentSummaryRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-neutral-400">暂无数据</td>
                  </tr>
                )}
                {!summaryQuery.loading && parentSummaryRows.map((row, index) => {
                  const childRows = childSummaryMap.get(row.coverage_combination) || [];
                  const canExpand = expandDims !== 'none' && childRows.length > 0;
                  const isExpanded = Boolean(expandedCoverage[row.coverage_combination]);
                  return (
                    <React.Fragment key={`${row.coverage_combination}-${index}`}>
                      <tr className="border-b border-neutral-100">
                        <td
                          className={cn('px-4 py-3 font-medium text-neutral-800', canExpand && 'cursor-pointer')}
                          onClick={() => canExpand && toggleCoverageExpand(row.coverage_combination)}
                        >
                          {canExpand ? `${isExpanded ? '▾' : '▸'} ` : ''}{row.row_label}
                        </td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.plan_premium)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatCount(row.auto_count)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatAvgPremiumDisplay(row.avg_premium)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric, getRateTextClass('achievement', row.achievement_rate))}>
                          {row.achievement_rate === null ? '-' : formatPercent(row.achievement_rate)}
                        </td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric, getGrowthTextClass(classifyGrowthBand(row.growth_rate)), 'font-semibold')}>
                          {row.growth_rate === null ? '-' : formatPercent(row.growth_rate)}
                        </td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.nev_rate)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.renewal_rate)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.transfer_business_rate)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.new_car_rate)}</td>
                        <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPercent(row.transfer_rate)}</td>
                      </tr>
                      {isExpanded && childRows.map((child) => (
                        <tr key={`${row.coverage_combination}-${child.expand_key}`} className="border-b border-neutral-100 bg-neutral-50/40">
                          <td className={cn('px-4 py-2 pl-8', colorClasses.text.neutralDark)}>{child.row_label}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(child.premium)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(child.plan_premium)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatCount(child.auto_count)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatAvgPremiumDisplay(child.avg_premium)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric, getRateTextClass('achievement', child.achievement_rate))}>
                            {child.achievement_rate === null ? '-' : formatPercent(child.achievement_rate)}
                          </td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric, getGrowthTextClass(classifyGrowthBand(child.growth_rate)), 'font-semibold')}>
                            {child.growth_rate === null ? '-' : formatPercent(child.growth_rate)}
                          </td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.nev_rate)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.renewal_rate)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.transfer_business_rate)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.new_car_rate)}</td>
                          <td className={cn('px-4 py-2 text-right', textStyles.numeric)}>{formatPercent(child.transfer_rate)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </StickyTableFrame>
        )}
      </section>
      </SectionBlock>

      <SectionBlock id="performance-trend">
      <SectionTitle title={`${scopePrefix}保费与件数走势`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PerformanceTrendChart
          title="车险保费走势"
          series={trendQuery.series}
          metric="premium"
          loading={trendQuery.loading}
          error={trendQuery.error}
        />
        <PerformanceTrendChart
          title="车险件数走势"
          series={trendQuery.series}
          metric="auto_count"
          loading={trendQuery.loading}
          error={trendQuery.error}
        />
      </div>
      </SectionBlock>

      <SectionBlock id="performance-drilldown">
      <SectionTitle title={getPerformanceDrilldownTitle(
        drilldownQuery.currentGroupBy,
        currentDimensionLabel,
        heatmapSelection
      )} />
      <DistributionChart rows={drilldownQuery.rows} loading={drilldownLoading} error={drilldownError} />

      <section className={cn(cardStyles.standard, 'space-y-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DrilldownBreadcrumb
            path={drilldownQuery.drillPath.map((s): DrilldownBreadcrumbStep => ({
              label: s.label,
              dimension: s.dimension,
              value: s.value,
            }))}
            onNavigate={drilldownQuery.drillUp}
            canGoToTop={drilldownQuery.canGoToTop}
            dimensionLabels={PERFORMANCE_DIMENSION_LABELS}
            currentGroupBy={drilldownQuery.currentGroupBy}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleInitialDimensionPick}
              className={cn('px-3 py-1.5 text-sm rounded-lg border transition-colors', colorClasses.border.primary, colorClasses.text.primary)}
            >
              选择下钻维度
            </button>
            {(drilldownQuery.drillPath.length > 0 || drilldownQuery.currentGroupBy) && (
              <button
                onClick={handleDrillReset}
                className={cn('px-3 py-1.5 text-sm rounded-lg border transition-colors', colorClasses.border.neutral, colorClasses.text.neutralDark)}
              >
                重置分析
              </button>
            )}
          </div>
        </div>

        {drilldownQuery.summary && (
          <div className={cn(cardStyles.compact, 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3')}>
            <div>
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>车险保费(万元)</p>
              <p className={cn(textStyles.titleSmall, textStyles.numeric)}>{formatPremiumWanDisplay(drilldownQuery.summary.premium)}</p>
            </div>
            <div>
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>车险件数</p>
              <p className={cn(textStyles.titleSmall, textStyles.numeric)}>{formatCount(drilldownQuery.summary.auto_count)}</p>
            </div>
            <div>
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>达成率</p>
              <p className={cn(textStyles.titleSmall, textStyles.numeric, getRateTextClass('achievement', drilldownQuery.summary.achievement_rate))}>
                {drilldownQuery.summary.achievement_rate === null ? '-' : formatPercent(drilldownQuery.summary.achievement_rate)}
              </p>
            </div>
            <div>
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>增长率</p>
              <p className={cn(textStyles.titleSmall, textStyles.numeric, getRateTextClass('growth', drilldownQuery.summary.growth_rate))}>
                {drilldownQuery.summary.growth_rate === null ? '-' : formatPercent(drilldownQuery.summary.growth_rate)}
              </p>
            </div>
            <div>
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>象限</p>
              <p className={cn(textStyles.body, colorClasses.text.neutralDark)}>
                {getQuadrantLabel(classifyPerformanceQuadrant(drilldownQuery.summary.achievement_rate, drilldownQuery.summary.growth_rate))}
              </p>
            </div>
          </div>
        )}

        <DrilldownExhaustedBanner
          visible={!isDrillClickable && sortedGroupRows.length > 0 && !drilldownLoading}
          onReset={handleDrillReset}
        />

        {drilldownError ? (
          <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {drilldownError}</p>
        ) : (
          <DrilldownLoadingOverlay loading={drilldownLoading}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-surface-2 border-b border-neutral-200 dark:border-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('group_name')}>
                    维度（{currentDimensionLabel}） {groupSortKey === 'group_name' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('premium')}>
                    车险保费(万元) {groupSortKey === 'premium' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('plan_premium')}>
                    车险计划(万元) {groupSortKey === 'plan_premium' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('auto_count')}>
                    车险件数 {groupSortKey === 'auto_count' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('achievement_rate')}>
                    达成率 {groupSortKey === 'achievement_rate' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('growth_rate')}>
                    增长率 {groupSortKey === 'growth_rate' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">新能源占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">续保占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">转保占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">新保占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">过户转保占比</th>
                </tr>
              </thead>
              <tbody>
                {!drilldownLoading && sortedGroupRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-neutral-400">暂无下钻数据</td>
                  </tr>
                )}
                {sortedGroupRows.map((row) => {
                  const displayName = drilldownQuery.currentGroupBy === 'team' ? formatTeamName(row.group_name) : drilldownQuery.currentGroupBy === 'salesman' ? formatSalesmanName(row.group_name) : row.group_name;
                  return (
                  <tr
                    key={row.group_name}
                    className="border-b border-neutral-100 last:border-b-0"
                  >
                    <td className={cn('px-3 py-2', colorClasses.text.neutralDark, 'font-medium')}>
                      <DrilldownCell
                        label={displayName}
                        availableDimensions={drilldownQuery.availableDimensions}
                        dimensionLabels={PERFORMANCE_DIMENSION_LABELS}
                        onSelect={(dim) => handleCellDrillDown(row.group_name, dim)}
                        conditionalDimensions={getConditionalDimensions(drilldownQuery.drillPath)}
                      />
                    </td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.plan_premium)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatCount(row.auto_count)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric, getRateTextClass('achievement', row.achievement_rate))}>
                      {row.achievement_rate === null ? '-' : formatPercent(row.achievement_rate)}
                    </td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric, getRateTextClass('growth', row.growth_rate))}>
                      {row.growth_rate === null ? '-' : formatPercent(row.growth_rate)}
                    </td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.nev_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.renewal_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.transfer_business_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.new_car_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.transfer_rate)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </DrilldownLoadingOverlay>
        )}
      </section>
      </SectionBlock>

      <SectionBlock id="performance-top20">
      <SectionTitle title={`${scopePrefix}Top20业务员`} />
      <section className={cn(cardStyles.standard, 'space-y-3')}>
        <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>
          默认排序: 达成率升序
        </p>
        {topSalesmanQuery.error ? (
          <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {topSalesmanQuery.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-surface-2 border-b border-neutral-200 dark:border-subtle">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('dimension_name')}>
                    维度 {topSortKey === 'dimension_name' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('premium')}>
                    车险保费(万元) {topSortKey === 'premium' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('plan_premium')}>
                    车险计划(万元) {topSortKey === 'plan_premium' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('auto_count')}>
                    车险件数 {topSortKey === 'auto_count' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('achievement_rate')}>
                    达成率 {topSortKey === 'achievement_rate' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('growth_rate')}>
                    增长率 {topSortKey === 'growth_rate' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">新能源占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">续保占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">转保占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">新保占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">过户转保占比</th>
                </tr>
              </thead>
              <tbody>
                {topSalesmanQuery.loading && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-neutral-400">数据加载中...</td>
                  </tr>
                )}
                {!topSalesmanQuery.loading && sortedTopRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-neutral-400">暂无业务员数据</td>
                  </tr>
                )}
                {!topSalesmanQuery.loading && sortedTopRows.map((row: PerformanceTopSalesmanRow, index: number) => (
                  <tr key={`${row.dimension_name}-${index}`} className="border-b border-neutral-100 last:border-b-0">
                    <td className={cn('px-3 py-2 font-medium', colorClasses.text.neutralDark)}>{row.dimension_name}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.plan_premium)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatCount(row.auto_count)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric, getRateTextClass('achievement', row.achievement_rate))}>
                      {row.achievement_rate === null ? '-' : formatPercent(row.achievement_rate)}
                    </td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric, getRateTextClass('growth', row.growth_rate))}>
                      {row.growth_rate === null ? '-' : formatPercent(row.growth_rate)}
                    </td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.nev_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.renewal_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.transfer_business_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.new_car_rate)}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPercent(row.transfer_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </SectionBlock>

      {showPicker && (
        <DimensionPicker
          available={drilldownQuery.availableDimensions}
          onSelect={handleDimensionSelect}
          onCancel={() => setShowPicker(false)}
          title={
            heatmapSelection
              ? `热力图下钻：${heatmapSelection.org}（${heatmapSelection.date}）`
              : '选择分组维度'
          }
        />
      )}
    </div>
  );
};

export default memo(PerformanceAnalysisPanel);
