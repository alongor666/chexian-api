import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs } from '@/shared/ui/Tabs';
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
import { useBranch, branchCompanyName } from '@/shared/contexts/BranchContext';
import { formatCount, formatPercent, formatTeamName, formatSalesmanName } from '@/shared/utils/formatters';
import { cardStyles, cn, colorClasses, stickyTableStyles, textStyles, toggleButtonStyles } from '@/shared/styles';
import { ENABLE_BUNDLE_ROUTES } from '@/shared/api/client';
import {
  classifyGrowthBand,
  classifyPerformanceQuadrant,
  getGrowthTextClass,
  getQuadrantLabel,
} from './performanceStatus';
import {
  PERFORMANCE_DIMENSION_LABELS,
  usePerformanceDrilldown,
  type PerformanceDimension,
} from './hooks/usePerformanceDrilldown';
import {
  usePerformanceSummary,
  type PerformanceGrowthMode,
  type PerformanceTimePeriod,
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
import { HEATMAP_DIM_GROUPS } from './config/heatmapDimGroups';
import {
  type PerformanceHeatmapSelection,
} from './utils/performanceHeatmapSelection';
import { getConditionalDimensions } from '@/shared/config/drilldown-dimensions';
import { PerformanceOrgHeatmapV2, HeatmapFocusPanel } from './performance/PerformanceOrgHeatmapV2';

// ── b331 拆分（行为零变更）：类型/常量/纯 helper 与三个子组件抽到同目录文件；主组件保留于此。
//    依赖方向单向：本文件 → ./performancePanel.* / ./PerformancePanel*；被抽文件禁止反向 import 本文件。
import {
  PERF_HEATMAP_DRILL_DIMENSIONS,
  SEGMENT_TABS,
  TIME_PERIOD_TABS,
  GROWTH_MODE_TABS,
  EXPAND_DIMS_TABS,
  SUMMARY_ORDER,
  mapTimePeriodToTrendGranularity,
  formatPremiumWanDisplay,
  formatAvgPremiumDisplay,
  safeNumber,
  getRateTextClass,
  sortWithNull,
  getPerformanceHeatmapTitle,
  getPerformanceDrilldownTitle,
  resolvePerformanceDrilldownPrefetched,
  type PerformanceAnalysisPanelProps,
  type PerformanceDrilldownPrefetchedData,
  type GroupSortKey,
  type TopSortKey,
  type SortOrder,
} from './performancePanel.shared';
import { DistributionChart } from './PerformancePanelDistributionChart';
import { DimensionPicker } from './PerformancePanelDimensionPicker';

// 兼容旧入口：重导出曾从本文件导出的公共符号（PerformanceAnalysisPage / tests 仍从此处 import）。
export { PerformanceHeaderActions } from './PerformanceHeaderActions';
export { PERFORMANCE_HEATMAP_PERIOD_COUNT } from './performancePanel.shared';
export type { PerformanceDrilldownPrefetchedData } from './performancePanel.shared';
export { getPerformanceHeatmapTitle, getPerformanceDrilldownTitle, resolvePerformanceDrilldownPrefetched };

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
  const { effectiveBranch } = useBranch();

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

  const handlePerfHeatmapRowClick = useCallback((org: string) => {
    setPendingHeatmapRow(org);
    setShowHeatmapPicker(true);
  }, []);

  const handlePerfHeatmapDimSelect = useCallback((dim: HeatmapDimension) => {
    if (!pendingHeatmapRow) return;
    const newStep: HeatmapDrillStep = { dimension: heatmapGroupBy, value: pendingHeatmapRow };
    setHeatmapDrillPath((prev) => [...prev, newStep]);
    setHeatmapGroupBy(dim);
    setShowHeatmapPicker(false);
    setPendingHeatmapRow(null);
  }, [pendingHeatmapRow, heatmapGroupBy]);

  const handlePerfHeatmapBreadcrumbClick = useCallback((index: number) => {
    if (index < 0) {
      setHeatmapDrillPath([]);
      setHeatmapGroupBy('org_level_3');
      return;
    }
    const nextDim = heatmapDrillPath[index + 1]?.dimension as HeatmapDimension | undefined;
    setHeatmapDrillPath(heatmapDrillPath.slice(0, index + 1));
    if (nextDim) setHeatmapGroupBy(nextDim);
  }, [heatmapDrillPath]);

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
              // 单一 radiogroup 包住全部 8 个 radio（互斥单选语义要求每组恰好 1 个 aria-checked）。
              // 视觉上仍按"组织/业务"分组，分组标签 aria-hidden 仅装饰。
              // 修复 PR #480 codex P2（双 radiogroup 共用一个状态导致其中一组无任何 aria-checked）。
              <div
                role="radiogroup"
                aria-label="热力图维度"
                className="flex flex-wrap items-center gap-x-4 gap-y-2"
              >
                {HEATMAP_DIM_GROUPS.map((group) => (
                  <div key={group.groupLabel} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="text-xs text-neutral-400 dark:text-neutral-500"
                    >
                      {group.groupLabel}
                    </span>
                    <div className="inline-flex rounded-md bg-neutral-100 dark:bg-white/5 p-0.5 text-xs">
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
        isPickerOpen={showPicker}
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
        <p className={cn(textStyles.caption, colorClasses.text.neutralLight)}>
          达成率口径：年初至所选时间末的累计签单保费 ÷（年计划 × 时间进度）；时间进度按数据内最新签单日与全年天数（闰年感知）计算，与保费看板、报告中心同口径
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DrilldownBreadcrumb
            topLabel={branchCompanyName(effectiveBranch)}
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
                    年计划(万元) {groupSortKey === 'plan_premium' ? (groupSortOrder === 'asc' ? '↑' : '↓') : ''}
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
          默认排序: 达成率升序 · 达成率口径：年初至所选时间末的累计签单保费 ÷（年计划 × 时间进度），时间进度按数据内最新签单日计算（闰年感知）
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
                    年计划(万元) {topSortKey === 'plan_premium' ? (topSortOrder === 'asc' ? '↑' : '↓') : ''}
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
