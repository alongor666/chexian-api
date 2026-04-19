import { useMemo } from 'react';
import type { RenewalRow, SortField, SortDir } from '../types';
import { formatNum, formatPct } from '../utils/format';

interface Props {
  rows: RenewalRow[];
  overall: RenewalRow | null;
  orgOverall: RenewalRow | null;
  selectedOrg: string | null;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}

const METRIC_COLS: { key: SortField; label: string }[] = [
  { key: 'A', label: '应续件数' },
  { key: 'B', label: '报价件数' },
  { key: 'C', label: '已续件数' },
  { key: 'D', label: '报价率' },
  { key: 'E', label: '续保率' },
];

function getSortValue(row: RenewalRow, field: SortField): number {
  if (field === 'D') return row.A > 0 ? row.B / row.A : 0;
  if (field === 'E') return row.A > 0 ? row.C / row.A : 0;
  return row[field];
}

export default function CategoryTable({
  rows,
  overall,
  orgOverall,
  selectedOrg,
  sortField,
  sortDir,
  onSort,
}: Props) {
  const displayRows = useMemo(() => {
    const filtered = selectedOrg
      ? rows.filter(r => r.row_level === 'org_category' && r.org_level_3 === selectedOrg)
      : rows.filter(r => r.row_level === 'category');
    return [...filtered].sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [rows, selectedOrg, sortField, sortDir]);

  const headerRow = selectedOrg ? orgOverall : overall;
  const title = selectedOrg ? `${selectedOrg} · 客户类别` : '客户类别';

  const sortIcon = (f: SortField) => {
    if (sortField !== f) return <span className="text-muted-foreground/50">↕</span>;
    return <span className="text-blue-600 dark:text-blue-400">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {selectedOrg && (
          <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded whitespace-nowrap">
            联动: {selectedOrg}
          </span>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b-2 border-border">
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">
                客户类别
              </th>
              {METRIC_COLS.map(col => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 select-none whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortIcon(col.key)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {headerRow && (
              <tr className="border-b border-border bg-muted/30 font-semibold">
                <td className="px-4 py-2 text-sm text-foreground whitespace-nowrap">
                  {selectedOrg ? `${selectedOrg} 小计` : '整体'}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatNum(headerRow.A)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatNum(headerRow.B)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatNum(headerRow.C)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatPct(headerRow.B, headerRow.A)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatPct(headerRow.C, headerRow.A)}
                </td>
              </tr>
            )}
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            )}
            {displayRows.map(row => (
              <tr
                key={`cat-${row.org_level_3 || 'all'}-${row.customer_category}`}
                className="border-b border-border hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors"
              >
                <td className="px-4 py-2 text-sm text-foreground whitespace-nowrap">
                  {row.customer_category || '(未分类)'}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatNum(row.A)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatNum(row.B)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatNum(row.C)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatPct(row.B, row.A)}
                </td>
                <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">
                  {formatPct(row.C, row.A)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
