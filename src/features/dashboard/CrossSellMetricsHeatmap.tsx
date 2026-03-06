/**
 * 交叉销售热力图组件
 * Cross-Sell Metrics Heatmap
 *
 * 显示所有三级机构最近14个时段的推介率/件均保费/计划达成率热力图
 * 颜色映射：优秀(绿)/健康(蓝)/异常(橙)/危险(红)
 */

import React, { useState, useMemo } from 'react';
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
import { textStyles, cardStyles, colorClasses, cn } from '../../shared/styles';
import { formatPercent } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';

type MetricType = 'rate' | 'avg_premium' | 'achievement';

const METRIC_TABS: TabItem[] = [
  { key: 'rate', label: '推介率' },
  { key: 'avg_premium', label: '件均保费' },
  { key: 'achievement', label: '计划达成率' },
];

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

// 状态 → 背景色 class 映射
function getStatusBgClass(status: RateStatus): string {
  const classes: Record<RateStatus, string> = {
    excellent: colorClasses.bg.successSolid,
    healthy: colorClasses.bg.primarySolid,
    abnormal: colorClasses.bg.warningSolid,
    danger: colorClasses.bg.dangerSolid,
  };
  return classes[status];
}

// 状态 → 文字色 class 映射
function getStatusTextClass(status: RateStatus): string {
  const classes: Record<RateStatus, string> = {
    excellent: 'text-green-800 dark:text-green-200',
    healthy: 'text-blue-800 dark:text-blue-200',
    abnormal: 'text-orange-800 dark:text-orange-200',
    danger: 'text-red-800 dark:text-red-200',
  };
  return classes[status];
}

// 达成率 → 状态映射
function getAchievementStatus(value: number): RateStatus {
  if (value >= 100) return 'excellent';
  if (value >= 80) return 'healthy';
  if (value >= 60) return 'abnormal';
  return 'danger';
}

// 根据指标类型和值获取状态
function getStatus(metric: MetricType, value: number): RateStatus {
  if (metric === 'rate') return getZhuquanStatus(value);
  if (metric === 'achievement') return getAchievementStatus(value);
  return getAvgPremiumZhuquanStatus(value);
}

// 格式化显示值
function formatValue(metric: MetricType, value: number): string {
  if (metric === 'rate') return formatPercent(value);
  if (metric === 'achievement') return `${value.toFixed(1)}%`;
  return `${Math.round(value)}元`;
}

// 获取单元格数值
function getCellValue(metric: MetricType, row: HeatmapPoint): number | null {
  if (metric === 'rate') return row.rate;
  if (metric === 'avg_premium') return row.avg_premium;
  return row.achievement_rate;
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

  const { rows, loading, error } = useCrossSellHeatmap({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    timePeriod,
    groupByDimension,
    drillFilter,
    enabled: isDataLoaded,
  });

  // 将数据转换为矩阵格式：orgs × dates
  const { orgs, dates, matrix } = useMemo(() => {
    if (rows.length === 0) {
      return { orgs: [], dates: [], matrix: {} };
    }

    // 提取所有唯一日期和机构
    const dateSet = new Set<string>();
    const orgSet = new Set<string>();

    rows.forEach((r) => {
      if (r.date && r.org_level_3) {
        dateSet.add(r.date);
        orgSet.add(r.org_level_3);
      }
    });

    // 构建矩阵：matrix[org][date] = row
    const matrixMap: Record<string, Record<string, HeatmapPoint>> = {};
    rows.forEach((r) => {
      if (!matrixMap[r.org_level_3]) {
        matrixMap[r.org_level_3] = {};
      }
      matrixMap[r.org_level_3][r.date] = r;
    });

    // 按日期排序（升序，最早的在前）
    const sortedDates = Array.from(dateSet).sort();
    const latestDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : '';

    // 按当前指标的最新一列值降序排序，空值排最后
    const sortedOrgs = Array.from(orgSet).sort((a, b) => {
      const aRow = matrixMap[a]?.[latestDate];
      const bRow = matrixMap[b]?.[latestDate];
      const aVal = aRow ? (getCellValue(activeMetric, aRow) ?? -Infinity) : -Infinity;
      const bVal = bRow ? (getCellValue(activeMetric, bRow) ?? -Infinity) : -Infinity;
      return bVal - aVal;
    });

    return { orgs: sortedOrgs, dates: sortedDates, matrix: matrixMap };
  }, [rows, activeMetric]);

  // 格式化日期显示（根据时间粒度）
  const formatDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr);
    if (timePeriod === 'day') {
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    if (timePeriod === 'week') {
      return `${d.getMonth() + 1}/${d.getDate()}周`;
    }
    if (timePeriod === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (timePeriod === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()}Q${q}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // 格式化日期 tooltip（完整）
  const formatDateFull = (dateStr: string): string => {
    const d = new Date(dateStr);
    if (timePeriod === 'week') {
      const endOfWeek = new Date(d);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 - ${endOfWeek.getMonth() + 1}月${endOfWeek.getDate()}日`;
    }
    if (timePeriod === 'month') {
      return `${d.getFullYear()}年${d.getMonth() + 1}月`;
    }
    if (timePeriod === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()}年 第${q}季度`;
    }
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  // 渲染单元格
  const renderCell = (org: string, date: string) => {
    const row = matrix[org]?.[date];
    if (!row) {
      return (
        <div
          key={`${org}-${date}`}
          className={cn(
            'h-9 flex items-center justify-center text-xs',
            'border border-neutral-100 dark:border-neutral-700',
            'bg-neutral-50 dark:bg-neutral-800'
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
            'bg-neutral-50 dark:bg-neutral-800 text-neutral-400'
          )}
          title={`${org} | ${formatDateFull(date)}\n计划达成率: 无计划`}
        >
          -
        </div>
      );
    }

    const status = getStatus(activeMetric, value);
    const bgClass = getStatusBgClass(status);
    const textClass = getStatusTextClass(status);
    const hasData = activeMetric === 'achievement' ? true : row.auto_count > 0;

    const displayValue = activeMetric === 'rate'
      ? `${value.toFixed(0)}%`
      : activeMetric === 'achievement'
        ? `${value.toFixed(0)}%`
        : Math.round(value);

    return (
      <div
        key={`${org}-${date}`}
        className={cn(
          'h-9 flex items-center justify-center text-[11px] font-medium',
          'border border-neutral-100 dark:border-neutral-700',
          hasData ? bgClass : 'bg-neutral-50 dark:bg-neutral-800',
          hasData ? textClass : 'text-neutral-400',
          'transition-colors cursor-default'
        )}
        title={`${org} | ${formatDateFull(date)}\n${activeMetric === 'rate' ? '推介率' : activeMetric === 'achievement' ? '计划达成率' : '件均保费'}: ${formatValue(activeMetric, value)}\n状态: ${getRateStatusLabel(status)}\n车险件数: ${row.auto_count} | 驾意件数: ${row.driver_count}`}
      >
        {hasData ? displayValue : '-'}
      </div>
    );
  };

  // 时段标签
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
      {/* 标题行：指标切换标签 */}
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
        {/* 图例 */}
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

      {/* 热力图表格 - 使用 CSS Grid 实现自适应 */}
      <div className="overflow-x-auto -mx-4 px-4">
        {/* Grid 容器：第一列固定宽度（机构名），其余列等分 */}
        <div
          className="grid gap-0"
          style={{
            gridTemplateColumns: `minmax(70px, auto) repeat(${dates.length}, minmax(36px, 1fr))`,
            minWidth: `${70 + dates.length * 36}px`
          }}
        >
          {/* 表头：机构 + 日期 */}
          <div
            className={cn(
              'sticky left-0 z-20 bg-white dark:bg-neutral-800',
              'px-2 py-2 text-left text-xs font-medium',
              'text-neutral-500 border-b border-neutral-200 dark:border-neutral-700'
            )}
          >
            {dimensionLabel}
          </div>
          {dates.map((date) => (
            <div
              key={date}
              className={cn(
                'px-0.5 py-2 text-center text-[11px] font-medium',
                'text-neutral-500 border-b border-neutral-200 dark:border-neutral-700'
              )}
              title={formatDateFull(date)}
            >
              {formatDateLabel(date)}
            </div>
          ))}

          {/* 数据行 */}
          {orgs.map((org) => (
            <React.Fragment key={org}>
              {/* 机构名 */}
              <div
                className={cn(
                  'sticky left-0 z-10 bg-white dark:bg-neutral-800',
                  'px-2 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300',
                  'border-b border-neutral-50 dark:border-neutral-700 whitespace-nowrap',
                  onRowClick ? 'cursor-pointer hover:text-primary hover:underline' : 'cursor-default'
                )}
                onClick={onRowClick ? () => onRowClick(org) : undefined}
                title={onRowClick ? `点击下钻 ${org}` : undefined}
              >
                {org}
              </div>
              {/* 数据单元格 */}
              {dates.map((date) => renderCell(org, date))}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* 底部提示 */}
      <div className={cn(textStyles.caption, 'text-neutral-400')}>
        鼠标悬停查看详细数据 · 共 {orgs.length} 个{dimensionLabel} · {dates.length} {periodLabel}
      </div>
    </div>
  );
};
