/**
 * 驾乘险推介率分析面板（层层下钻版）
 * Cross-Sell Recommendation Rate Analysis Panel (Hierarchical Drilldown)
 *
 * 交互流程：
 * 1. 初始：四川分公司汇总 KPI 卡片 + "选择下钻维度"按钮
 * 2. 选择维度 → 表格展示分组数据，每行可点击继续下钻
 * 3. 面包屑导航支持任意层级回退
 * 4. 车辆类别标签页（非营业客车/货车/摩托车）
 */

import React, { useState, useMemo } from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { Tabs } from '../../shared/ui/Tabs';
import type { TabItem } from '../../shared/ui/Tabs';
import { textStyles, cardStyles, tableStyles, colorClasses, cn } from '../../shared/styles';
import { RBACBreadcrumb } from '../../shared/ui/RBACBreadcrumb';
import { CrossSellSummaryKpiBoard } from './CrossSellSummaryKpiBoard';
import { CrossSellQuadrantView } from './CrossSellQuadrantView';
import { CrossSellTrendChart } from './CrossSellTrendChart';
import type { TrendGranularity } from './hooks/useCrossSellTrend';
import { getRateClassByField } from './crossSellRateStatus';
import type { SeatCoverageLevel, VehicleCategory } from './hooks/useCrossSellTimePeriod';
import { CrossSellTopSalesmanBoard } from './CrossSellTopSalesmanBoard';
import { CrossSellOrgTrendChart } from './CrossSellOrgTrendChart';
import {
  useCrossSellAnalysis,
  DIMENSION_LABELS,
  type CrossSellRow,
  type CrossSellDimension,
} from './hooks/useCrossSellAnalysis';

interface CrossSellAnalysisPanelProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel: SeatCoverageLevel;
  trendGranularity: TrendGranularity;
}

// ============================================================
// 车辆类别标签页
// ============================================================

const VEHICLE_TABS: TabItem[] = [
  { key: 'passenger', label: '非营业客车' },
  { key: 'truck', label: '货车' },
  { key: 'motorcycle', label: '摩托车' },
];

const GRANULARITY_TABS: TabItem[] = [
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
  { key: 'quarterly', label: '季' },
  { key: 'yearly', label: '年' },
];

const SEAT_COVERAGE_TABS: TabItem[] = [
  { key: 'eq_1w', label: '=1万' },
  { key: 'gte_2w', label: '>=2万' },
  { key: 'lt_1w', label: '<1万' },
];

interface CrossSellHeaderControlsProps {
  vehicleCategory: VehicleCategory;
  seatCoverageLevel: SeatCoverageLevel;
  trendGranularity: TrendGranularity;
  onVehicleCategoryChange: (value: VehicleCategory) => void;
  onSeatCoverageLevelChange: (value: SeatCoverageLevel) => void;
  onTrendGranularityChange: (value: TrendGranularity) => void;
}

export const CrossSellHeaderControls: React.FC<CrossSellHeaderControlsProps> = ({
  vehicleCategory,
  seatCoverageLevel,
  trendGranularity,
  onVehicleCategoryChange,
  onSeatCoverageLevelChange,
  onTrendGranularityChange,
}) => (
  <div className="no-export max-w-full overflow-x-auto">
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary-bg text-primary-dark border border-primary-border">
        客户类别
      </span>
      <Tabs
        items={VEHICLE_TABS}
        activeKey={vehicleCategory}
        onChange={(key) => onVehicleCategoryChange(key as VehicleCategory)}
        variant="pills"
        size="small"
      />
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary-bg text-primary-dark border border-primary-border">
        车上责任
      </span>
      <Tabs
        items={SEAT_COVERAGE_TABS}
        activeKey={seatCoverageLevel}
        onChange={(key) => onSeatCoverageLevelChange(key as SeatCoverageLevel)}
        variant="pills"
        size="small"
      />
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary-bg text-primary-dark border border-primary-border">
        时间维度
      </span>
      <Tabs
        items={GRANULARITY_TABS}
        activeKey={trendGranularity}
        onChange={(key) => onTrendGranularityChange(key as TrendGranularity)}
        variant="pills"
        size="small"
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
        className="bg-white rounded-xl shadow-xl p-6 min-w-[320px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-800 mb-4">{title}</h3>
        <div className="grid grid-cols-2 gap-2">
          {available.map((dim) => (
            <button
              key={dim}
              onClick={() => onSelect(dim)}
              className="px-4 py-3 text-sm rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
            >
              {DIMENSION_LABELS[dim]}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="mt-4 w-full px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
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

// 非营业客车/货车的表格列
const TABLE_COLUMNS_FULL: ColumnDef[] = [
  { key: 'group_name', label: '维度', type: 'text' },
  { key: 'total_auto_count', label: '车险件数', type: 'count' },
  { key: 'total_driver_count', label: '驾乘险件数', type: 'count' },
  { key: 'total_rate', label: '综合推介率', type: 'rate' },
  { key: 'danjiao_auto_count', label: '单交-车险', type: 'count' },
  { key: 'danjiao_driver_count', label: '单交-驾乘险', type: 'count' },
  { key: 'danjiao_rate', label: '单交推介率', type: 'rate' },
  { key: 'jiaosan_auto_count', label: '交三-车险', type: 'count' },
  { key: 'jiaosan_driver_count', label: '交三-驾乘险', type: 'count' },
  {
    key: 'jiaosan_rate', label: '交三推介率', type: 'rate',
    getColorClass: (v) => getRateClassByField('jiaosan_rate', v)
  },
  { key: 'zhuquan_auto_count', label: '主全-车险', type: 'count' },
  { key: 'zhuquan_driver_count', label: '主全-驾乘险', type: 'count' },
  {
    key: 'zhuquan_rate', label: '主全推介率', type: 'rate',
    getColorClass: (v) => getRateClassByField('zhuquan_rate', v)
  },
];

// 摩托车的表格列（只有单交相关）
const TABLE_COLUMNS_MOTORCYCLE: ColumnDef[] = [
  { key: 'group_name', label: '维度', type: 'text' },
  { key: 'danjiao_auto_count', label: '车险件数', type: 'count' },
  { key: 'danjiao_driver_count', label: '驾乘险件数', type: 'count' },
  { key: 'danjiao_rate', label: '推介率', type: 'rate' },
];

function formatCell(col: ColumnDef, row: CrossSellRow): string {
  const val = Number(row[col.key] ?? 0);
  if (col.type === 'rate') return formatPercent(val);
  if (col.type === 'count') return formatCount(val);
  return String(row[col.key] ?? '');
}

// ============================================================
// 板块标题
// ============================================================

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className={cn(textStyles.titleSmall, 'font-semibold')}>{title}</h2>
      <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export const CrossSellAnalysisPanel: React.FC<CrossSellAnalysisPanelProps> = ({
  filters,
  vehicleCategory,
  seatCoverageLevel,
  trendGranularity,
}) => {
  const { isDataLoaded } = useDataStatus();
  const [sortKey, setSortKey] = useState<SortKey>('total_auto_count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // 维度选择器状态
  const [showPicker, setShowPicker] = useState(false);
  const [pendingRowValue, setPendingRowValue] = useState<string | null>(null);

  const {
    summary,
    rows,
    drillPath,
    currentGroupBy,
    availableDimensions,
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

  const sortedRows = useMemo(
    () => sortRows(rows, sortKey, sortOrder),
    [rows, sortKey, sortOrder]
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  /** 点击行 → 弹出维度选择器 */
  const handleRowClick = (rowValue: string) => {
    if (availableDimensions.length === 0) return;
    setPendingRowValue(rowValue);
    setShowPicker(true);
  };

  /** 从维度选择器选择维度 */
  const handleDimensionSelect = (dim: CrossSellDimension) => {
    if (pendingRowValue !== null) {
      // 下钻：当前行进入过滤，选择新维度分组
      drillDown(pendingRowValue, dim);
    } else {
      // 首次选择维度
      selectDimension(dim);
    }
    setShowPicker(false);
    setPendingRowValue(null);
  };

  /** 首次下钻（从汇总 → 选择维度） */
  const handleInitialDrill = () => {
    setPendingRowValue(null);
    setShowPicker(true);
  };

  const canDrillDeeper = availableDimensions.length > 0;

  return (
    <div className="space-y-5">
      {/* 板块1：推介率驱动因子环比 */}
      <SectionTitle title="推介率驱动因子环比" />
      <CrossSellSummaryKpiBoard
        vehicleCategory={vehicleCategory}
        seatCoverageLevel={seatCoverageLevel}
        filters={filters}
        timePeriod={mappedTimePeriodForKpi as any}
      />

      {/* 板块2：推介率走势 - 摩托车只显示推介率走势，不显示件均保费 */}
      <SectionTitle title={vehicleCategory === 'motorcycle' ? '推介率走势' : '推介率与件均保费走势'} />
      {vehicleCategory === 'motorcycle' ? (
        // 摩托车：只显示推介率走势
        <CrossSellTrendChart
          vehicleCategory={vehicleCategory}
          seatCoverageLevel={seatCoverageLevel}
          filters={filters}
          granularity={trendGranularity}
          metric="rate"
          title="驾乘险推介率走势"
          requestKey="rate"
          enabled={isDataLoaded}
        />
      ) : (
        // 非营业客车/货车：显示推介率和件均保费走势
        <div className="grid gap-4 lg:grid-cols-2">
          <CrossSellTrendChart
            vehicleCategory={vehicleCategory}
            seatCoverageLevel={seatCoverageLevel}
            filters={filters}
            granularity={trendGranularity}
            metric="rate"
            title="驾乘险推介率走势"
            requestKey="rate"
            enabled={isDataLoaded}
          />
          <CrossSellTrendChart
            vehicleCategory={vehicleCategory}
            seatCoverageLevel={seatCoverageLevel}
            filters={filters}
            granularity={trendGranularity}
            metric="avg_premium"
            title="驾乘险件均保费走势"
            requestKey="avg_premium"
            enabled={isDataLoaded}
          />
        </div>
      )}

      {/* 板块3：下钻分析 */}
      <SectionTitle title="下钻分析" />

      {/* 面包屑导航 */}
      <div className="bg-white p-3 rounded-xl shadow-sm flex flex-wrap items-center justify-between gap-2">
        <RBACBreadcrumb
          drillPath={drillPath}
          currentGroupBy={currentGroupBy}
          onDrillUp={drillUp}
          canGoToTop={canGoToTop}
          dimensionLabels={DIMENSION_LABELS}
        />
        {(drillPath.length > 0 || currentGroupBy) && (
          <button
            onClick={reset}
            className="px-3 py-1.5 text-xs bg-primary-bg text-primary-dark hover:bg-blue-100 rounded-md transition-colors font-medium border border-primary-border"
          >
            重置分析
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-danger-bg border border-danger-border rounded-xl p-4">
          <p className="text-danger font-semibold text-sm">查询失败</p>
          <p className="text-danger text-sm mt-1">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-neutral-400">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
          <span>正在加载数据...</span>
        </div>
      ) : (
        <>
          {/* 初始状态：仅汇总，显示"开始下钻"按钮 */}
          {!currentGroupBy && summary && (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <p className="text-gray-500 mb-4">点击下方按钮选择下钻维度，查看明细分组数据</p>
              <button
                onClick={handleInitialDrill}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                选择下钻维度
              </button>
            </div>
          )}

          {/* 数据表格（有 groupBy 时才显示） */}
          {currentGroupBy && sortedRows.length > 0 && (
            <div className="space-y-4">
              {/* 摩托车不显示四象限视图 */}
              {vehicleCategory !== 'motorcycle' && (
                <CrossSellQuadrantView
                  rows={rows}
                  currentDimensionLabel={DIMENSION_LABELS[currentGroupBy]}
                />
              )}
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="text-sm text-gray-600">
                    按<strong>{DIMENSION_LABELS[currentGroupBy]}</strong>分组
                    {` (${sortedRows.length} 条)`}
                  </span>
                  {canDrillDeeper && (
                    <span className="text-xs text-blue-400">点击行可继续下钻</span>
                  )}
                </div>
                <div className="overflow-x-auto max-h-[600px]">
                  <table className="min-w-full text-sm">
                    <thead className={cn(tableStyles.header, 'sticky top-0 z-10')}>
                      <tr>
                        {(vehicleCategory === 'motorcycle' ? TABLE_COLUMNS_MOTORCYCLE : TABLE_COLUMNS_FULL).map((col) => (
                          <th
                            key={col.key}
                            onClick={() => handleSort(col.key)}
                            className={cn(
                              tableStyles.headerCell,
                              'whitespace-nowrap cursor-pointer select-none hover:bg-neutral-100 transition-colors border-b border-neutral-200'
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
                          key={idx}
                          className={`border-b border-gray-50 transition-colors ${canDrillDeeper
                            ? 'hover:bg-blue-50 cursor-pointer'
                            : 'hover:bg-gray-50/60'
                            }`}
                          onClick={() => canDrillDeeper && handleRowClick(row.group_name)}
                        >
                          {(vehicleCategory === 'motorcycle' ? TABLE_COLUMNS_MOTORCYCLE : TABLE_COLUMNS_FULL).map((col) => (
                            <td
                              key={col.key}
                              className={cn(
                                tableStyles.cell,
                                col.type === 'text'
                                  ? `text-left ${canDrillDeeper ? 'text-blue-600 font-medium' : 'text-gray-900'}`
                                  : col.type === 'rate'
                                    ? cn('text-right', textStyles.numeric,
                                      col.getColorClass
                                        ? col.getColorClass(Number(row[col.key] ?? 0))
                                        : getRateColorByField(col.key, Number(row[col.key] ?? 0)))
                                    : cn('text-right', textStyles.numeric, 'text-neutral-700')
                              )}
                            >
                              {formatCell(col, row)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 空状态 */}
          {!summary && sortedRows.length === 0 && !loading && (
            <div className={cn(cardStyles.spacious, 'text-center text-neutral-400')}>
              暂无数据
            </div>
          )}
        </>
      )}

      {/* 维度选择器弹层 */}
      {showPicker && (
        <DimensionPicker
          available={availableDimensions}
          onSelect={handleDimensionSelect}
          onCancel={() => { setShowPicker(false); setPendingRowValue(null); }}
          title={pendingRowValue ? `"${pendingRowValue}" 下钻到...` : '选择下钻维度'}
        />
      )}

      {/* 机构推介率走势图（标题由子组件动态展示） */}
      <CrossSellOrgTrendChart
        filters={filters}
        vehicleCategory={vehicleCategory}
        seatCoverageLevel={seatCoverageLevel}
        granularity={trendGranularity}
      />

      {/* TOP20 业务员推介率板块 */}
      <SectionTitle title="TOP20 业务员推介率分析" />
      <CrossSellTopSalesmanBoard
        filters={filters}
        vehicleCategory={vehicleCategory}
        seatCoverageLevel={seatCoverageLevel}
        timePeriod={trendGranularity}
      />
    </div>
  );
};
