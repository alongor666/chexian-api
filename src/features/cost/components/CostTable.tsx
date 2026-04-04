/**
 * 成本分析通用表格组件
 *
 * 封装表格标题、记录数量、导出按钮等通用逻辑
 */

import { memo, ReactNode } from 'react';
import { VirtualTable, Column } from '../../../widgets/table/VirtualTable';
import { colorClasses, cn } from '../../../shared/styles';

interface CostTableProps<T extends Record<string, unknown>> {
  /** 表格标题 */
  title: string;
  /** 数据源 */
  data: T[];
  /** 列配置 */
  columns: Column<T>[];
  /** 加载状态 */
  loading: boolean;
  /** 导出 CSV 回调 */
  onExportCSV: () => void;
  /** 导出 Excel 回调 */
  onExportExcel: () => void;
  /** 表格高度 */
  height?: number;
  /** 行高 */
  rowHeight?: number;
  /** 自定义操作区域 */
  actions?: ReactNode;
}

/**
 * 通用成本分析表格组件
 */
function CostTableInner<T extends Record<string, unknown>>({
  title,
  data,
  columns,
  loading,
  onExportCSV,
  onExportExcel,
  height = 450,
  rowHeight = 40,
  actions,
}: CostTableProps<T>) {
  const isEmpty = data.length === 0;

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className={cn('px-4 py-3 border-b flex flex-wrap justify-between items-center gap-2', colorClasses.border.neutral)}>
        <h3 className={cn('text-base font-medium', colorClasses.text.neutralBlack)}>{title}</h3>
        <div className="flex items-center gap-3">
          <span className={cn('text-sm', colorClasses.text.neutralLight)}>共 {data.length} 条记录</span>
          <div className="flex gap-2">
            {actions}
            <button
              onClick={onExportCSV}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isEmpty}
              aria-label={`导出${title}为CSV`}
            >
              导出CSV
            </button>
            <button
              onClick={onExportExcel}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isEmpty}
              aria-label={`导出${title}为Excel`}
            >
              导出Excel
            </button>
          </div>
        </div>
      </div>
      <VirtualTable<T>
        columns={columns}
        data={data}
        loading={loading}
        height={height}
        rowHeight={rowHeight}
      />
    </div>
  );
}

// 使用 memo 优化，但保持泛型支持
export const CostTable = memo(CostTableInner) as typeof CostTableInner;
