import React from 'react';
import { FixedSizeList as List } from 'react-window';
import { TableSkeleton } from '../../shared/ui/Skeleton';
import { TABLE_CSS_CLASSES } from '../../shared/config/chartStyles';

export type TableCellValue = React.ReactNode | string | number | bigint | null | undefined;

export interface Column<T extends object> {
  key: keyof T & string;
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
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

export const VirtualTable = <T extends object>({
  columns,
  data,
  height = 400,
  rowHeight = 44,
  loading,
  virtualized = true,
}: VirtualTableProps<T>) => {
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

  // 获取数字列类名（右对齐列使用等宽数字字体）
  const getNumberClass = (align?: 'left' | 'right' | 'center'): string => {
    return align === 'right' ? 'font-tabular' : '';
  };

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = data[index];
    return (
      <div style={style} className={`flex ${TABLE_CSS_CLASSES.row}`}>
        {columns.map(col => (
          <div
            key={col.key}
            style={{ width: col.width }}
            className={`truncate px-4 py-3 min-w-0 flex-shrink-0 text-sm text-gray-900 ${getAlignClass(col.align)} ${getNumberClass(col.align)}`}
          >
            {(() => {
              const rawValue = (item as any)?.[col.key] as TableCellValue;
              if (typeof rawValue === 'bigint') return rawValue.toString();
              return (rawValue as React.ReactNode) ?? '';
            })()}
          </div>
        ))}
      </div>
    );
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
                className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider truncate min-w-0 ${getAlignClass(col.align)}`}
              >
                {col.header}
              </div>
            ))}
          </div>
          {/* Body */}
          <div className={TABLE_CSS_CLASSES.tbody}>
            {data.map((item, index) => (
              <div key={index} className={`flex ${TABLE_CSS_CLASSES.row} border-b border-gray-200`}>
                {columns.map(col => (
                  <div
                    key={col.key}
                    style={{ width: col.width }}
                    className={`truncate px-4 py-3 min-w-0 flex-shrink-0 text-sm text-gray-900 ${getAlignClass(col.align)} ${getNumberClass(col.align)}`}
                  >
                    {(() => {
                      const rawValue = (item as any)?.[col.key] as TableCellValue;
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
              className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider truncate min-w-0 ${getAlignClass(col.align)}`}
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
        >
          {Row}
        </List>
      </div>
    </div>
  );
};
