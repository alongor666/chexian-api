/**
 * 驾意险推介率分析面板（层层下钻版）
 * Cross-Sell Recommendation Rate Analysis Panel (Hierarchical Drilldown)
 *
 * 交互流程：
 * 1. 初始：四川分公司汇总 KPI 卡片 + "选择下钻维度"按钮
 * 2. 选择维度 → 表格展示分组数据，每行可点击继续下钻
 * 3. 面包屑导航支持任意层级回退
 * 4. 固定口径：非营业客车 + 不分保额
 */

import React, { useEffect, useState, useMemo } from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { formatCount, formatPercent, formatTeamName, formatSalesmanName } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { useScopeLabel } from '../../shared/hooks/useScopeLabel';
import { useBranch, branchCompanyName } from '../../shared/contexts/BranchContext';
import { StickyTableFrame } from '../../shared/ui';
import { Tabs } from '../../shared/ui/Tabs';
import type { TabItem } from '../../shared/ui/Tabs';
import { SectionBlock } from '../../shared/ui/SectionTitle';
import { textStyles, cardStyles, tableStyles, colorClasses, stickyTableStyles, cn } from '../../shared/styles';
import {
  DrilldownBreadcrumb,
  DrilldownCell,
  DrilldownLoadingOverlay,
  DrilldownExhaustedBanner,
} from '../../shared/ui';
import type { DrilldownBreadcrumbStep } from '../../shared/ui';
import { CrossSellSummaryKpiBoard } from './CrossSellSummaryKpiBoard';
import { CrossSellQuadrantView } from './CrossSellQuadrantView';
import { CrossSellTrendChart, type CrossSellTrendAnnotation } from './CrossSellTrendChart';
import type { TrendGranularity } from './hooks/useCrossSellTrend';
import { getRateClassByField } from './crossSellRateStatus';
import type { SeatCoverageLevel, VehicleCategory } from './hooks/useCrossSellTimePeriod';
import { CrossSellTopSalesmanBoard } from './CrossSellTopSalesmanBoard';
import { CrossSellOrgTrendChart } from './CrossSellOrgTrendChart';
import { CrossSellMetricsHeatmap } from './CrossSellMetricsHeatmap';
import {
  type CrossSellHeatmapDimension,
  CROSS_SELL_HEATMAP_DIMENSION_LABELS,
  type CrossSellHeatmapDrillStep,
} from './hooks/useCrossSellHeatmap';
import {
  useCrossSellAnalysis,
  DIMENSION_LABELS,
  type CrossSellRow,
  type CrossSellDimension,
} from './hooks/useCrossSellAnalysis';

interface CrossSellAnalysisPanelProps {
  filters: AdvancedFilterState;
  trendGranularity: TrendGranularity;
}

const GRANULARITY_TABS: TabItem[] = [
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
  { key: 'quarterly', label: '季' },
  { key: 'yearly', label: '年' },
];

interface CrossSellHeaderControlsProps {
  trendGranularity: TrendGranularity;
  onTrendGranularityChange: (value: TrendGranularity) => void;
}

export const CrossSellHeaderControls: React.FC<CrossSellHeaderControlsProps> = ({
  trendGranularity,
  onTrendGranularityChange,
}) => (
  <div className="no-export max-w-full overflow-x-auto">
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary-bg text-primary-dark border border-primary-border">
        时间维度
      </span>
      <Tabs
        items={GRANULARITY_TABS}
        activeKey={trendGranularity}
        onChange={(key) => onTrendGranularityChange(key as TrendGranularity)}
        variant="pills"
        size="mini"
      />
    </div>
  </div>
);

// ============================================================
// 排序
// ============================================================

type SortKey = keyof CrossSellRow;
type SortOrder = 'asc' | 'desc';

function sortRows(rows: CrossSellRow[], key: SortKey, order: SortOrder): CrossSellRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'group_name') {
      // salesman 维度用 display_name（用户可见短名）排序；其他维度 display_name === group_name，fallback 安全
      const diff = (a.display_name ?? a.group_name).localeCompare(b.display_name ?? b.group_name);
      return order === 'asc' ? diff : -diff;
    }
    const aVal = Number(a[key]) || 0;
    const bVal = Number(b[key]) || 0;
    return order === 'asc' ? aVal - bVal : bVal - aVal;
  });
}

// ============================================================
// 维度选择器弹层
// ============================================================

function DimensionPicker({
  available,
  onSelect,
  onCancel,
  title,
}: {
  available: CrossSellDimension[];
  onSelect: (dim: CrossSellDimension) => void;
  onCancel: () => void;
  title: string;
}) {
  if (available.length === 0) return null;
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-white dark:bg-neutral-800 rounded-xl shadow-xl p-6 min-w-[320px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-base font-semibold ${colorClasses.text.neutralBlack} mb-4`}>{title}</h3>
        <div className="grid grid-cols-2 gap-2">
          {available.map((dim) => (
            <button
              key={dim}
              onClick={() => onSelect(dim)}
              className={`px-4 py-3 text-sm rounded-lg border ${colorClasses.border.neutral} hover:border-primary hover:bg-primary-bg transition-colors text-left`}
            >
              {DIMENSION_LABELS[dim]}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className={`mt-4 w-full px-4 py-2 text-sm ${colorClasses.text.neutralMuted} hover:text-neutral-700 transition-colors`}
        >
          取消
        </button>
      </div>
    </div>
  );
}

function getRateColorByField(field: keyof CrossSellRow, rate: number): string {
  if (field === 'zhuquan_rate' || field === 'jiaosan_rate') {
    return getRateClassByField(field, rate);
  }
  if (rate >= 30) return colorClasses.text.success + ' font-medium';
  if (rate >= 15) return colorClasses.text.neutralDark;
  return colorClasses.text.warning + ' font-medium';
}

// ============================================================
// 表格列定义
// ============================================================

interface ColumnDef {
  key: SortKey;
  label: string;
  type: 'text' | 'count' | 'rate';
  getColorClass?: (val: number) => string;
}

const TABLE_COLUMNS_FULL: ColumnDef[] = [
  { key: 'group_name', label: '维度', type: 'text' },
  { key: 'total_auto_count', label: '车险件数', type: 'count' },
  { key: 'total_driver_count', label: '驾意险件数', type: 'count' },
  { key: 'total_rate', label: '综合推介率', type: 'rate' },
  { key: 'danjiao_auto_count', label: '单交-车险', type: 'count' },
  { key: 'danjiao_driver_count', label: '单交-驾意险', type: 'count' },
  { key: 'danjiao_rate', label: '单交推介率', type: 'rate' },
  { key: 'jiaosan_auto_count', label: '交三-车险', type: 'count' },
  { key: 'jiaosan_driver_count', label: '交三-驾意险', type: 'count' },
  {
    key: 'jiaosan_rate', label: '交三推介率', type: 'rate',
    getColorClass: (v) => getRateClassByField('jiaosan_rate', v)
  },
  { key: 'zhuquan_auto_count', label: '主全-车险', type: 'count' },
  { key: 'zhuquan_driver_count', label: '主全-驾意险', type: 'count' },
  {
    key: 'zhuquan_rate', label: '主全推介率', type: 'rate',
    getColorClass: (v) => getRateClassByField('zhuquan_rate', v)
  },
];

const CORE_TABLE_COLUMNS = TABLE_COLUMNS_FULL.slice(0, 4);
interface InsightSummary {
  title: string;
  summary: string;
  bullets: string[];
  rateAnnotations: CrossSellTrendAnnotation[];
  premiumAnnotations: CrossSellTrendAnnotation[];
}

export const CROSS_SELL_HEATMAP_PERIOD_COUNT = 15;

export function resolveCrossSellHeatmapPeriod(
  timePeriod: 'day' | 'week' | 'month' | 'quarter' | 'year'
): 'day' | 'week' | 'month' | 'quarter' | null {
  return timePeriod === 'year' ? null : timePeriod;
}

export function getCrossSellHeatmapTitle(
  dimensionLabel: string,
  timePeriod: 'day' | 'week' | 'month' | 'quarter' | 'year'
): string {
  const resolvedPeriod = resolveCrossSellHeatmapPeriod(timePeriod);
  if (!resolvedPeriod) {
    return `${dimensionLabel}年度热力图`;
  }

  const periodUnitMap: Record<'day' | 'week' | 'month' | 'quarter', string> = {
    day: '日',
    week: '周',
    month: '月',
    quarter: '季度',
  };

  return `${dimensionLabel}驾意险${CROSS_SELL_HEATMAP_PERIOD_COUNT}${periodUnitMap[resolvedPeriod]}热力图`;
}

export function getAvailableHeatmapDrillDimensions(
  currentDimension: CrossSellHeatmapDimension,
  drillPath: CrossSellHeatmapDrillStep[],
  dimensions: Array<{ key: CrossSellHeatmapDimension; label: string }>
) {
  const usedDimensions = new Set<CrossSellHeatmapDimension>([
    currentDimension,
    ...drillPath.map((step) => step.dimension),
  ]);

  return dimensions.filter((dimension) => !usedDimensions.has(dimension.key));
}

function formatCell(col: ColumnDef, row: CrossSellRow, currentDimension?: string): string {
  const val = Number(row[col.key] ?? 0);
  if (col.type === 'rate') return formatPercent(val);
  if (col.type === 'count') return formatCount(val);
  const text = String(row[col.key] ?? '');
  if (col.key === 'group_name') {
    if (currentDimension === 'team') return formatTeamName(text);
    // salesman 维度优先用后端 display_name（短名+同名冲突机构后缀，已两级判重）；
    // group_name 现为带工号 key（仅下钻传参），fallback 去工号短名
    if (currentDimension === 'salesman') return String(row.display_name ?? '') || formatSalesmanName(text);
  }
  return text;
}

export function buildInsightSummary(
  trendRows: Array<{ time_period: string; coverage_combination: string; rate: number; avg_premium: number; driver_count?: number; auto_count?: number }>,
  trendGranularity: TrendGranularity
): InsightSummary | null {
  const overallRows = trendRows
    .filter((row) => row.coverage_combination === '整体')
    .sort((a, b) => a.time_period.localeCompare(b.time_period));

  if (overallRows.length === 0) return null;

  const latest = overallRows[overallRows.length - 1];
  const previous = overallRows[overallRows.length - 2];
  const maxRateRow = overallRows.reduce((best, current) => (current.rate > best.rate ? current : best), overallRows[0]);
  const minRateRow = overallRows.reduce((best, current) => (current.rate < best.rate ? current : best), overallRows[0]);
  const maxPremiumRow = overallRows.reduce(
    (best, current) => (current.avg_premium > best.avg_premium ? current : best),
    overallRows[0]
  );
  const minPremiumRow = overallRows.reduce(
    (best, current) => (current.avg_premium < best.avg_premium ? current : best),
    overallRows[0]
  );
  const totalDriverCount = overallRows.reduce((sum, row) => sum + (row.driver_count ?? 0), 0);
  const totalAutoCount = overallRows.reduce((sum, row) => sum + (row.auto_count ?? 0), 0);
  const avgRate = totalAutoCount > 0 ? (totalDriverCount / totalAutoCount) * 100 : 0;
  const avgPremium = overallRows.reduce((sum, row) => sum + row.avg_premium, 0) / overallRows.length;
  const momentum = previous ? latest.rate - previous.rate : 0;

  const granularityLabelMap: Record<TrendGranularity, string> = {
    daily: '日',
    weekly: '周',
    monthly: '月',
    quarterly: '季',
    yearly: '年',
  };

  const directionText = momentum > 0 ? '回升' : momentum < 0 ? '回落' : '持平';

  return {
    title: `AI 深度解读 · 最近${overallRows.length}${granularityLabelMap[trendGranularity]}`,
    summary: `整体推介率当前为 ${formatPercent(latest.rate)}，相较上一${granularityLabelMap[trendGranularity]}${directionText}${formatPercent(Math.abs(momentum))}，当前驾意件均 ${formatCount(Math.round(latest.avg_premium))} 元。`,
    bullets: [
      `最高推介率出现在 ${maxRateRow.time_period}，达到 ${formatPercent(maxRateRow.rate)}；最低值出现在 ${minRateRow.time_period}，为 ${formatPercent(minRateRow.rate)}。`,
      `驾意件均最高出现在 ${maxPremiumRow.time_period}，达到 ${formatCount(Math.round(maxPremiumRow.avg_premium))} 元；最低值出现在 ${minPremiumRow.time_period}，为 ${formatCount(Math.round(minPremiumRow.avg_premium))} 元。`,
      `最近${overallRows.length}${granularityLabelMap[trendGranularity]}平均推介率 ${formatPercent(avgRate)}，平均驾意件均 ${formatCount(Math.round(avgPremium))} 元。`,
      momentum < 0
        ? '当前更适合优先排查机构和业务员明细，确认是转化效率回落还是高价值保单减少。'
        : '当前趋势偏正向，建议结合热力图与 TOP20 排行确认增长来自哪些机构与业务员。',
    ],
    rateAnnotations: [
      {
        kind: 'max',
        timePeriod: maxRateRow.time_period,
        value: maxRateRow.rate,
        label: '最高推介率',
        description: `${maxRateRow.time_period} ${formatPercent(maxRateRow.rate)}`,
      },
      {
        kind: 'min',
        timePeriod: minRateRow.time_period,
        value: minRateRow.rate,
        label: '最低推介率',
        description: `${minRateRow.time_period} ${formatPercent(minRateRow.rate)}`,
      },
    ],
    premiumAnnotations: [
      {
        kind: 'max',
        timePeriod: maxPremiumRow.time_period,
        value: maxPremiumRow.avg_premium,
        label: '最高件均',
        description: `${maxPremiumRow.time_period} ${formatCount(Math.round(maxPremiumRow.avg_premium))}元`,
      },
      {
        kind: 'min',
        timePeriod: minPremiumRow.time_period,
        value: minPremiumRow.avg_premium,
        label: '最低件均',
        description: `${minPremiumRow.time_period} ${formatCount(Math.round(minPremiumRow.avg_premium))}元`,
      },
    ],
  };
}

function DataBarCell({
  value,
  maxValue,
  align = 'right',
  children,
}: {
  value: number;
  maxValue: number;
  align?: 'left' | 'right';
  children: React.ReactNode;
}) {
  const width = maxValue > 0 ? `${Math.max(8, (value / maxValue) * 100)}%` : '0%';
  return (
    <div className="relative overflow-hidden rounded-md">
      <div
        className="absolute inset-y-1 rounded-sm bg-primary-bg"
        style={{
          width,
          left: align === 'left' ? '0.25rem' : undefined,
          right: align === 'right' ? '0.25rem' : undefined,
        }}
        aria-hidden="true"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// SectionTitle 和 SectionBlock 已提取到 shared/ui/SectionTitle

// ============================================================
// 主组件
// ============================================================

export const CrossSellAnalysisPanel: React.FC<CrossSellAnalysisPanelProps> = ({
  filters,
  trendGranularity,
}) => {
  const vehicleCategory: VehicleCategory = 'passenger';
  const seatCoverageLevel: SeatCoverageLevel = 'all';
  const { isDataLoaded } = useDataStatus();
  const { salesmanTeamMap } = useGlobalFilters();
  const { prefix: scopePrefix } = useScopeLabel(filters, salesmanTeamMap);
  const { effectiveBranch } = useBranch();
  const [sortKey, setSortKey] = useState<SortKey>('total_auto_count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showDetailedColumns, setShowDetailedColumns] = useState(false);
  const [heatmapDimension, setHeatmapDimension] = useState<CrossSellHeatmapDimension>('org_level_3');
  // 热力图下钻状态
  const [heatmapDrillPath, setHeatmapDrillPath] = useState<CrossSellHeatmapDrillStep[]>([]);
  const [heatmapGroupBy, setHeatmapGroupBy] = useState<CrossSellHeatmapDimension>('org_level_3');
  const [showHeatmapPicker, setShowHeatmapPicker] = useState(false);
  const [pendingHeatmapRow, setPendingHeatmapRow] = useState<string | null>(null);

  // 标签派生自 CROSS_SELL_HEATMAP_DIMENSION_LABELS（← SSOT drilldown-dimensions），杜绝 team 文案页内漂移
  const HEATMAP_DRILL_DIMENSIONS = useMemo<{ key: CrossSellHeatmapDimension; label: string }[]>(
    () =>
      (Object.entries(CROSS_SELL_HEATMAP_DIMENSION_LABELS) as [CrossSellHeatmapDimension, string][]).map(
        ([key, label]) => ({ key, label }),
      ),
    [],
  );

  const handleHeatmapRowClick = (rowLabel: string) => {
    setPendingHeatmapRow(rowLabel);
    setShowHeatmapPicker(true);
  };

  const handleHeatmapDimSelect = (dim: CrossSellHeatmapDimension) => {
    if (!pendingHeatmapRow) return;
    const newStep: CrossSellHeatmapDrillStep = { dimension: heatmapGroupBy, value: pendingHeatmapRow };
    setHeatmapDrillPath((prev) => [...prev, newStep]);
    setHeatmapGroupBy(dim);
    setShowHeatmapPicker(false);
    setPendingHeatmapRow(null);
  };

  const handleHeatmapBreadcrumbClick = (index: number) => {
    if (index < 0) {
      setHeatmapDrillPath([]);
      setHeatmapGroupBy('org_level_3');
      return;
    }
    const nextDim = heatmapDrillPath[index + 1]?.dimension as CrossSellHeatmapDimension | undefined;
    setHeatmapDrillPath(heatmapDrillPath.slice(0, index + 1));
    if (nextDim) setHeatmapGroupBy(nextDim);
  };

  // 维度选择器状态（仅初始选维度使用）
  const [showPicker, setShowPicker] = useState(false);

  const {
    summary,
    rows,
    drillPath,
    currentGroupBy,
    availableDimensions,
    timePeriodSummary,
    trendRows,
    topSalesman,
    selectDimension,
    drillDown,
    drillUp,
    reset,
    loading,
    error,
    canGoToTop,
  } = useCrossSellAnalysis({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    timePeriod: trendGranularity,
    enabled: isDataLoaded,
  });

  // 映射时间粒度到 KpiBoard 的 TimePeriod
  const mappedTimePeriodForKpi = useMemo(() => {
    switch (trendGranularity) {
      case 'daily': return 'day';
      case 'weekly': return 'week';
      case 'monthly': return 'month';
      case 'quarterly': return 'quarter';
      case 'yearly': return 'year';
      default: return 'day';
    }
  }, [trendGranularity]);
  const heatmapTimePeriod = useMemo(
    () => resolveCrossSellHeatmapPeriod(mappedTimePeriodForKpi),
    [mappedTimePeriodForKpi]
  );
  const availableHeatmapDrillDimensions = useMemo(
    () => getAvailableHeatmapDrillDimensions(heatmapGroupBy, heatmapDrillPath, HEATMAP_DRILL_DIMENSIONS),
    [heatmapGroupBy, heatmapDrillPath]
  );

  const sortedRows = useMemo(
    () => sortRows(rows, sortKey, sortOrder),
    [rows, sortKey, sortOrder]
  );
  const tableColumns = showDetailedColumns ? TABLE_COLUMNS_FULL : CORE_TABLE_COLUMNS;
  const insightSummary = useMemo(() => buildInsightSummary(trendRows, trendGranularity), [trendRows, trendGranularity]);
  const maxAutoCount = useMemo(
    () => Math.max(0, ...sortedRows.map((row) => Number(row.total_auto_count ?? 0))),
    [sortedRows]
  );
  const maxDriverCount = useMemo(
    () => Math.max(0, ...sortedRows.map((row) => Number(row.total_driver_count ?? 0))),
    [sortedRows]
  );
  const maxRate = useMemo(
    () => Math.max(0, ...sortedRows.map((row) => Number(row.total_rate ?? 0))),
    [sortedRows]
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  /** DrilldownCell 行内选择维度 → 直接下钻（rowValue=带工号 key 精确过滤，displayLabel=短名供面包屑） */
  const handleCellDrillDown = (rowValue: string, dimension: string, displayLabel?: string) => {
    drillDown(rowValue, dimension as CrossSellDimension, displayLabel);
  };

  /** DimensionPicker（仅初始选维度） */
  const handleDimensionSelect = (dim: CrossSellDimension) => {
    selectDimension(dim);
    setShowPicker(false);
  };

  /** 首次下钻（从汇总 → 选择维度） */
  const handleInitialDrill = () => {
    setShowPicker(true);
  };

  const canDrillDeeper = availableDimensions.length > 0;

  useEffect(() => {
    if (heatmapTimePeriod) return;
    setShowHeatmapPicker(false);
    setPendingHeatmapRow(null);
  }, [heatmapTimePeriod]);

  return (
    <div className="space-y-5">
      <SectionBlock id="cross-sell-kpi" title="推介率驱动因子环比">
        <CrossSellSummaryKpiBoard
          vehicleCategory={vehicleCategory}
          seatCoverageLevel={seatCoverageLevel}
          filters={filters}
          timePeriod={mappedTimePeriodForKpi}
          prefetchedSummary={timePeriodSummary}
        />
      </SectionBlock>

      {insightSummary && (
        <SectionBlock id="cross-sell-insight" title="AI 深度解读">
          <div className={cn(cardStyles.standard, 'grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]')}>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full bg-primary-bg px-2 py-0.5 text-[11px] font-semibold text-primary-dark">
                  {insightSummary.title}
                </span>
              </div>
              <p className={cn(textStyles.body, 'text-[15px] leading-7 text-neutral-800')}>
                {insightSummary.summary}
              </p>
            </div>
            <div className="space-y-2 rounded-xl border border-neutral-200 dark:border-subtle bg-neutral-50 dark:bg-surface-2 p-4">
              {insightSummary.bullets.map((bullet) => (
                <div key={bullet} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                  <p className={cn(textStyles.body, 'leading-6 text-neutral-700')}>{bullet}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionBlock>
      )}

      <SectionBlock
        id="cross-sell-heatmap"
        title={getCrossSellHeatmapTitle(
          CROSS_SELL_HEATMAP_DIMENSION_LABELS[heatmapGroupBy],
          mappedTimePeriodForKpi
        )}
        leftContent={
          heatmapDrillPath.length === 0 ? (
            <Tabs
              items={(Object.entries(CROSS_SELL_HEATMAP_DIMENSION_LABELS) as [CrossSellHeatmapDimension, string][]).map(([key, label]) => ({ key, label }))}
              activeKey={heatmapDimension}
              onChange={(key) => { setHeatmapDimension(key as CrossSellHeatmapDimension); setHeatmapGroupBy(key as CrossSellHeatmapDimension); }}
              variant="pills"
              size="mini"
            />
          ) : (
            <div className="flex items-center gap-1 text-xs text-neutral-500">
              <button className="hover:text-primary hover:underline cursor-pointer" onClick={() => handleHeatmapBreadcrumbClick(-1)}>
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
                    onClick={() => handleHeatmapBreadcrumbClick(i)}
                  >
                    {step.value}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )
        }
      >
        {showHeatmapPicker && (
          <div className={cn(cardStyles.base, `border ${colorClasses.border.primary} ${colorClasses.bg.primary} p-3`)}>
            <p className="mb-2 text-xs text-neutral-600">
              选择 <strong>{pendingHeatmapRow}</strong> 的下钻维度：
            </p>
            <div className="flex flex-wrap gap-2">
              {availableHeatmapDrillDimensions.map((d) => (
                <button
                  key={d.key}
                  className={`cursor-pointer rounded-full border ${colorClasses.border.primary} bg-white dark:bg-neutral-800 px-3 py-1 text-xs hover:bg-primary-100`}
                  onClick={() => handleHeatmapDimSelect(d.key)}
                >
                  {d.label}
                </button>
              ))}
              <button
                className="cursor-pointer rounded-full bg-neutral-100 px-3 py-1 text-xs hover:bg-neutral-200"
                onClick={() => { setShowHeatmapPicker(false); setPendingHeatmapRow(null); }}
              >
                取消
              </button>
            </div>
          </div>
        )}
        {heatmapTimePeriod ? (
          <CrossSellMetricsHeatmap
            filters={filters}
            vehicleCategory={vehicleCategory}
            seatCoverageLevel={seatCoverageLevel}
            timePeriod={heatmapTimePeriod}
            groupByDimension={heatmapDrillPath.length === 0 ? heatmapDimension : heatmapGroupBy}
            dimensionLabel={CROSS_SELL_HEATMAP_DIMENSION_LABELS[heatmapDrillPath.length === 0 ? heatmapDimension : heatmapGroupBy]}
            drillFilter={heatmapDrillPath}
            onRowClick={handleHeatmapRowClick}
          />
        ) : (
          <div className={cn(cardStyles.standard, 'border-dashed')}>
            <p className={cn(textStyles.body, colorClasses.text.neutralDark)}>
              年维度暂不提供最近 {CROSS_SELL_HEATMAP_PERIOD_COUNT} 期热力图。请切换到日、周、月或季，查看机构连续表现与下钻明细。
            </p>
          </div>
        )}
      </SectionBlock>

      <SectionBlock id="cross-sell-trend" title={`${scopePrefix}推介率与驾意件均走势`}>
        <div className="grid gap-4 xl:grid-cols-2">
          <CrossSellTrendChart
            vehicleCategory={vehicleCategory}
            seatCoverageLevel={seatCoverageLevel}
            filters={filters}
            granularity={trendGranularity}
            metric="rate"
            title="驾意险推介率走势"
            enabled={isDataLoaded}
            annotations={insightSummary?.rateAnnotations}
            rowsOverride={trendRows}
          />
          <CrossSellTrendChart
            vehicleCategory={vehicleCategory}
            seatCoverageLevel={seatCoverageLevel}
            filters={filters}
            granularity={trendGranularity}
            metric="avg_premium"
            title="驾意件均走势"
            enabled={isDataLoaded}
            annotations={insightSummary?.premiumAnnotations}
            rowsOverride={trendRows}
          />
        </div>
        <CrossSellOrgTrendChart
          filters={filters}
          vehicleCategory={vehicleCategory}
          seatCoverageLevel={seatCoverageLevel}
          granularity={trendGranularity}
        />
      </SectionBlock>

      <SectionBlock id="cross-sell-drilldown" title="下钻分析">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white dark:bg-neutral-800 p-3 shadow-sm">
          <DrilldownBreadcrumb
            topLabel={branchCompanyName(effectiveBranch)}
            path={drillPath.map((s): DrilldownBreadcrumbStep => ({
              label: s.label,
              dimension: s.dimension,
              value: s.value,
            }))}
            onNavigate={drillUp}
            canGoToTop={canGoToTop}
            dimensionLabels={DIMENSION_LABELS}
            currentGroupBy={currentGroupBy}
          />
          <div className="flex flex-wrap items-center gap-2">
            {currentGroupBy && (
              <button
                type="button"
                onClick={() => setShowDetailedColumns((prev) => !prev)}
                className="rounded-md border border-neutral-200 dark:border-subtle bg-neutral-50 dark:bg-surface-2 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:hover:bg-white/8"
              >
                {showDetailedColumns ? '收起险种明细' : '展开险种明细'}
              </button>
            )}
            {(drillPath.length > 0 || currentGroupBy) && (
              <button
                onClick={reset}
                className="rounded-md border border-primary-border bg-primary-bg px-3 py-1.5 text-xs font-medium text-primary-dark transition-colors hover:bg-primary-100"
              >
                重置分析
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-danger-border bg-danger-bg p-4">
            <p className="text-sm font-semibold text-danger">查询失败</p>
            <p className="mt-1 text-sm text-danger">{error}</p>
          </div>
        )}

        <DrilldownExhaustedBanner
          visible={!canDrillDeeper && sortedRows.length > 0 && !loading}
          onReset={reset}
        />

        <DrilldownLoadingOverlay loading={loading}>
          <>
            {!currentGroupBy && summary && !loading && (
              <div className={cn(cardStyles.spacious, 'text-center')}>
                <p className={`mb-4 ${colorClasses.text.neutralMuted}`}>默认仅展示核心指标。选择维度后可继续下钻到团队、业务员等明细层级。</p>
                <button
                  onClick={handleInitialDrill}
                  className="rounded-lg bg-primary px-6 py-3 font-medium text-white transition-colors hover:bg-primary-dark"
                >
                  选择下钻维度
                </button>
              </div>
            )}

            {currentGroupBy && sortedRows.length > 0 && (
              <div className="space-y-4">
                <CrossSellQuadrantView
                  rows={rows}
                  currentDimensionLabel={DIMENSION_LABELS[currentGroupBy]}
                />
                <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800 shadow-sm">
                  <div className={`flex items-center justify-between border-b border-neutral-100 dark:border-subtle px-4 py-3`}>
                    <span className={`text-sm ${colorClasses.text.neutral}`}>
                      按<strong>{DIMENSION_LABELS[currentGroupBy]}</strong>分组
                      {` (${sortedRows.length} 条)`}
                    </span>
                  </div>
                  <StickyTableFrame maxHeight={600}>
                    <table className="min-w-full text-sm">
                      <thead className={cn(tableStyles.header, stickyTableStyles.header)}>
                        <tr>
                          {tableColumns.map((col) => (
                            <th
                              key={col.key}
                              onClick={() => handleSort(col.key)}
                              className={cn(
                                tableStyles.headerCell,
                                'whitespace-nowrap cursor-pointer select-none border-b border-neutral-200 dark:border-subtle transition-colors hover:bg-neutral-100 dark:hover:bg-white/8',
                                col.key === 'group_name'
                                  ? cn(stickyTableStyles.firstColumnHeader, 'min-w-[180px] bg-neutral-50 dark:bg-surface-2')
                                  : ''
                              )}
                              style={{ textAlign: col.type === 'text' ? 'left' : 'right' }}
                            >
                              {col.label}
                              <span className={cn('ml-1', sortKey === col.key ? 'text-primary' : 'opacity-40')}>
                                {sortKey === col.key ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((row, idx) => (
                          <tr
                            // group_name(业务员=带工号)在 hierarchy 分组(org/team)下跨机构可能多行重名，
                            // 附 idx 兜底保证 React key 唯一（display_name 同机构同名#工号回退亦可能重复）
                            key={`${row.group_name}-${idx}`}
                            className="border-b border-neutral-50 dark:border-subtle transition-colors hover:bg-neutral-50/60 dark:hover:bg-white/8"
                          >
                            {tableColumns.map((col) => {
                              const numericValue = Number(row[col.key] ?? 0);
                              const maxValue =
                                col.key === 'total_auto_count'
                                  ? maxAutoCount
                                  : col.key === 'total_driver_count'
                                    ? maxDriverCount
                                    : col.key === 'total_rate'
                                      ? maxRate
                                      : 0;

                              // 名称列使用 DrilldownCell
                              if (col.key === 'group_name') {
                                const displayName = formatCell(col, row, currentGroupBy ?? undefined);
                                return (
                                  <td
                                    key={col.key}
                                    className={cn(
                                      'relative bg-white dark:bg-neutral-800',
                                      stickyTableStyles.firstColumn, 'z-10 min-w-[180px]'
                                    )}
                                  >
                                    <span className={tableStyles.cell}>
                                      <DrilldownCell
                                        label={displayName}
                                        availableDimensions={availableDimensions}
                                        dimensionLabels={DIMENSION_LABELS}
                                        onSelect={(dim) => handleCellDrillDown(row.group_name, dim, displayName)}
                                        className="font-medium"
                                      />
                                    </span>
                                  </td>
                                );
                              }

                              const content = (
                                <span
                                  className={cn(
                                    tableStyles.cell,
                                    col.type === 'rate'
                                      ? cn(
                                          'block text-right',
                                          textStyles.numeric,
                                          col.getColorClass
                                            ? col.getColorClass(numericValue)
                                            : getRateColorByField(col.key, numericValue)
                                        )
                                      : cn('block text-right', textStyles.numeric, 'text-neutral-700')
                                  )}
                                >
                                  {formatCell(col, row, currentGroupBy ?? undefined)}
                                </span>
                              );

                              return (
                                <td
                                  key={col.key}
                                  className="relative bg-white dark:bg-neutral-800"
                                >
                                  {['total_auto_count', 'total_driver_count', 'total_rate'].includes(String(col.key)) ? (
                                    <DataBarCell value={numericValue} maxValue={maxValue}>
                                      {content}
                                    </DataBarCell>
                                  ) : (
                                    content
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </StickyTableFrame>
                  {!showDetailedColumns && (
                    <div className="border-t border-neutral-100 dark:border-subtle bg-neutral-50 dark:bg-surface-2 px-4 py-2 text-xs text-neutral-500">
                      当前默认只显示核心列，点击“展开险种明细”查看单交 / 交三 / 主全明细。
                    </div>
                  )}
                </div>
              </div>
            )}

            {!summary && sortedRows.length === 0 && !loading && (
              <div className={cn(cardStyles.spacious, 'text-center text-neutral-400')}>
                暂无数据
              </div>
            )}
          </>
        </DrilldownLoadingOverlay>
      </SectionBlock>

      {/* 维度选择器弹层（仅初始选维度） */}
      {showPicker && (
        <DimensionPicker
          available={availableDimensions}
          onSelect={handleDimensionSelect}
          onCancel={() => setShowPicker(false)}
          title="选择下钻维度"
        />
      )}

      <SectionBlock id="cross-sell-top20" title={`${scopePrefix}TOP20推介率`}>
        <CrossSellTopSalesmanBoard
          filters={filters}
          vehicleCategory={vehicleCategory}
          seatCoverageLevel={seatCoverageLevel}
          timePeriod={trendGranularity}
          prefetchedTopSalesman={topSalesman}
        />
      </SectionBlock>
    </div>
  );
};
