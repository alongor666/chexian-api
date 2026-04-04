import React, { useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { TableSkeleton } from '../../shared/ui/Skeleton';
import { TABLE_CSS_CLASSES } from '../../shared/config/chartStyles';
import { colorClasses, fontStyles } from '../../shared/styles';

export type TableCellValue = React.ReactNode | string | number | bigint | null | undefined;

export interface Column<T extends object> {
  key: keyof T & string;
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  render?: (value: any, item: T) => React.ReactNode;
}

interface VirtualTableProps<T extends object> {
  columns: Column<T>[];
  data: T[];
  height?: number;
  rowHeight?: number;
  loading?: boolean;
  /** 是否使用虚拟滚动（大数据量时启用） */
  virtualized?: boolean;
}

// itemData shape passed to the module-level VirtualRow renderer
interface VirtualRowItemData {
  rows: any[];
  cols: Column<any>[];
}

/**
 * Module-level row renderer — stable reference prevents react-window from
 * remounting all items every time the parent VirtualTable re-renders.
 */
const VirtualRow = ({
  index,
  style,
  data: itemData,
}: {
  index: number;
  style: React.CSSProperties;
  data: VirtualRowItemData;
}) => {
  const item = itemData.rows[index];
  return (
    <div style={style} className={`flex ${TABLE_CSS_CLASSES.row}`}>
      {itemData.cols.map(col => {
        const alignClass =
          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
        const numberClass = col.align === 'right' ? fontStyles.numeric : '';
        const rawValue = item?.[col.key] as TableCellValue;
        return (
          <div
            key={col.key}
            style={{ width: col.width }}
            className={`truncate px-4 py-3 min-w-0 flex-shrink-0 text-sm ${colorClasses.text.neutralBlack} ${alignClass} ${numberClass}`}
          >
            {col.render
              ? col.render(rawValue, item)
              : typeof rawValue === 'bigint'
                ? rawValue.toString()
                : (rawValue as React.ReactNode) ?? ''}
          </div>
        );
      })}
    </div>
  );
};

export const VirtualTable = <T extends object>({
  columns,
  data,
  height = 400,
  rowHeight = 44,
  loading,
  virtualized = true,
}: VirtualTableProps<T>) => {
  // Must be before early returns — React rules of hooks
  const itemData = useMemo<VirtualRowItemData>(
    () => ({ rows: data as any[], cols: columns as Column<any>[] }),
    [data, columns]
  );

  if (loading) {
    return (
      <TableSkeleton
        rows={Math.floor((height ?? 400) / (rowHeight ?? 44))}
        columns={columns.length || 4}
      />
    );
  }

  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);

  const getAlignClass = (align?: 'left' | 'right' | 'center') => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
  };

  const getNumberClass = (align?: 'left' | 'right' | 'center'): string => {
    return align === 'right' ? fontStyles.numeric : '';
  };

  // 非虚拟化模式（小数据量）
  if (!virtualized || data.length < 50) {
    return (
      <div className={TABLE_CSS_CLASSES.container}>
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div className={`flex ${TABLE_CSS_CLASSES.thead}`}>
            {columns.map(col => (
              <div
                key={col.key}
                style={{ width: col.width }}
                className={`px-4 py-3 text-xs font-medium uppercase tracking-wider truncate min-w-0 ${colorClasses.text.neutralLight} ${getAlignClass(col.align)}`}
              >
                {col.header}
              </div>
            ))}
          </div>
          {/* Body */}
          <div className={TABLE_CSS_CLASSES.tbody}>
            {data.map((item, index) => (
              <div key={index} className={`flex ${TABLE_CSS_CLASSES.row} border-b ${colorClasses.border.neutral}`}>
                {columns.map(col => (
                  <div
                    key={col.key}
                    style={{ width: col.width }}
                    className={`truncate px-4 py-3 min-w-0 flex-shrink-0 text-sm ${colorClasses.text.neutralBlack} ${getAlignClass(col.align)} ${getNumberClass(col.align)}`}
                  >
                    {(() => {
                      const rawValue = (item as any)?.[col.key] as TableCellValue;
                      if (col.render) return col.render(rawValue, item);
                      if (typeof rawValue === 'bigint') return rawValue.toString();
                      return (rawValue as React.ReactNode) ?? '';
                    })()}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 虚拟化模式（大数据量）
  return (
    <div className={TABLE_CSS_CLASSES.container}>
      <div style={{ minWidth: totalWidth }}>
        {/* Header */}
        <div className={`flex ${TABLE_CSS_CLASSES.thead}`}>
          {columns.map(col => (
            <div
              key={col.key}
              style={{ width: col.width }}
              className={`px-4 py-3 text-xs font-medium uppercase tracking-wider truncate min-w-0 ${colorClasses.text.neutralLight} ${getAlignClass(col.align)}`}
            >
              {col.header}
            </div>
          ))}
        </div>
        {/* Body - 虚拟滚动 */}
        <List
          height={height}
          itemCount={data.length}
          itemSize={rowHeight}
          width={totalWidth}
          itemData={itemData}
        >
          {VirtualRow}
        </List>
      </div>
    </div>
  );
};
