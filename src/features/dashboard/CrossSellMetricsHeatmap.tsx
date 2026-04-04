/**
 * 交叉销售热力图组件
 * Cross-Sell Metrics Heatmap
 *
 * 显示所有分组最近15个时段的核心指标热力图。
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import type { VehicleCategory, SeatCoverageLevel } from './hooks/useCrossSellTimePeriod';
import {
  useCrossSellHeatmap,
  type HeatmapPoint,
  type CrossSellHeatmapTimePeriod,
  type CrossSellHeatmapDimension,
  type CrossSellHeatmapDrillStep,
} from './hooks/useCrossSellHeatmap';
import {
  getZhuquanStatus,
  getAvgPremiumZhuquanStatus,
  getRateStatusLabel,
  type RateStatus,
} from './crossSellRateStatus';
import { Tabs } from '../../shared/ui/Tabs';
import type { TabItem } from '../../shared/ui/Tabs';
import { StickyTableFrame } from '../../shared/ui';
import { textStyles, cardStyles, colorClasses, stickyTableStyles, cn } from '../../shared/styles';
import { formatPercent } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';

type MetricType = 'rate' | 'penetration' | 'achievement' | 'driver_count' | 'auto_count' | 'avg_premium';
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

function getStatusBgClass(status: RateStatus): string {
  const classes: Record<RateStatus, string> = {
    excellent: colorClasses.bg.successSolid,
    healthy: colorClasses.bg.primarySolid,
    abnormal: colorClasses.bg.warningSolid,
    danger: colorClasses.bg.dangerSolid,
  };
  return classes[status];
}

function getStatusTextClass(status: RateStatus): string {
  const classes: Record<RateStatus, string> = {
    excellent: colorClasses.text.successDark,
    healthy: colorClasses.text.primaryDark,
    abnormal: colorClasses.text.orange,
    danger: colorClasses.text.dangerDark,
  };
  return classes[status];
}

function getAchievementStatus(value: number): RateStatus {
  if (value >= 100) return 'excellent';
  if (value >= 80) return 'healthy';
  if (value >= 60) return 'abnormal';
  return 'danger';
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

function getDynamicStatus(value: number, values: number[]): RateStatus {
  if (values.length === 0) return value > 0 ? 'healthy' : 'danger';
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
  const q2 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)] ?? 0;
  if (value >= q3) return 'excellent';
  if (value >= q2) return 'healthy';
  if (value >= q1) return 'abnormal';
  return 'danger';
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

  const metricValuePool = useMemo(() => {
    const pool: Record<'driver_count' | 'auto_count' | 'avg_premium', number[]> = {
      driver_count: [],
      auto_count: [],
      avg_premium: [],
    };
    rows.forEach((row) => {
      if (Number.isFinite(row.driver_count)) pool.driver_count.push(row.driver_count);
      if (Number.isFinite(row.auto_count)) pool.auto_count.push(row.auto_count);
      if (Number.isFinite(row.avg_premium)) pool.avg_premium.push(row.avg_premium);
    });
    return pool;
  }, [rows]);

  const { orgs, dates, matrix, orgCount } = useMemo(() => {
    if (rows.length === 0) {
      return { orgs: [], dates: [], matrix: {} as Record<string, Record<string, HeatmapPoint>>, orgCount: 0 };
    }

    const dateSet = new Set<string>();
    const orgSet = new Set<string>();

    rows.forEach((r) => {
      if (r.date && r.org_level_3) {
        dateSet.add(r.date);
        orgSet.add(r.org_level_3);
      }
    });

    const matrixMap: Record<string, Record<string, HeatmapPoint>> = {};
    rows.forEach((r) => {
      if (!matrixMap[r.org_level_3]) matrixMap[r.org_level_3] = {};
      matrixMap[r.org_level_3][r.date] = r;
    });

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
    sortedDates.forEach((date) => {
      const dateRows = sortedOrgs
        .map((org) => matrixMap[org]?.[date])
        .filter((row): row is HeatmapPoint => Boolean(row));
      const summary = buildBranchSummaryRow(date, dateRows);
      if (summary) branchSummaryLine[date] = summary;
    });

    const hasBranchSummary = Object.keys(branchSummaryLine).length > 0;
    if (hasBranchSummary) matrixMap[BRANCH_SUMMARY_ROW_LABEL] = branchSummaryLine;
    const displayOrgs = hasBranchSummary ? [BRANCH_SUMMARY_ROW_LABEL, ...sortedOrgs] : sortedOrgs;

    return { orgs: displayOrgs, dates: sortedDates, matrix: matrixMap, orgCount: sortedOrgs.length };
  }, [rows, activeMetric]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [dates.length, timePeriod]);

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

  const resolveStatus = (metric: MetricType, value: number): RateStatus => {
    if (metric === 'rate' || metric === 'penetration') return getZhuquanStatus(value);
    if (metric === 'achievement') return getAchievementStatus(value);
    if (metric === 'avg_premium') return getAvgPremiumZhuquanStatus(value);
    if (metric === 'driver_count') return getDynamicStatus(value, metricValuePool.driver_count);
    return getDynamicStatus(value, metricValuePool.auto_count);
  };

  const renderCell = (org: string, date: string, isBranchSummaryRow = false) => {
    const row = matrix[org]?.[date];
    if (!row) {
      return (
        <div
          key={`${org}-${date}`}
          className={cn(
            'h-9 flex items-center justify-center text-xs',
            'border border-neutral-100 dark:border-neutral-700',
            'bg-neutral-50 dark:bg-neutral-800',
          )}
        >
          -
        </div>
      );
    }

    const value = getCellValue(activeMetric, row);
    if (value == null) {
      return (
        <div
          key={`${org}-${date}`}
          className={cn(
            'h-9 flex items-center justify-center text-[11px]',
            'border border-neutral-100 dark:border-neutral-700',
            'bg-neutral-50 dark:bg-neutral-800 text-neutral-400',
          )}
          title={`${org} | ${formatDateFull(date)}\n${METRIC_LABELS[activeMetric]}: 无数据`}
        >
          -
        </div>
      );
    }

    const status = resolveStatus(activeMetric, value);
    const bgClass = getStatusBgClass(status);
    const textClass = getStatusTextClass(status);

    const displayValue = activeMetric === 'rate' || activeMetric === 'penetration' || activeMetric === 'achievement'
      ? `${value.toFixed(0)}%`
      : `${Math.round(value)}`;

    return (
      <div
        key={`${org}-${date}`}
        className={cn(
          'h-9 flex items-center justify-center text-[11px] font-medium',
          'border border-neutral-100 dark:border-neutral-700',
          bgClass,
          textClass,
          isBranchSummaryRow ? 'font-semibold' : '',
          'transition-colors cursor-default',
        )}
        title={`${org} | ${formatDateFull(date)}\n${METRIC_LABELS[activeMetric]}: ${formatValue(activeMetric, value)}\n状态: ${getRateStatusLabel(status)}\n车险件数: ${row.auto_count} | 驾意件数: ${row.driver_count}`}
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
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className={cn('w-3 h-3 rounded', colorClasses.bg.successSolid)} />
            <span className="text-neutral-500">优秀</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('w-3 h-3 rounded', colorClasses.bg.primarySolid)} />
            <span className="text-neutral-500">健康</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('w-3 h-3 rounded', colorClasses.bg.warningSolid)} />
            <span className="text-neutral-500">异常</span>
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('w-3 h-3 rounded', colorClasses.bg.dangerSolid)} />
            <span className="text-neutral-500">危险</span>
          </span>
        </div>
      </div>

      <StickyTableFrame ref={scrollRef} className="-mx-4 px-4" maxHeight={560}>
        <div
          className="grid gap-0"
          style={{
            gridTemplateColumns: `minmax(72px, 120px) repeat(${dates.length}, minmax(40px, 1fr))`,
            minWidth: `${80 + dates.length * 40}px`,
          }}
        >
          <div
            className={cn(
              stickyTableStyles.firstColumnHeader,
              'px-2 py-2 text-left text-xs font-medium',
              'text-neutral-500 border-b border-neutral-200 dark:border-neutral-700',
            )}
          >
            {dimensionLabel}
          </div>
          {dates.map((date) => (
            <div
              key={date}
              className={cn(
                stickyTableStyles.header,
                'px-0.5 py-2 text-center text-[11px] font-medium',
                'text-neutral-500 border-b border-neutral-200 dark:border-neutral-700',
              )}
              title={formatDateFull(date)}
            >
              {formatDateLabel(date)}
            </div>
          ))}

          {orgs.map((org) => {
            const isBranchSummaryRow = org === BRANCH_SUMMARY_ROW_LABEL;
            const canRowClick = Boolean(onRowClick) && !isBranchSummaryRow;
            return (
              <React.Fragment key={org}>
                <div
                  className={cn(
                    stickyTableStyles.firstColumn,
                    'z-10',
                    'px-2 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300',
                    isBranchSummaryRow ? 'font-semibold' : '',
                    'border-b border-neutral-50 dark:border-neutral-700 whitespace-nowrap',
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

      <div className={cn(textStyles.caption, 'text-neutral-400')}>
        鼠标悬停查看详细数据 · 共 {orgCount} 个{dimensionLabel} · {dates.length} {periodLabel}
      </div>
    </div>
  );
};
