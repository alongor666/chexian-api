import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import type { AdvancedFilterState } from '@/shared/types/data';
import { Tabs } from '@/shared/ui/Tabs';
import type { TabItem } from '@/shared/ui/Tabs';
import { RBACBreadcrumb } from '@/shared/ui/RBACBreadcrumb';
import { useDataStatus } from '@/shared/contexts/DataContext';
import { echarts } from '@/shared/utils/echarts';
import { formatCount, formatPercent, formatWanDirect } from '@/shared/utils/formatters';
import { cardStyles, cn, colorClasses, colors, textStyles } from '@/shared/styles';
import {
  classifyAchievementBand,
  classifyGrowthBand,
  getAchievementBandLabel,
  getAchievementTextClass,
  getGrowthBandLabel,
  getGrowthTextClass,
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
  type PerformanceVehicleCategory,
  type PerformanceSummaryRow,
} from './hooks/usePerformanceSummary';
import { usePerformanceTrend } from './hooks/usePerformanceTrend';
import { PerformanceTrendChart } from './PerformanceTrendChart';
import { usePerformanceTopSalesman, type PerformanceTopSalesmanRow } from './hooks/usePerformanceTopSalesman';

interface PerformanceAnalysisPanelProps {
  filters: AdvancedFilterState;
}

const VEHICLE_TABS: TabItem[] = [
  { key: 'passenger', label: '非营业客车' },
  { key: 'business_passenger', label: '营业客车' },
  { key: 'truck', label: '货车' },
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

const SUMMARY_ORDER = ['整体', '主全', '交三', '单交'];
const ACHIEVEMENT_LINE_HINTS = ['105%', '100%', '95%', '90%'];
const GROWTH_LINE_HINTS = ['15%', '10%', '5%', '0%'];

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

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className={cn(textStyles.titleSmall, 'font-semibold')}>{title}</h2>
      <div className={cn('flex-1 h-px', colorClasses.bg.neutralLight)} />
    </div>
  );
}

function formatPremiumWanDisplay(value: number): string {
  return `${formatWanDirect(value)}万`;
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

  const points = useMemo(() => {
    const filtered = rows.filter((row) => row.achievement_rate !== null && row.growth_rate !== null);
    const maxCount = Math.max(...filtered.map((item) => safeNumber(item.auto_count)), 1);

    const getPointColor = (growthRate: number) => {
      switch (classifyGrowthBand(growthRate)) {
        case 'excellent':
          return colors.success.DEFAULT;
        case 'healthy':
          return colors.primary.DEFAULT;
        case 'abnormal':
          return colors.warning.DEFAULT;
        case 'danger':
          return colors.danger.DEFAULT;
        case 'negative':
          return colors.neutral[600];
        default:
          return colors.neutral[400];
      }
    };

    return filtered.map((row) => {
      const achievement = safeNumber(row.achievement_rate);
      const growth = safeNumber(row.growth_rate);
      const autoCount = Math.max(0, safeNumber(row.auto_count));
      const symbolSize = 12 + (autoCount / maxCount) * 18;

      return {
        name: row.group_name,
        value: [achievement, growth, autoCount],
        itemStyle: {
          color: getPointColor(growth),
          opacity: 0.85,
        },
        symbolSize,
      };
    });
  }, [rows]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    const chart = chartInstanceRef.current;
    if (!chart) return;

    if (loading) {
      return;
    }

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

    const option: EChartsOption = {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const value = params?.value || [0, 0, 0];
          const achievement = Number(value[0] || 0);
          const growth = Number(value[1] || 0);
          const count = Number(value[2] || 0);
          return [
            `<div style="font-size:12px;line-height:1.6;">`,
            `<div style="font-weight:600;">${params?.name || ''}</div>`,
            `<div>达成率：${formatPercent(achievement)}</div>`,
            `<div>增长率：${formatPercent(growth)}</div>`,
            `<div>车险件数：${formatCount(count)}</div>`,
            `</div>`,
          ].join('');
        },
      },
      grid: {
        left: '7%',
        right: '6%',
        top: 36,
        bottom: 46,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: '达成率',
        axisLabel: { formatter: '{value}%' },
        splitLine: { lineStyle: { color: colors.neutral[200] } },
      },
      yAxis: {
        type: 'value',
        name: '增长率',
        axisLabel: { formatter: '{value}%' },
        splitLine: { lineStyle: { color: colors.neutral[200] } },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: (value: any, params: any) => {
            const data = params?.data;
            if (typeof data?.symbolSize === 'number') return data.symbolSize;
            return 16;
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              type: 'dashed',
              color: colors.neutral[500],
              width: 1,
            },
            data: [
              { xAxis: 105 },
              { xAxis: 100 },
              { xAxis: 95 },
              { xAxis: 90 },
              { yAxis: 15 },
              { yAxis: 10 },
              { yAxis: 5 },
              { yAxis: 0 },
            ],
          },
        },
      ],
    };

    chart.setOption(option, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [error, loading, points]);

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
        达成率分界: {ACHIEVEMENT_LINE_HINTS.join(' / ')}；增长率分界: {GROWTH_LINE_HINTS.join(' / ')}。
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
  | 'auto_count'
  | 'achievement_rate'
  | 'growth_rate'
  | 'nev_rate'
  | 'renewal_rate'
  | 'transfer_business_rate'
  | 'new_car_rate'
  | 'transfer_rate';

type SortOrder = 'asc' | 'desc';

export const PerformanceAnalysisPanel: React.FC<PerformanceAnalysisPanelProps> = ({ filters }) => {
  const { isDataLoaded } = useDataStatus();

  const [vehicleCategory, setVehicleCategory] = useState<PerformanceVehicleCategory>('passenger');
  const [timePeriod, setTimePeriod] = useState<PerformanceTimePeriod>('day');
  const [growthMode, setGrowthMode] = useState<PerformanceGrowthMode>('mom');

  const [showPicker, setShowPicker] = useState(false);
  const [pendingRowValue, setPendingRowValue] = useState<string | null>(null);

  const [groupSortKey, setGroupSortKey] = useState<GroupSortKey>('premium');
  const [groupSortOrder, setGroupSortOrder] = useState<SortOrder>('desc');

  const [topSortKey, setTopSortKey] = useState<TopSortKey>('achievement_rate');
  const [topSortOrder, setTopSortOrder] = useState<SortOrder>('asc');

  const trendGranularity = useMemo(() => mapTimePeriodToTrendGranularity(timePeriod), [timePeriod]);

  const summaryQuery = usePerformanceSummary({
    filters,
    vehicleCategory,
    timePeriod,
    growthMode,
    enabled: isDataLoaded,
  });

  const trendQuery = usePerformanceTrend({
    filters,
    vehicleCategory,
    granularity: trendGranularity,
    enabled: isDataLoaded,
  });

  const drilldownQuery = usePerformanceDrilldown({
    filters,
    vehicleCategory,
    timePeriod,
    growthMode,
    enabled: isDataLoaded,
  });

  const topSalesmanQuery = usePerformanceTopSalesman({
    filters,
    vehicleCategory,
    timePeriod,
    growthMode,
    enabled: isDataLoaded,
  });

  const summaryRows = useMemo(() => {
    const rowMap = new Map(summaryQuery.rows.map((row) => [row.coverage_combination, row]));
    const ordered = SUMMARY_ORDER
      .map((key) => rowMap.get(key))
      .filter((item): item is PerformanceSummaryRow => Boolean(item));

    const rest = summaryQuery.rows.filter((row) => !SUMMARY_ORDER.includes(row.coverage_combination));
    return [...ordered, ...rest];
  }, [summaryQuery.rows]);

  const sortedGroupRows = useMemo(() => {
    const rows = [...drilldownQuery.rows];
    return rows.sort((a, b) => {
      if (groupSortKey === 'group_name') {
        const diff = a.group_name.localeCompare(b.group_name);
        return groupSortOrder === 'asc' ? diff : -diff;
      }

      const aVal = groupSortKey === 'achievement_rate' || groupSortKey === 'growth_rate'
        ? sortWithNull(a[groupSortKey], groupSortOrder)
        : safeNumber(a[groupSortKey]);
      const bVal = groupSortKey === 'achievement_rate' || groupSortKey === 'growth_rate'
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

      const aVal = topSortKey === 'achievement_rate' || topSortKey === 'growth_rate'
        ? sortWithNull(a[topSortKey], topSortOrder)
        : safeNumber(a[topSortKey]);
      const bVal = topSortKey === 'achievement_rate' || topSortKey === 'growth_rate'
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
    setPendingRowValue(null);
    setShowPicker(true);
  };

  const handleRowClick = (rowValue: string) => {
    if (drilldownQuery.availableDimensions.length === 0) return;
    setPendingRowValue(rowValue);
    setShowPicker(true);
  };

  const handleDimensionSelect = (dimension: PerformanceDimension) => {
    if (pendingRowValue === null) {
      drilldownQuery.selectDimension(dimension);
    } else {
      drilldownQuery.drillDown(pendingRowValue, dimension);
    }
    setPendingRowValue(null);
    setShowPicker(false);
  };

  const isDrillClickable = drilldownQuery.availableDimensions.length > 0;

  const currentDimensionLabel = drilldownQuery.currentGroupBy
    ? PERFORMANCE_DIMENSION_LABELS[drilldownQuery.currentGroupBy]
    : '维度';

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-20 bg-neutral-50/90 backdrop-blur-md pb-4 pt-2 -mx-2 px-2 border-b border-neutral-200 space-y-3">
        <div className="flex items-center gap-6">
          <Tabs
            items={VEHICLE_TABS}
            activeKey={vehicleCategory}
            onChange={(key) => setVehicleCategory(key as PerformanceVehicleCategory)}
            variant="pills"
            size="medium"
          />
          <div className="w-px h-6 bg-neutral-300" />
          <Tabs
            items={TIME_PERIOD_TABS}
            activeKey={timePeriod}
            onChange={(key) => setTimePeriod(key as PerformanceTimePeriod)}
            variant="pills"
            size="medium"
          />
          <div className="w-px h-6 bg-neutral-300" />
          <Tabs
            items={GROWTH_MODE_TABS}
            activeKey={growthMode}
            onChange={(key) => setGrowthMode(key as PerformanceGrowthMode)}
            variant="pills"
            size="medium"
          />
        </div>
      </div>

      <SectionTitle title="险别组合业绩环比" />
      <section className={cn(cardStyles.standard, 'p-0 overflow-hidden')}>
        {summaryQuery.error ? (
          <div className={cn('p-4', colorClasses.text.danger)}>加载失败: {summaryQuery.error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-600">险别组合</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">车险保费</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">车险件数</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">件均保费</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-600">增长率</th>
                </tr>
              </thead>
              <tbody>
                {summaryQuery.loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">数据加载中...</td>
                  </tr>
                )}
                {!summaryQuery.loading && summaryRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">暂无数据</td>
                  </tr>
                )}
                {!summaryQuery.loading && summaryRows.map((row, index) => (
                  <tr key={`${row.coverage_combination}-${index}`} className="border-b border-neutral-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-neutral-800">{row.coverage_combination}</td>
                    <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
                    <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatCount(row.auto_count)}</td>
                    <td className={cn('px-4 py-3 text-right', textStyles.numeric)}>{formatAvgPremiumDisplay(row.avg_premium)}</td>
                    <td className={cn('px-4 py-3 text-right', textStyles.numeric, getGrowthTextClass(classifyGrowthBand(row.growth_rate)), 'font-semibold')}>
                      {row.growth_rate === null ? '-' : formatPercent(row.growth_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SectionTitle title="车险保费、车险件数走势" />
      <div className="grid gap-4 lg:grid-cols-2">
        <PerformanceTrendChart
          title="车险保费走势"
          rows={trendQuery.rows}
          metric="premium"
          loading={trendQuery.loading}
          error={trendQuery.error}
        />
        <PerformanceTrendChart
          title="车险件数走势"
          rows={trendQuery.rows}
          metric="auto_count"
          loading={trendQuery.loading}
          error={trendQuery.error}
        />
      </div>

      <SectionTitle title="下钻分析" />

      <DistributionChart rows={drilldownQuery.rows} loading={drilldownQuery.loading} error={drilldownQuery.error} />

      <section className={cn(cardStyles.standard, 'space-y-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <RBACBreadcrumb
            drillPath={drilldownQuery.drillPath}
            currentGroupBy={drilldownQuery.currentGroupBy}
            onDrillUp={drilldownQuery.drillUp}
            canGoToTop={drilldownQuery.canGoToTop}
            dimensionLabels={PERFORMANCE_DIMENSION_LABELS}
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
                onClick={drilldownQuery.reset}
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
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>车险保费</p>
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
              <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>分布提示</p>
              <p className={cn(textStyles.body, colorClasses.text.neutralDark)}>
                达成率 {drilldownQuery.summary.achievement_rate === null ? '-' : getAchievementBandLabel(classifyAchievementBand(drilldownQuery.summary.achievement_rate))} /
                增长率 {drilldownQuery.summary.growth_rate === null ? '-' : getGrowthBandLabel(classifyGrowthBand(drilldownQuery.summary.growth_rate))}
              </p>
            </div>
          </div>
        )}

        {drilldownQuery.error ? (
          <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {drilldownQuery.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('group_name')}>
                    维度（{currentDimensionLabel}） {groupSortKey === 'group_name' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleGroupSort('premium')}>
                    车险保费 {groupSortKey === 'premium' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
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
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">新车占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">过户占比</th>
                </tr>
              </thead>
              <tbody>
                {drilldownQuery.loading && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-neutral-400">数据加载中...</td>
                  </tr>
                )}
                {!drilldownQuery.loading && sortedGroupRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-neutral-400">暂无下钻数据</td>
                  </tr>
                )}
                {!drilldownQuery.loading && sortedGroupRows.map((row, index) => (
                  <tr
                    key={`${row.group_name}-${index}`}
                    className={cn(
                      'border-b border-neutral-100 last:border-b-0',
                      isDrillClickable && 'cursor-pointer hover:bg-neutral-50'
                    )}
                    onClick={() => handleRowClick(row.group_name)}
                  >
                    <td className={cn('px-3 py-2', colorClasses.text.neutralDark, 'font-medium')}>{row.group_name}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
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

      <SectionTitle title="Top20业务员" />
      <section className={cn(cardStyles.standard, 'space-y-3')}>
        <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>
          默认排序: 达成率升序
        </p>
        {topSalesmanQuery.error ? (
          <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {topSalesmanQuery.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('dimension_name')}>
                    维度 {topSortKey === 'dimension_name' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600 cursor-pointer" onClick={() => handleTopSort('premium')}>
                    车险保费 {topSortKey === 'premium' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
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
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">新车占比</th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-600">过户占比</th>
                </tr>
              </thead>
              <tbody>
                {topSalesmanQuery.loading && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-neutral-400">数据加载中...</td>
                  </tr>
                )}
                {!topSalesmanQuery.loading && sortedTopRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-neutral-400">暂无业务员数据</td>
                  </tr>
                )}
                {!topSalesmanQuery.loading && sortedTopRows.map((row: PerformanceTopSalesmanRow, index: number) => (
                  <tr key={`${row.dimension_name}-${index}`} className="border-b border-neutral-100 last:border-b-0">
                    <td className={cn('px-3 py-2 font-medium', colorClasses.text.neutralDark)}>{row.dimension_name}</td>
                    <td className={cn('px-3 py-2 text-right', textStyles.numeric)}>{formatPremiumWanDisplay(row.premium)}</td>
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

      {showPicker && (
        <DimensionPicker
          available={drilldownQuery.availableDimensions}
          onSelect={handleDimensionSelect}
          onCancel={() => {
            setPendingRowValue(null);
            setShowPicker(false);
          }}
          title={pendingRowValue === null ? '选择分组维度' : `继续下钻：${pendingRowValue}`}
        />
      )}
    </div>
  );
};

export default memo(PerformanceAnalysisPanel);
