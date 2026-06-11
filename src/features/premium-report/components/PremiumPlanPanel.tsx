/**
 * 保费达成下钻面板
 *
 * 包含：
 * - 面包屑导航（点击可返回上层）
 * - KPI 卡片（计划保费、实际保费、达成率、业务员数）
 * - 达成率分布（横向柱状图）
 * - 下钻数据表格（点击行名称可下钻到下一层）
 */

import React, { useEffect, useMemo } from 'react';
import { usePremiumPlan } from '../hooks/usePremiumPlan';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';
import { TableSkeleton } from '../../../shared/ui/Skeleton';
import { cn, numericStyles, colorClasses, fontStyles } from '../../../shared/styles';
import { formatCount, formatPercent, formatSalesmanName, formatWanDirect } from '../../../shared/utils/formatters';
import type { PlanDrilldownRow, PlanKpiData, PlanDistributionRow, SortState } from '../types/premiumReport';

/** 格式化达成率（百分比，已是 0-100 范围） */
const formatRateValue = (value: number | null): string => {
  return formatPercent(value);
};

/** 达成率颜色 */
const getRateColor = (rate: number | null): string => {
  if (rate === null) return colorClasses.text.neutralMuted;
  if (rate >= 100) return colorClasses.text.success;
  if (rate >= 80) return colorClasses.text.primary;
  if (rate >= 50) return colorClasses.text.warning;
  return colorClasses.text.danger;
};

/** 分布柱状图颜色 */
const getDistBarColor = (range: string): string => {
  if (range.includes('≥100') || range.includes('100-')) return 'bg-success';
  if (range.includes('80-')) return 'bg-primary';
  if (range.includes('50-')) return 'bg-warning';
  return 'bg-danger';
};

// ============================================
// KPI 卡片组件
// ============================================

const KpiCard: React.FC<{
  title: string;
  value: string;
  subtitle?: string;
  colorClass?: string;
}> = ({ title, value, subtitle, colorClass = colorClasses.text.neutralBlack }) => (
  <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 shadow-sm">
    <p className="text-sm text-neutral-500 dark:text-neutral-400 font-medium mb-2">{title}</p>
    <p className={cn(numericStyles.kpiPrimary, colorClass)}>{value}</p>
    {subtitle && <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{subtitle}</p>}
  </div>
);

const KpiCards: React.FC<{ data: PlanKpiData }> = ({ data }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <KpiCard
      title="车险计划保费"
      value={`${formatWanDirect(data.total_plan_vehicle)}万`}
      subtitle="年度计划"
    />
    <KpiCard
      title="车险实际保费"
      value={`${formatWanDirect(data.total_actual_vehicle)}万`}
      subtitle="当前实际"
    />
    <KpiCard
      title="车险达成率"
      value={formatRateValue(data.avg_rate_vehicle)}
      colorClass={getRateColor(data.avg_rate_vehicle)}
      subtitle="年初累计 ÷（年计划 × 时间进度），进度按数据内最新签单日计"
    />
    <KpiCard
      title="业务员数"
      value={formatCount(data.total_salesman_count)}
      subtitle="参与人数"
    />
  </div>
);

// ============================================
// 达成率分布组件
// ============================================

const DistributionChart: React.FC<{ data: PlanDistributionRow[] }> = ({ data }) => {
  if (data.length === 0) return null;
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className={`bg-white dark:bg-neutral-800 rounded-lg border p-4 ${colorClasses.border.neutral}`}>
      <h4 className={`text-sm font-semibold mb-3 ${colorClasses.text.neutral}`}>达成率分布</h4>
      <div className="space-y-2">
        {data.map((row) => (
          <div key={row.rate_range} className="flex items-center gap-3">
            <span className={`text-xs w-20 text-right shrink-0 ${colorClasses.text.neutralMuted}`}>
              {row.rate_range}
            </span>
            <div className={`flex-1 h-5 rounded overflow-hidden ${colorClasses.bg.neutral}`}>
              <div
                className={`h-full rounded ${getDistBarColor(row.rate_range)} transition-all`}
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </div>
            <span className={cn(numericStyles.captionValue, 'text-neutral-600 w-16 text-right shrink-0')}>
              {formatCount(row.count)}人 ({formatPercent(row.percentage)})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// 面包屑导航
// ============================================

const Breadcrumb: React.FC<{
  path: { level: string; label: string; value?: string }[];
  onNavigate: (index: number) => void;
}> = ({ path, onNavigate }) => (
  <nav className="flex items-center flex-wrap gap-1 text-sm">
    {path.map((step, idx) => {
      const isLast = idx === path.length - 1;
      return (
        <span key={idx} className="flex items-center">
          {idx > 0 && <span className={`${colorClasses.text.neutralMuted} mx-1`}>/</span>}
          {isLast ? (
            <span className={`${colorClasses.text.neutral} font-medium`}>{step.label}</span>
          ) : (
            <button
              onClick={() => onNavigate(idx)}
              className={`${colorClasses.text.primary} hover:underline`}
            >
              {step.label}
            </button>
          )}
        </span>
      );
    })}
  </nav>
);

// ============================================
// 下钻数据表格
// ============================================

const DrilldownTable: React.FC<{
  data: PlanDrilldownRow[];
  sortState: SortState;
  onSortChange: (sort: SortState) => void;
  onRowClick: (groupName: string) => void;
  canDrill: boolean;
  displaySalesmanName: boolean;
  loading: boolean;
}> = ({ data, sortState, onSortChange, onRowClick, canDrill, displaySalesmanName, loading }) => {
  if (loading) {
    return <TableSkeleton rows={6} columns={8} />;
  }

  const columns: {
    key: string;
    header: string;
    align: 'left' | 'right';
    format: (row: PlanDrilldownRow) => string;
    sortable: boolean;
  }[] = [
    {
      key: 'group_name',
      header: '名称',
      align: 'left',
      format: (r) => (displaySalesmanName ? formatSalesmanName(r.group_name) : r.group_name),
      sortable: true,
    },
    { key: 'plan_vehicle', header: '计划保费(万)', align: 'right', format: (r) => formatWanDirect(r.plan_vehicle), sortable: true },
    { key: 'actual_vehicle', header: '实际保费(万)', align: 'right', format: (r) => formatWanDirect(r.actual_vehicle), sortable: true },
    { key: 'rate_vehicle', header: '达成率', align: 'right', format: (r) => formatRateValue(r.rate_vehicle), sortable: true },
    { key: 'prev_year_premium', header: '上年保费(万)', align: 'right', format: (r) => formatWanDirect(r.prev_year_premium), sortable: true },
    { key: 'yoy_growth_rate', header: '同比增长', align: 'right', format: (r) => formatRateValue(r.yoy_growth_rate), sortable: true },
    { key: 'salesman_count', header: '业务员数', align: 'right', format: (r) => formatCount(r.salesman_count), sortable: true },
    { key: 'plan_growth_rate', header: '计划增长率', align: 'right', format: (r) => formatRateValue(r.plan_growth_rate), sortable: true },
  ];

  const handleHeaderClick = (key: string) => {
    const newDirection =
      sortState.column === key && sortState.direction === 'desc' ? 'asc' : 'desc';
    onSortChange({ column: key, direction: newDirection });
  };

  const getSortIcon = (key: string) => {
    if (sortState.column !== key) {
      return <span className={`ml-1 ${colorClasses.text.neutralMuted}`}>⇅</span>;
    }
    return (
      <span className={`ml-1 ${colorClasses.text.primary}`}>
        {sortState.direction === 'desc' ? '↓' : '↑'}
      </span>
    );
  };

  return (
    <div className={TABLE_CSS_CLASSES.container}>
      <table className={TABLE_CSS_CLASSES.table}>
        <thead className={TABLE_CSS_CLASSES.thead}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.align === 'right' ? TABLE_CSS_CLASSES.headerCellRight : TABLE_CSS_CLASSES.headerCell} ${col.sortable ? 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 select-none group' : ''}`}
                onClick={() => col.sortable && handleHeaderClick(col.key)}
              >
                <span className="inline-flex items-center">
                  {col.header}
                  {col.sortable && getSortIcon(col.key)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={TABLE_CSS_CLASSES.tbody}>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={TABLE_CSS_CLASSES.emptyCell}>
                暂无数据
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr key={row.group_name || idx} className={TABLE_CSS_CLASSES.row}>
                {columns.map((col) => {
                  const isNameCol = col.key === 'group_name';
                  const isRateCol = col.key === 'rate_vehicle' || col.key === 'yoy_growth_rate' || col.key === 'plan_growth_rate';
                  const cellClass = col.align === 'right' ? TABLE_CSS_CLASSES.cellRight : TABLE_CSS_CLASSES.cell;

                  return (
                    <td key={col.key} className={cellClass}>
                      {isNameCol && canDrill ? (
                        <button
                          onClick={() => onRowClick(row.group_name)}
                          className={`${colorClasses.text.primary} hover:underline font-medium`}
                        >
                          {col.format(row)}
                        </button>
                      ) : (
                        <span className={cn(fontStyles.numeric, isRateCol ? getRateColor(row[col.key] as number | null) : '')}>
                          {col.format(row)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

// ============================================
// 主面板
// ============================================

/** 可下钻的层级（最底两层不能再下钻） */
const DRILLABLE_LEVELS = new Set(['company', 'org', 'team', 'salesman']);

export const PremiumPlanPanel: React.FC = () => {
  const { filters } = useGlobalFilters();
  const {
    drilldownData,
    kpiData,
    distributionData,
    drillPath,
    currentLevel,
    sortState,
    setSortState,
    isLoading,
    error,
    loadInitial,
    drillDown,
    drillUp,
    resetDrill,
  } = usePremiumPlan();

  const planYear = useMemo(() => filters.analysis_year || 2026, [filters.analysis_year]);

  // 初始加载
  useEffect(() => {
    loadInitial(planYear);
  }, [planYear, loadInitial]);

  // 面包屑导航回退
  const handleBreadcrumbNavigate = async (targetIndex: number) => {
    if (targetIndex === 0) {
      await resetDrill();
    } else {
      // 需要逐步回退到目标层级
      const stepsBack = drillPath.length - 1 - targetIndex;
      for (let i = 0; i < stepsBack; i++) {
        await drillUp();
      }
    }
  };

  const canDrill = DRILLABLE_LEVELS.has(currentLevel);

  return (
    <div className="space-y-4">
      {/* 错误提示 */}
      {error && (
        <div className={`${colorClasses.bg.danger} border rounded-lg p-4 ${colorClasses.text.danger} ${colorClasses.border.danger}`}>
          <p className="font-medium">加载失败</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* 面包屑 */}
      <div className={`bg-white dark:bg-neutral-800 rounded-lg border px-4 py-3 flex items-center justify-between ${colorClasses.border.neutral}`}>
        <Breadcrumb path={drillPath} onNavigate={handleBreadcrumbNavigate} />
        {drillPath.length > 1 && (
          <button
            onClick={drillUp}
            className={`text-sm ${colorClasses.text.primary} hover:underline ml-4 shrink-0`}
          >
            返回上级
          </button>
        )}
      </div>

      {/* KPI 卡片 */}
      {kpiData && <KpiCards data={kpiData} />}

      {/* 达成率分布 */}
      <DistributionChart data={distributionData} />

      {/* 下钻表格 */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow">
        <div className={`px-4 py-3 border-b ${colorClasses.border.neutral}`}>
          <h3 className={`text-lg font-semibold ${colorClasses.text.neutralBlack}`}>
            保费达成明细
          </h3>
          <p className={`text-sm mt-1 ${colorClasses.text.neutralMuted}`}>
            {canDrill ? '点击名称可下钻到下一层级' : '已到最底层'}
            {' '}| 共 {drilldownData.length} 条记录
          </p>
        </div>
        <div className="p-4">
          <DrilldownTable
            data={drilldownData}
            sortState={sortState}
            onSortChange={setSortState}
            onRowClick={drillDown}
            canDrill={canDrill}
            displaySalesmanName={currentLevel === 'team'}
            loading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};
