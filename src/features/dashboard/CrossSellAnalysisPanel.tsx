/**
 * 车驾意推介率分析面板（层层下钻版）
 * Cross-Sell Recommendation Rate Analysis Panel (Hierarchical Drilldown)
 *
 * 交互流程：
 * 1. 初始：四川分公司汇总 KPI 卡片 + "选择下钻维度"按钮
 * 2. 选择维度 → 表格展示分组数据，每行可点击继续下钻
 * 3. 面包屑导航支持任意层级回退
 * 4. 车辆类别标签页（非营业客车/货车/摩托车）
 * 5. 时间维度汇总表格（推介率/件均保费/保费）
 */

import React, { useState, useMemo } from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { Tabs } from '../../shared/ui/Tabs';
import type { TabItem } from '../../shared/ui/Tabs';
import { textStyles, cardStyles, numericStyles, tableStyles, cn } from '../../shared/styles';
import { CrossSellTimePeriodSummary } from './CrossSellTimePeriodSummary';
import { CrossSellQuadrantView } from './CrossSellQuadrantView';
import type { VehicleCategory } from './hooks/useCrossSellTimePeriod';
import {
  useCrossSellAnalysis,
  DIMENSION_LABELS,
  type CrossSellRow,
  type CrossSellDimension,
} from './hooks/useCrossSellAnalysis';

interface CrossSellAnalysisPanelProps {
  filters: AdvancedFilterState;
}

// ============================================================
// 车辆类别标签页
// ============================================================

const VEHICLE_TABS: TabItem[] = [
  { key: 'passenger', label: '非营业客车' },
  { key: 'truck', label: '货车' },
  { key: 'motorcycle', label: '摩托车' },
];

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
// 汇总卡片
// ============================================================

interface CardDef {
  label: string;
  field: keyof CrossSellRow;
  type: 'count' | 'rate';
}

const SUMMARY_CARDS: CardDef[] = [
  { label: '车险件数', field: 'total_auto_count', type: 'count' },
  { label: '驾意件数', field: 'total_driver_count', type: 'count' },
  { label: '综合推介率', field: 'total_rate', type: 'rate' },
  { label: '单交-车险', field: 'danjiao_auto_count', type: 'count' },
  { label: '单交-驾意', field: 'danjiao_driver_count', type: 'count' },
  { label: '单交推介率', field: 'danjiao_rate', type: 'rate' },
  { label: '交三-车险', field: 'jiaosan_auto_count', type: 'count' },
  { label: '交三-驾意', field: 'jiaosan_driver_count', type: 'count' },
  { label: '交三推介率', field: 'jiaosan_rate', type: 'rate' },
  { label: '主全-车险', field: 'zhuquan_auto_count', type: 'count' },
  { label: '主全-驾意', field: 'zhuquan_driver_count', type: 'count' },
  { label: '主全推介率', field: 'zhuquan_rate', type: 'rate' },
];

function SummaryCards({ data }: { data: CrossSellRow }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {SUMMARY_CARDS.map((card) => {
        const value = Number(data[card.field] ?? 0);
        const isRate = card.type === 'rate';
        return (
          <div
            key={card.field}
            className={cn(cardStyles.interactive, 'p-4')}
          >
            <div className={cn(textStyles.caption, 'uppercase tracking-wide mb-2')}>{card.label}</div>
            <div className={cn(
              numericStyles.kpiPrimary,
              isRate ? 'text-success' : card.label.includes('驾意') ? 'text-primary' : 'text-neutral-800'
            )}>
              {isRate ? formatPercent(value) : formatCount(value)}
            </div>
          </div>
        );
      })}
    </div>
  );
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

import { RBACBreadcrumb } from '../../shared/ui/RBACBreadcrumb';

// ============================================================
// 表格列定义
// ============================================================

interface ColumnDef {
  key: SortKey;
  label: string;
  type: 'text' | 'count' | 'rate';
}

const TABLE_COLUMNS: ColumnDef[] = [
  { key: 'group_name', label: '维度', type: 'text' },
  { key: 'total_auto_count', label: '车险件数', type: 'count' },
  { key: 'total_driver_count', label: '驾意件数', type: 'count' },
  { key: 'total_rate', label: '综合推介率', type: 'rate' },
  { key: 'danjiao_auto_count', label: '单交-车险', type: 'count' },
  { key: 'danjiao_driver_count', label: '单交-驾意', type: 'count' },
  { key: 'danjiao_rate', label: '单交推介率', type: 'rate' },
  { key: 'jiaosan_auto_count', label: '交三-车险', type: 'count' },
  { key: 'jiaosan_driver_count', label: '交三-驾意', type: 'count' },
  { key: 'jiaosan_rate', label: '交三推介率', type: 'rate' },
  { key: 'zhuquan_auto_count', label: '主全-车险', type: 'count' },
  { key: 'zhuquan_driver_count', label: '主全-驾意', type: 'count' },
  { key: 'zhuquan_rate', label: '主全推介率', type: 'rate' },
];

function getRateClass(rate: number): string {
  if (rate >= 30) return 'text-success font-medium';
  if (rate >= 15) return 'text-neutral-700';
  return 'text-warning font-medium';
}

function formatCell(col: ColumnDef, row: CrossSellRow): string {
  const val = Number(row[col.key] ?? 0);
  if (col.type === 'rate') return formatPercent(val);
  if (col.type === 'count') return formatCount(val);
  return String(row[col.key] ?? '');
}

// ============================================================
// 主组件
// ============================================================

export const CrossSellAnalysisPanel: React.FC<CrossSellAnalysisPanelProps> = ({
  filters,
}) => {
  const { isDataLoaded } = useDataStatus();
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('passenger');
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
    enabled: isDataLoaded,
  });

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
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-700 text-white p-6 rounded-xl shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold mb-1">驾意险推介率分析</h1>
            <p className="text-sm opacity-90">四川分公司 - 交叉销售数据分析</p>
          </div>
          {(drillPath.length > 0 || currentGroupBy) && (
            <button
              onClick={reset}
              className="px-3 py-1.5 text-sm bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* 车辆类别标签页 */}
      <Tabs
        items={VEHICLE_TABS}
        activeKey={vehicleCategory}
        onChange={(key) => setVehicleCategory(key as VehicleCategory)}
        variant="pills"
        size="medium"
      />

      {/* 时间维度汇总表格（推介率/件均保费/保费） */}
      <CrossSellTimePeriodSummary
        vehicleCategory={vehicleCategory}
        filters={filters}
      />

      {/* 面包屑导航 */}
      <div className="bg-white p-3 rounded-xl shadow-sm">
        <RBACBreadcrumb
          drillPath={drillPath}
          currentGroupBy={currentGroupBy}
          onDrillUp={drillUp}
          canGoToTop={canGoToTop}
          dimensionLabels={DIMENSION_LABELS}
        />
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
          {/* 汇总卡片 */}
          {summary && <SummaryCards data={summary} />}

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
              <CrossSellQuadrantView
                rows={rows}
                currentDimensionLabel={DIMENSION_LABELS[currentGroupBy]}
              />
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
                        {TABLE_COLUMNS.map((col) => (
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
                          {TABLE_COLUMNS.map((col) => (
                            <td
                              key={col.key}
                              className={cn(
                                tableStyles.cell,
                                col.type === 'text'
                                  ? `text-left ${canDrillDeeper ? 'text-blue-600 font-medium' : 'text-gray-900'}`
                                  : col.type === 'rate'
                                    ? cn('text-right', textStyles.numeric, getRateClass(Number(row[col.key] ?? 0)))
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
    </div>
  );
};
