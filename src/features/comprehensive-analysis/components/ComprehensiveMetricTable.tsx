import React from 'react';
import { cn, tableStyles, textStyles, colorClasses } from '@/shared/styles';
import { isBranchSummaryRow } from '@/shared/utils/branchDisplay';

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
  /** 额外汇总行关键字（默认已识别省分公司名/合计/汇总/全部/整体；此处传调用方专属汇总词） */
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
  summaryKeywords = [],
}: ComprehensiveMetricTableProps<T>) {
  const sortedRows = React.useMemo(() => {
    if (!sortKey) return rows;
    const keywords = summaryKeywords;
    return rows.slice().sort((a, b) => {
      // 找第一列（通常是名称列）做汇总行匹配
      const firstCol = columns[0]?.key;
      const aName = firstCol ? String(a[firstCol] ?? '') : '';
      const bName = firstCol ? String(b[firstCol] ?? '') : '';
      // 汇总行：已知省分公司名（四川/山西分公司）+ 通用关键字（合计/汇总/全部/整体），
      // 见 branchDisplay.isBranchSummaryRow；keywords 为调用方额外自定义汇总词
      const isSummaryA = isBranchSummaryRow(aName) || keywords.some((kw) => aName.includes(kw));
      const isSummaryB = isBranchSummaryRow(bName) || keywords.some((kw) => bName.includes(kw));
      // 仅一方是汇总行时置顶（对称比较，避免双汇总行时 comparator 违反反对称 — codex 闸-2 P2）
      if (isSummaryA !== isSummaryB) return isSummaryA ? -1 : 1;
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
