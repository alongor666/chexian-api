/**
 * 车驾意推介率分析面板
 * Cross-Sell Recommendation Rate Analysis Panel
 *
 * 参照 驾意险推介率.html 设计稿实现：
 * - 顶部汇总卡片（12 个 KPI）
 * - 维度下拉选择器
 * - 可排序数据表格（13 列）
 */

import React, { useState, useMemo } from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { useDataStatus } from '../../shared/contexts/DataContext';
import {
  useCrossSellAnalysis,
  DIMENSION_LABELS,
  DRILLDOWN_DIMENSIONS,
  type CrossSellRow,
  type CrossSellDimension,
} from './hooks/useCrossSellAnalysis';

interface CrossSellAnalysisPanelProps {
  filters: AdvancedFilterState;
}

// ============================================================
// 排序相关
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
            className="bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow"
          >
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">{card.label}</div>
            <div className={`text-xl font-semibold font-mono tabular-nums ${
              isRate ? 'text-green-600' : card.label.includes('驾意') ? 'text-blue-600' : 'text-gray-800'
            }`}>
              {isRate ? formatPercent(value) : formatCount(value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

/** 推介率色标 */
function getRateClass(rate: number): string {
  if (rate >= 30) return 'text-green-600 font-medium';
  if (rate >= 15) return 'text-gray-700';
  return 'text-yellow-600 font-medium';
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
  const [sortKey, setSortKey] = useState<SortKey>('total_auto_count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const {
    summary,
    rows,
    dimension,
    setDimension,
    loading,
    error,
  } = useCrossSellAnalysis({
    filters,
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

  const handleDimensionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDimension(e.target.value as CrossSellDimension);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-700 text-white p-6 rounded-xl shadow-md">
        <h1 className="text-xl font-semibold mb-1">驾意险推介率分析</h1>
        <p className="text-sm opacity-90">四川分公司 - 交叉销售数据分析</p>
      </div>

      {/* 维度选择器 */}
      <div className="bg-white p-4 rounded-xl shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-sm text-gray-600">下钻维度：</span>
          <select
            value={dimension}
            onChange={handleDimensionChange}
            className={`px-3 py-2 border rounded-lg text-sm min-w-[180px] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              dimension !== 'org_level_3' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'
            }`}
          >
            {DRILLDOWN_DIMENSIONS.map((dim) => (
              <option key={dim} value={dim}>
                {DIMENSION_LABELS[dim]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-red-800 font-semibold text-sm">查询失败</p>
          <p className="text-red-700 text-sm mt-1">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3" />
          <span>正在加载数据...</span>
        </div>
      ) : (
        <>
          {/* 汇总卡片 */}
          {summary && <SummaryCards data={summary} />}

          {/* 数据表格 */}
          {sortedRows.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[600px]">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      {TABLE_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          className="px-3 py-3 font-semibold text-gray-600 text-xs whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors border-b border-gray-200"
                          style={{ textAlign: col.type === 'text' ? 'left' : 'right' }}
                        >
                          {col.label}
                          <span className={`ml-1 ${sortKey === col.key ? 'text-blue-500' : 'opacity-40'}`}>
                            {sortKey === col.key ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors">
                        {TABLE_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3 py-2.5 ${
                              col.type === 'text'
                                ? 'text-left text-gray-900'
                                : col.type === 'rate'
                                  ? `text-right font-mono tabular-nums ${getRateClass(Number(row[col.key] ?? 0))}`
                                  : 'text-right font-mono tabular-nums text-gray-700'
                            }`}
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
          )}

          {/* 空状态 */}
          {!summary && sortedRows.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-16 text-center text-gray-400">
              暂无数据
            </div>
          )}
        </>
      )}
    </div>
  );
};
