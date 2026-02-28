import React from 'react';
import { cn, tableStyles, textStyles, colorClasses } from '@/shared/styles';

export interface ComprehensiveColumn<T extends object> {
  key: keyof T;
  title: string;
  align?: 'left' | 'right';
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface ComprehensiveMetricTableProps<T extends object> {
  title: string;
  rows: T[];
  columns: Array<ComprehensiveColumn<T>>;
  loading: boolean;
  emptyText?: string;
}

export function ComprehensiveMetricTable<T extends object>({
  title,
  rows,
  columns,
  loading,
  emptyText = '暂无数据',
}: ComprehensiveMetricTableProps<T>) {
  return (
    <section className={tableStyles.container}>
      <div className={cn('px-4 py-3 border-b', colorClasses.border.neutral)}>
        <h3 className={textStyles.titleSmall}>{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className={tableStyles.header}>
            <tr>
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className={cn(
                    tableStyles.headerCell,
                    column.align === 'right' ? 'text-right' : 'text-left'
                  )}
                >
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className={cn('px-4 py-8 text-center', textStyles.caption)}>
                  加载中...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={cn('px-4 py-8 text-center', textStyles.caption)}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.slice(0, 20).map((row, idx) => (
                <tr key={idx} className={tableStyles.row}>
                  {columns.map((column) => {
                    const value = row[column.key];
                    return (
                      <td
                        key={String(column.key)}
                        className={cn(
                          column.align === 'right' ? tableStyles.cellNumeric : tableStyles.cell
                        )}
                      >
                        {column.render ? column.render(value, row) : String(value ?? '-')}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
