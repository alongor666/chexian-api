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
  /** 默认排序字段。值为数字时按从小到大；sortOrder='desc' 时从大到小 */
  sortKey?: keyof T;
  /** 排序方向，默认 'asc' */
  sortOrder?: 'asc' | 'desc';
  /** 汇总行名称匹配关键字（含该关键字的行始终置顶） */
  summaryKeywords?: string[];
}

export function ComprehensiveMetricTable<T extends object>({
  title,
  rows,
  columns,
  loading,
  emptyText = '暂无数据',
  sortKey,
  sortOrder = 'asc',
  summaryKeywords = ['合计', '汇总', '四川分公司', '整体'],
}: ComprehensiveMetricTableProps<T>) {
  const sortedRows = React.useMemo(() => {
    if (!sortKey) return rows;
    const keywords = summaryKeywords;
    return rows.slice().sort((a, b) => {
      // 找第一列（通常是名称列）做汇总行匹配
      const firstCol = columns[0]?.key;
      const aName = firstCol ? String(a[firstCol] ?? '') : '';
      const bName = firstCol ? String(b[firstCol] ?? '') : '';
      const isSummaryA = keywords.some((kw) => aName.includes(kw));
      const isSummaryB = keywords.some((kw) => bName.includes(kw));
      if (isSummaryA) return -1;
      if (isSummaryB) return 1;
      const aVal = Number(a[sortKey] ?? 0);
      const bVal = Number(b[sortKey] ?? 0);
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [rows, sortKey, sortOrder, summaryKeywords, columns]);

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
              sortedRows.slice(0, 20).map((row, idx) => (
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
