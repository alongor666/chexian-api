/**
 * 增强型虚拟滚动表格
 *
 * 优化百万级数据渲染性能
 * - 虚拟滚动（只渲染可见行）
 * - 动态行高（自动计算）
 * - 粘性表头
 * - 排序/筛选支持
 * - 响应式布局
 * 样式：基于增长分析表格最佳实践（统一样式配置）
 */

import React, { useMemo, useCallback, useRef } from 'react';
import { VariableSizeList as List } from 'react-window';
import { TABLE_CSS_CLASSES } from '../../shared/config/chartStyles';
import { colorClasses } from '../../shared/styles';

type TableCellValue = React.ReactNode | string | number | bigint | null | undefined;
type TableRow = Record<string, TableCellValue>;

export interface Column<T extends TableRow> {
  key: keyof T & string;
  header: string;
  width?: number;
  minWidth?: number;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  formatter?: (value: any, row: T) => React.ReactNode;
}

export interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

interface EnhancedVirtualTableProps<T extends TableRow> {
  columns: Column<T>[];
  data: T[];
  height?: number;
  rowHeight?: number | ((index: number) => number);
  estimatedRowHeight?: number;
  loading?: boolean;
  emptyMessage?: string;
  stickyHeader?: boolean;
  enableSort?: boolean;
  onRowClick?: (row: T, index: number) => void;
  onSortChange?: (sortConfig: SortConfig | null) => void;
  sortConfig?: SortConfig | null;
  className?: string;
  rowClassName?: (row: T, index: number) => string;
  maxVisibleRows?: number; // 最大可见行数（用于大数据集分页）
}

export function EnhancedVirtualTable<T extends TableRow>({
  columns,
  data,
  height = 500,
  rowHeight = 40,
  estimatedRowHeight = 40,
  loading = false,
  emptyMessage = '暂无数据',
  stickyHeader = true,
  enableSort = false,
  onRowClick,
  onSortChange,
  sortConfig,
  className = '',
  rowClassName,
  maxVisibleRows,
}: EnhancedVirtualTableProps<T>) {
  const listRef = useRef<List>(null);
  const tableWidth = useMemo(
    () => columns.reduce((sum, col) => sum + (col.width ?? 120), 0),
    [columns]
  );

  // 动态行高计算器
  const getRowHeight = useCallback((index: number) => {
    if (typeof rowHeight === 'function') {
      return rowHeight(index);
    }
    return rowHeight;
  }, [rowHeight]);

  // 重置滚动（数据变化时）
  const resetScroll = useCallback(() => {
    listRef.current?.scrollToItem(0);
  }, []);

  // 数据变化时重置滚动
  React.useEffect(() => {
    resetScroll();
  }, [data.length, resetScroll]);

  // 排序逻辑
  const sortedAndFilteredData = useMemo(() => {
    if (!sortConfig) return data.slice(0, maxVisibleRows ?? data.length);

    const sorted = [...data].sort((a, b) => {
      const aValue = a[sortConfig.key as keyof T];
      const bValue = b[sortConfig.key as keyof T];

      if (aValue == null) return 1;
      if (bValue == null) return -1;

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      const aStr = String(aValue);
      const bStr = String(bValue);
      const comparison = aStr.localeCompare(bStr);

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });

    return sorted.slice(0, maxVisibleRows ?? sorted.length);
  }, [data, sortConfig, maxVisibleRows]);

  // 处理排序点击
  const handleSort = useCallback(
    (columnKey: string) => {
      if (!enableSort) return;

      let newDirection: 'asc' | 'desc' = 'asc';
      if (sortConfig?.key === columnKey) {
        newDirection = sortConfig.direction === 'asc' ? 'desc' : 'asc';
      }

      const newSortConfig: SortConfig = { key: columnKey, direction: newDirection };
      onSortChange?.(newSortConfig);
    },
    [enableSort, sortConfig, onSortChange]
  );

  // 渲染表头
  const renderHeader = () => {
    return (
      <div
        className={`flex ${TABLE_CSS_CLASSES.thead} ${
          stickyHeader ? 'sticky top-0 z-10' : ''
        }`}
      >
        {columns.map(col => {
          const isSortable = enableSort && col.sortable;
          const isActive = sortConfig?.key === col.key;
          const sortIcon = isActive ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

          return (
            <div
              key={String(col.key)}
              style={{
                width: col.width ?? 120,
                minWidth: col.minWidth ?? 80,
              }}
              className={`px-4 py-3 text-xs font-medium uppercase tracking-wider truncate ${colorClasses.text.neutralLight} ${
                col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
              } ${isSortable ? `cursor-pointer hover:bg-neutral-100 select-none` : ''}`}
              onClick={() => isSortable && handleSort(String(col.key))}
            >
              <div className="flex items-center gap-1">
                <span className="truncate">{col.header}</span>
                {sortIcon && <span className={colorClasses.text.primary}>{sortIcon}</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染单行
  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = sortedAndFilteredData[index];
      if (!item) return null;

      const handleClick = () => {
        onRowClick?.(item, index);
      };

      return (
        <div
          style={style}
          className={`flex ${TABLE_CSS_CLASSES.row} ${
            onRowClick ? 'cursor-pointer' : ''
          } ${rowClassName?.(item, index) ?? ''}`}
          onClick={handleClick}
        >
          {columns.map(col => {
            const value = item[col.key];
            const formattedValueRaw = col.formatter ? col.formatter(value, item) : value ?? '';
            const formattedValue =
              typeof formattedValueRaw === 'bigint'
                ? formattedValueRaw.toString()
                : (formattedValueRaw as React.ReactNode);

            return (
              <div
                key={String(col.key)}
                style={{
                  width: col.width ?? 120,
                  minWidth: col.minWidth ?? 80,
                }}
                className={`truncate px-4 py-3 min-w-0 flex-shrink-0 text-sm ${colorClasses.text.neutralBlack} ${
                  col.align === 'right' ? 'text-right font-mono' : col.align === 'center' ? 'text-center' : 'text-left'
                }`}
              >
                {formattedValue}
              </div>
            );
          })}
        </div>
      );
    },
    [sortedAndFilteredData, columns, onRowClick, rowClassName]
  );

  // Loading状态
  if (loading) {
    return (
      <div
        className={`${TABLE_CSS_CLASSES.container} bg-white ${className}`}
        style={{ height }}
      >
        <div className={`h-full flex items-center justify-center ${colorClasses.text.neutralLight}`}>
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        </div>
      </div>
    );
  }

  // 空数据状态
  if (sortedAndFilteredData.length === 0) {
    return (
      <div
        className={`${TABLE_CSS_CLASSES.container} bg-white ${className}`}
        style={{ height }}
      >
        <div className={TABLE_CSS_CLASSES.emptyCell}>
          {emptyMessage}
        </div>
      </div>
    );
  }

  // 数据计数信息
  const displayCount = maxVisibleRows
    ? Math.min(sortedAndFilteredData.length, maxVisibleRows)
    : sortedAndFilteredData.length;
  const totalCount = data.length;

  return (
    <div className={`${TABLE_CSS_CLASSES.container} bg-white ${className}`}>
      {/* 数据统计栏 */}
      <div className={`px-4 py-2 border-b text-xs flex justify-between items-center ${colorClasses.bg.neutral} ${colorClasses.border.neutral} ${colorClasses.text.neutralLight}`}>
        <span>
          显示 {displayCount} / {totalCount} 条
          {maxVisibleRows && totalCount > maxVisibleRows && ` （最多显示 ${maxVisibleRows} 条）`}
        </span>
        {sortConfig && (
          <span>
            排序：{columns.find(c => c.key === sortConfig.key)?.header}{' '}
            {sortConfig.direction === 'asc' ? '升序' : '降序'}
          </span>
        )}
      </div>

      {/* 表格主体 */}
      <div style={{ minWidth: tableWidth }}>
        {renderHeader()}
        <List
          ref={listRef}
          height={height - 40} // 减去统计栏高度
          itemCount={displayCount}
          itemSize={getRowHeight}
          estimatedItemSize={estimatedRowHeight}
          width="100%"
        >
          {Row}
        </List>
      </div>
    </div>
  );
}
