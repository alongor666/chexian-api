/**
 * 可排序表格组件
 *
 * 通用的可排序表格，支持：
 * - 点击表头排序（升序/降序切换）
 * - 自定义列格式化
 * - 统一样式（基于增长分析最佳实践）
 * - 无独立滚动条，使用主页面滚动
 */

import { TableSkeleton } from '../../../shared/ui/Skeleton';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';
import { colorClasses } from '../../../shared/styles';
import type { SortState } from '../types/tableTypes';

interface Column<T> {
  /** 列键名 */
  key: keyof T;
  /** 表头文本 */
  header: string;
  /** 列宽度 */
  width?: number;
  /** 格式化函数 */
  format?: (value: T[keyof T], row: T) => string;
  /** 是否可排序（默认 true） */
  sortable?: boolean;
  /** 文本对齐方式（默认 left） */
  align?: 'left' | 'center' | 'right';
}

interface SortableTableProps<T> {
  /** 数据源 */
  data: T[];
  /** 列定义 */
  columns: Column<T>[];
  /** 当前排序状态 */
  sortState: SortState;
  /** 排序状态变更回调 */
  onSortChange: (sort: SortState) => void;
  /** 行键值获取函数 */
  rowKey: (row: T, index: number) => string;
  /** 最大高度（固定表头） */
  maxHeight?: number;
  /** 加载状态 */
  loading?: boolean;
  /** 空数据提示 */
  emptyText?: string;
}

/**
 * 可排序表格组件
 */
export function SortableTable<T extends Record<string, unknown>>({
  data,
  columns,
  sortState,
  onSortChange,
  rowKey,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  maxHeight: _maxHeight = 400, // 保留参数兼容性，但不再使用（使用主页面滚动）
  loading = false,
  emptyText = '暂无数据',
}: SortableTableProps<T>) {
  /**
   * 处理表头点击排序
   */
  const handleHeaderClick = (column: Column<T>) => {
    if (column.sortable === false) return;

    const columnKey = String(column.key);
    const newDirection =
      sortState.column === columnKey && sortState.direction === 'desc' ? 'asc' : 'desc';

    onSortChange({
      column: columnKey,
      direction: newDirection,
    });
  };

  /**
   * 获取排序图标
   */
  const getSortIcon = (column: Column<T>) => {
    if (column.sortable === false) return null;

    const columnKey = String(column.key);
    if (sortState.column !== columnKey) {
      return (
        <span className={`ml-1 ${colorClasses.text.neutralMuted} group-hover:text-neutral-400`}>
          ⇅
        </span>
      );
    }

    return (
      <span className={`ml-1 ${colorClasses.text.primary}`}>
        {sortState.direction === 'desc' ? '↓' : '↑'}
      </span>
    );
  };

  if (loading) {
    return <TableSkeleton rows={5} columns={columns.length || 4} />;
  }

  // 根据对齐方式获取表头样式
  const getHeaderCellClass = (align?: 'left' | 'center' | 'right') => {
    const base = align === 'right' ? TABLE_CSS_CLASSES.headerCellRight : TABLE_CSS_CLASSES.headerCell;
    return align === 'center' ? base.replace('text-left', 'text-center').replace('text-right', 'text-center') : base;
  };

  // 根据对齐方式获取单元格样式
  const getCellClass = (align?: 'left' | 'center' | 'right') => {
    if (align === 'right') return TABLE_CSS_CLASSES.cellRight;
    if (align === 'center') return TABLE_CSS_CLASSES.cell + ' text-center';
    return TABLE_CSS_CLASSES.cell;
  };

  return (
    <div className={TABLE_CSS_CLASSES.container}>
      <table className={TABLE_CSS_CLASSES.table}>
        <thead className={TABLE_CSS_CLASSES.thead}>
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                className={`${getHeaderCellClass(column.align)} ${column.sortable !== false ? 'cursor-pointer hover:bg-neutral-100 select-none group' : ''}`}
                style={{ width: column.width ? `${column.width}px` : undefined }}
                onClick={() => handleHeaderClick(column)}
              >
                <span className="inline-flex items-center">
                  {column.header}
                  {getSortIcon(column)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={TABLE_CSS_CLASSES.tbody}>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={TABLE_CSS_CLASSES.emptyCell}>
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr key={rowKey(row, index)} className={TABLE_CSS_CLASSES.row}>
                {columns.map((column) => (
                  <td key={String(column.key)} className={getCellClass(column.align)}>
                    {column.format
                      ? column.format(row[column.key], row)
                      : String(row[column.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
