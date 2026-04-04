/**
 * 交叉销售热力图组件 V2
 * Cross-Sell Metrics Heatmap
 *
 * 显示所有分组最近15个时段的核心指标热力图。
 * 升级为7级发散色带，深色模式正常区退后、异常跳出。
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';

import type { AdvancedFilterState } from '../../shared/types/data';
import type { VehicleCategory, SeatCoverageLevel } from './hooks/useCrossSellTimePeriod';
import {
  useCrossSellHeatmap,
  type HeatmapPoint,
  type CrossSellHeatmapTimePeriod,
  type CrossSellHeatmapDimension,
  type CrossSellHeatmapDrillStep,
} from './hooks/useCrossSellHeatmap';
import { Tabs } from '../../shared/ui/Tabs';
import type { TabItem } from '../../shared/ui/Tabs';
import { StickyTableFrame } from '../../shared/ui';
import { textStyles, cardStyles, colorClasses, stickyTableStyles, cn } from '../../shared/styles';
import { formatPercent } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { useTheme } from '../../shared/theme';

// ==================== Types ====================

type MetricType = 'rate' | 'penetration' | 'achievement' | 'driver_count' | 'auto_count' | 'avg_premium';
type HeatmapTier = 'critical' | 'weak' | 'below' | 'normal' | 'above' | 'strong' | 'excellent' | 'unknown';

const BRANCH_SUMMARY_ROW_LABEL = '分公司';

const METRIC_TABS: TabItem[] = [
  { key: 'rate', label: '推介率' },
  { key: 'penetration', label: '渗透率' },
  { key: 'achievement', label: '达成率' },
  { key: 'driver_count', label: '驾意件数' },
  { key: 'auto_count', label: '车险件数' },
  { key: 'avg_premium', label: '驾意件均' },
];

const METRIC_LABELS: Record<MetricType, string> = {
  rate: '推介率',
  penetration: '渗透率',
  achievement: '达成率',
  driver_count: '驾意件数',
  auto_count: '车险件数',
  avg_premium: '驾意件均',
};

// ==================== 7级发散色带 ====================

interface ColorEntry { readonly bg: string; readonly text: string }

const COLORS_LIGHT: Record<HeatmapTier, ColorEntry> = {
  critical:  { bg: '#fef2f2', text: '#991b1b' },
  weak:      { bg: '#fffbeb', text: '#92400e' },
  below:     { bg: '#fefce8', text: '#a16207' },
  normal:    { bg: '#f9fafb', text: '#6b7280' },
  above:     { bg: '#f0f9ff', text: '#075985' },
  strong:    { bg: '#e0f2fe', text: '#0c4a6e' },
  excellent: { bg: '#f0fdfa', text: '#134e4a' },
  unknown:   { bg: '#f3f4f6', text: '#9ca3af' },
};

const COLORS_DARK: Record<HeatmapTier, ColorEntry> = {
  critical:  { bg: 'rgba(220,80,60,0.30)',  text: '#fca5a5' },
  weak:      { bg: 'rgba(217,119,6,0.20)',  text: '#fcd34d' },
  below:     { bg: 'rgba(217,119,6,0.09)',  text: '#d4a574' },
  normal:    { bg: 'rgba(255,255,255,0.04)', text: '#6b7280' },
  above:     { bg: 'rgba(14,165,233,0.09)', text: '#7dd3fc' },
  strong:    { bg: 'rgba(14,165,233,0.20)', text: '#38bdf8' },
  excellent: { bg: 'rgba(20,184,166,0.26)', text: '#5eead4' },
  unknown:   { bg: 'rgba(255,255,255,0.02)', text: '#4b5563' },
};

const TIER_LABELS: Record<HeatmapTier, string> = {
  critical: '危险', weak: '偏弱', below: '轻弱', normal: '正常',
  above: '轻强', strong: '偏强', excellent: '优秀', unknown: '无数据',
};

const LEGEND_TIERS: readonly HeatmapTier[] = ['critical', 'weak', 'below', 'normal', 'above', 'strong', 'excellent'];

// ==================== 阈值配置 ====================

interface ThresholdEntry { readonly tier: HeatmapTier; readonly min?: number }

/** 推介率阈值（基准75%） */
const RATE_THRESHOLDS: readonly ThresholdEntry[] = [
  { tier: 'excellent', min: 85 },
  { tier: 'strong',    min: 80 },
  { tier: 'above',     min: 75 },
  { tier: 'normal',    min: 70 },
  { tier: 'below',     min: 65 },
  { tier: 'weak',      min: 60 },
  { tier: 'critical' },
];

/** 渗透率阈值 */
const PENETRATION_THRESHOLDS: readonly ThresholdEntry[] = [
  { tier: 'excellent', min: 12 },
  { tier: 'strong',    min: 10 },
  { tier: 'above',     min: 8 },
  { tier: 'normal',    min: 6 },
  { tier: 'below',     min: 4 },
  { tier: 'weak',      min: 2 },
  { tier: 'critical' },
];

/** 达成率阈值（基准100%） */
const ACHIEVEMENT_THRESHOLDS: readonly ThresholdEntry[] = [
  { tier: 'excellent', min: 110 },
  { tier: 'strong',    min: 100 },
  { tier: 'above',     min: 90 },
  { tier: 'normal',    min: 80 },
  { tier: 'below',     min: 70 },
  { tier: 'weak',      min: 60 },
  { tier: 'critical' },
];

/** 件均保费阈值（基准300元） */
const AVG_PREMIUM_THRESHOLDS: readonly ThresholdEntry[] = [
  { tier: 'excellent', min: 360 },
  { tier: 'strong',    min: 333 },
  { tier: 'above',     min: 300 },
  { tier: 'normal',    min: 270 },
  { tier: 'below',     min: 240 },
  { tier: 'weak',      min: 200 },
  { tier: 'critical' },
];

function resolveTierByThresholds(value: number, thresholds: readonly ThresholdEntry[]): HeatmapTier {
  for (const { tier, min } of thresholds) {
    if (min === undefined || value >= min) return tier;
  }
  return 'critical';
}

/** 件数类指标：动态分位数分7段 */
function resolveTierByQuantile(value: number, sorted: readonly number[]): HeatmapTier {
  if (sorted.length === 0) return 'normal';
  const quantiles = [0.05, 0.20, 0.40, 0.60, 0.80, 0.95];
  const cuts = quantiles.map((q) => {
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  });
  const tiers: HeatmapTier[] = ['critical', 'weak', 'below', 'normal', 'above', 'strong', 'excellent'];
  let idx = 0;
  for (let i = 0; i < cuts.length; i++) {
    if (value >= cuts[i]) idx = i + 1;
  }
  return tiers[Math.min(idx, tiers.length - 1)];
}

// ==================== Helpers ====================

interface CrossSellMetricsHeatmapProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel: SeatCoverageLevel;
  timePeriod?: CrossSellHeatmapTimePeriod;
  groupByDimension?: CrossSellHeatmapDimension;
  dimensionLabel?: string;
  drillFilter?: CrossSellHeatmapDrillStep[];
  onRowClick?: (rowLabel: string) => void;
}

function getCellValue(metric: MetricType, row: HeatmapPoint): number | null {
  if (metric === 'rate') return row.rate;
  if (metric === 'penetration') return row.penetration_rate;
  if (metric === 'achievement') return row.achievement_rate;
  if (metric === 'driver_count') return row.driver_count;
  if (metric === 'auto_count') return row.auto_count;
  return row.avg_premium;
}

function formatValue(metric: MetricType, value: number): string {
  if (metric === 'rate' || metric === 'penetration' || metric === 'achievement') return formatPercent(value);
  if (metric === 'avg_premium') return `${Math.round(value)}元`;
  return `${Math.round(value)}件`;
}

function buildBranchSummaryRow(date: string, dateRows: HeatmapPoint[]): HeatmapPoint | null {
  if (dateRows.length === 0) return null;

  const autoCount = dateRows.reduce((sum, row) => sum + row.auto_count, 0);
  const driverCount = dateRows.reduce((sum, row) => sum + row.driver_count, 0);
  const driverPolicyCount = dateRows.reduce((sum, row) => sum + row.driver_policy_count, 0);
  const totalDriverPremium = dateRows.reduce((sum, row) => sum + row.driver_premium, 0);
  const totalPenetrationBasePremium = dateRows.reduce((sum, row) => sum + row.penetration_base_premium, 0);

  const rate = autoCount > 0 ? (driverCount / autoCount) * 100 : 0;
  const avgPremium = driverPolicyCount > 0 ? totalDriverPremium / driverPolicyCount : 0;
  const penetrationRate = totalPenetrationBasePremium > 0
    ? (totalDriverPremium / totalPenetrationBasePremium) * 100
    : null;

  const achievementRows = dateRows.filter((row) => row.achievement_rate !== null);
  let achievementRate: number | null = null;
  if (achievementRows.length > 0) {
    const totalWeight = achievementRows.reduce((sum, row) => sum + Math.max(row.auto_count, 1), 0);
    if (totalWeight > 0) {
      const weightedAchievement = achievementRows.reduce(
        (sum, row) => sum + (row.achievement_rate ?? 0) * Math.max(row.auto_count, 1),
        0,
      );
      achievementRate = weightedAchievement / totalWeight;
    }
  }

  return {
    date,
    org_level_3: BRANCH_SUMMARY_ROW_LABEL,
    auto_count: autoCount,
    driver_count: driverCount,
    driver_policy_count: driverPolicyCount,
    driver_premium: totalDriverPremium,
    penetration_base_premium: totalPenetrationBasePremium,
    rate,
    penetration_rate: penetrationRate,
    avg_premium: avgPremium,
    achievement_rate: achievementRate,
  };
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ==================== Component ====================

export const CrossSellMetricsHeatmap: React.FC<CrossSellMetricsHeatmapProps> = ({
  filters,
  vehicleCategory,
  seatCoverageLevel,
  timePeriod = 'day',
  groupByDimension = 'org_level_3',
  dimensionLabel = '机构',
  drillFilter = [],
  onRowClick,
}) => {
  const { isDataLoaded } = useDataStatus();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [activeMetric, setActiveMetric] = useState<MetricType>('rate');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { rows, loading, error } = useCrossSellHeatmap({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    timePeriod,
    groupByDimension,
    drillFilter,
    enabled: isDataLoaded,
  });

  // 件数类指标的排序数组（供分位数计算）
  const sortedPools = useMemo(() => {
    const pools: Record<'driver_count' | 'auto_count', number[]> = {
      driver_count: [],
      auto_count: [],
    };
    for (const row of rows) {
      if (Number.isFinite(row.driver_count) && row.driver_count > 0) pools.driver_count.push(row.driver_count);
      if (Number.isFinite(row.auto_count) && row.auto_count > 0) pools.auto_count.push(row.auto_count);
    }
    pools.driver_count.sort((a, b) => a - b);
    pools.auto_count.sort((a, b) => a - b);
    return pools;
  }, [rows]);

  const { orgs, dates, matrix, orgCount } = useMemo(() => {
    if (rows.length === 0) {
      return { orgs: [], dates: [], matrix: {} as Record<string, Record<string, HeatmapPoint>>, orgCount: 0 };
    }

    const dateSet = new Set<string>();
    const orgSet = new Set<string>();

    for (const r of rows) {
      if (r.date && r.org_level_3) {
        dateSet.add(r.date);
        orgSet.add(r.org_level_3);
      }
    }

    const matrixMap: Record<string, Record<string, HeatmapPoint>> = {};
    for (const r of rows) {
      if (!matrixMap[r.org_level_3]) matrixMap[r.org_level_3] = {};
      matrixMap[r.org_level_3][r.date] = r;
    }

    const sortedDates = Array.from(dateSet).sort();
    const latestDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : '';

    const sortedOrgs = Array.from(orgSet).sort((a, b) => {
      const aRow = matrixMap[a]?.[latestDate];
      const bRow = matrixMap[b]?.[latestDate];
      const aVal = aRow ? (getCellValue(activeMetric, aRow) ?? -Infinity) : -Infinity;
      const bVal = bRow ? (getCellValue(activeMetric, bRow) ?? -Infinity) : -Infinity;
      return bVal - aVal;
    });

    const branchSummaryLine: Record<string, HeatmapPoint> = {};
    for (const date of sortedDates) {
      const dateRows = sortedOrgs
        .map((org) => matrixMap[org]?.[date])
        .filter((row): row is HeatmapPoint => Boolean(row));
      const summary = buildBranchSummaryRow(date, dateRows);
      if (summary) branchSummaryLine[date] = summary;
    }

    const hasBranchSummary = Object.keys(branchSummaryLine).length > 0;
    if (hasBranchSummary) matrixMap[BRANCH_SUMMARY_ROW_LABEL] = branchSummaryLine;
    const displayOrgs = hasBranchSummary ? [BRANCH_SUMMARY_ROW_LABEL, ...sortedOrgs] : sortedOrgs;

    return { orgs: displayOrgs, dates: sortedDates, matrix: matrixMap, orgCount: sortedOrgs.length };
  }, [rows, activeMetric]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [dates.length, timePeriod]);

  // 颜色解析
  const resolveColor = useCallback(
    (metric: MetricType, value: number | null): ColorEntry & { tier: HeatmapTier } => {
      const scale = isDark ? COLORS_DARK : COLORS_LIGHT;
      if (value === null || !Number.isFinite(value)) {
        return { ...scale.unknown, tier: 'unknown' };
      }
      let tier: HeatmapTier;
      if (metric === 'rate') tier = resolveTierByThresholds(value, RATE_THRESHOLDS);
      else if (metric === 'penetration') tier = resolveTierByThresholds(value, PENETRATION_THRESHOLDS);
      else if (metric === 'achievement') tier = resolveTierByThresholds(value, ACHIEVEMENT_THRESHOLDS);
      else if (metric === 'avg_premium') tier = resolveTierByThresholds(value, AVG_PREMIUM_THRESHOLDS);
      else if (metric === 'driver_count') tier = resolveTierByQuantile(value, sortedPools.driver_count);
      else tier = resolveTierByQuantile(value, sortedPools.auto_count);
      return { ...scale[tier], tier };
    },
    [isDark, sortedPools],
  );



  const formatDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr);
    if (timePeriod === 'day') return `${d.getMonth() + 1}/${d.getDate()}`;
    if (timePeriod === 'week') return `${d.getMonth() + 1}/${d.getDate()}周`;
    if (timePeriod === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (timePeriod === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()}Q${q}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const formatDateFull = (dateStr: string): string => {
    const d = new Date(dateStr);
    if (timePeriod === 'week') {
      const endOfWeek = new Date(d);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 - ${endOfWeek.getMonth() + 1}月${endOfWeek.getDate()}日`;
    }
    if (timePeriod === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (timePeriod === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()}年 第${q}季度`;
    }
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const renderCell = (org: string, date: string, isBranchSummaryRow = false) => {
    const row = matrix[org]?.[date];
    if (!row) {
      return (
        <div
          key={`${org}-${date}`}
          className="h-9 flex items-center justify-center text-xs rounded-md"
          style={{
            backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : '#f3f4f6',
            color: isDark ? '#4b5563' : '#9ca3af',
          }}
        >
          -
        </div>
      );
    }

    const value = getCellValue(activeMetric, row);
    const isRateMetric = activeMetric === 'rate' || activeMetric === 'penetration' || activeMetric === 'achievement';
    const isInactive = isRateMetric && row.auto_count === 0;
    if (value == null || isInactive) {
      return (
        <div
          key={`${org}-${date}`}
          className="h-9 flex items-center justify-center text-[11px] rounded-md"
          style={{
            backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : '#f3f4f6',
            color: isDark ? '#4b5563' : '#9ca3af',
          }}
        >
          -
        </div>
      );
    }

    const { bg, text, tier } = resolveColor(activeMetric, value);
    const displayValue = isRateMetric ? `${value.toFixed(0)}%` : `${Math.round(value)}`;

    return (
      <div
        key={`${org}-${date}`}
        className={cn(
          'h-9 flex items-center justify-center text-[11px] font-medium rounded-md',
          'transition-colors cursor-default',
          textStyles.numeric,
          isBranchSummaryRow ? 'font-semibold' : '',
        )}
        style={{ backgroundColor: bg, color: text }}
        title={`${org} | ${formatDateFull(date)}\n${METRIC_LABELS[activeMetric]}: ${formatValue(activeMetric, value)}\n档位: ${TIER_LABELS[tier]}\n车险件数: ${row.auto_count} | 驾意件数: ${row.driver_count}`}
      >
        {displayValue}
      </div>
    );
  };

  const periodLabel = timePeriod === 'day' ? '天' : timePeriod === 'week' ? '周' : timePeriod === 'month' ? '月' : '季度';

  if (loading) {
    return (
      <div className={cn(cardStyles.base, 'flex items-center justify-center py-8')}>
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mr-3" />
        <span className="text-neutral-400 text-sm">加载热力图数据...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(cardStyles.base, 'bg-danger-bg border border-danger-border rounded-xl p-4')}>
        <p className="text-danger text-sm">热力图加载失败: {error}</p>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className={cn(cardStyles.base, 'text-center py-8 text-neutral-400 text-sm')}>
        暂无热力图数据
      </div>
    );
  }

  // 图例渐变
  const scale = isDark ? COLORS_DARK : COLORS_LIGHT;
  const gradientStops = LEGEND_TIERS.map((tier, i) => {
    const pct = (i / (LEGEND_TIERS.length - 1)) * 100;
    return `${scale[tier].bg} ${pct}%`;
  }).join(', ');

  return (
    <div className={cn(cardStyles.base, 'space-y-3')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tabs
            items={METRIC_TABS}
            activeKey={activeMetric}
            onChange={(key) => setActiveMetric(key as MetricType)}
            variant="pills"
            size="mini"
          />
        </div>
        {/* 发散型渐变图例 */}
        <div className="flex items-center gap-2 text-xs">
          <span className={colorClasses.text.neutralMuted}>偏弱</span>
          <div
            className="h-2.5 rounded-full border"
            style={{
              width: 140,
              background: `linear-gradient(to right, ${gradientStops})`,
              borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            }}
          />
          <span className={colorClasses.text.neutralMuted}>偏强</span>
        </div>
      </div>

      <StickyTableFrame ref={scrollRef} className="-mx-4 px-4 !bg-transparent dark:!bg-transparent !border-none" maxHeight={560}>
        <div
          className="grid gap-0.5"
          style={{
            gridTemplateColumns: `minmax(72px, 120px) repeat(${dates.length}, minmax(40px, 1fr))`,
            minWidth: `${80 + dates.length * 40}px`,
          }}
        >
          <div
            className={cn(
              stickyTableStyles.firstColumnHeader,
              'px-2 py-2 text-left text-xs font-medium',
              colorClasses.text.neutralMuted,
            )}
          >
            {dimensionLabel}
          </div>
          {dates.map((date) => {
            const isWkend = timePeriod === 'day' && isWeekend(date);
            return (
              <div
                key={date}
                className={cn(
                  stickyTableStyles.header,
                  'px-0.5 py-2 text-center text-[11px] font-medium',
                  colorClasses.text.neutralMuted,
                  isWkend ? 'opacity-60' : '',
                )}
                title={formatDateFull(date)}
              >
                {formatDateLabel(date)}
                {isWkend && (
                  <span className="block text-[9px] opacity-50">
                    {new Date(`${date}T00:00:00`).getDay() === 0 ? '日' : '六'}
                  </span>
                )}
              </div>
            );
          })}

          {orgs.map((org) => {
            const isBranchSummaryRow = org === BRANCH_SUMMARY_ROW_LABEL;
            const canRowClick = Boolean(onRowClick) && !isBranchSummaryRow;
            return (
              <React.Fragment key={org}>
                <div
                  className={cn(
                    stickyTableStyles.firstColumn,
                    'z-10',
                    'px-2 py-1.5 text-xs font-medium',
                    colorClasses.text.neutralDark,
                    isBranchSummaryRow ? 'font-semibold' : '',
                    'whitespace-nowrap',
                    canRowClick ? 'cursor-pointer hover:text-primary hover:underline' : 'cursor-default',
                  )}
                  onClick={canRowClick ? () => onRowClick?.(org) : undefined}
                  title={canRowClick ? `点击下钻 ${org}` : undefined}
                >
                  {org}
                </div>
                {dates.map((date) => renderCell(org, date, isBranchSummaryRow))}
              </React.Fragment>
            );
          })}
        </div>
      </StickyTableFrame>

      <div className={cn(textStyles.caption, colorClasses.text.neutralMuted)}>
        鼠标悬停查看详细数据 · 共 {orgCount} 个{dimensionLabel} · {dates.length} {periodLabel}
      </div>
    </div>
  );
};
