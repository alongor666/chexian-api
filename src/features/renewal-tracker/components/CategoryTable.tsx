import { useMemo } from 'react';
import { cn, cardStyles, colorClasses, fontStyles } from '@/shared/styles';
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
    if (sortField !== f) return <span className={colorClasses.text.neutralMuted}>↕</span>;
    return <span className={colorClasses.text.primary}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  const numericCellClass = cn('px-4 py-2 text-sm text-right whitespace-nowrap', fontStyles.numeric, colorClasses.text.neutralBlack);

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      <div className={cn('px-4 py-3 border-b bg-neutral-50 dark:bg-surface-2 flex items-center justify-between', colorClasses.border.neutral)}>
        <h2 className={cn('text-base font-semibold', colorClasses.text.neutralBlack)}>{title}</h2>
        {selectedOrg && (
          <span className={cn('text-xs px-2 py-0.5 rounded whitespace-nowrap', colorClasses.bg.primary, colorClasses.text.primaryDark)}>
            联动: {selectedOrg}
          </span>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead>
            <tr className={cn('bg-neutral-50 dark:bg-surface-2 border-b-2', colorClasses.border.neutral)}>
              <th className={cn('px-4 py-2 text-left text-xs font-medium uppercase whitespace-nowrap', colorClasses.text.neutralMuted)}>
                客户类别
              </th>
              {METRIC_COLS.map(col => (
                <th
                  key={col.key}
                  className={cn('px-4 py-2 text-right text-xs font-medium uppercase whitespace-nowrap', colorClasses.text.neutralMuted)}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={cn('inline-flex items-center gap-1 uppercase cursor-pointer select-none', 'hover:text-primary')}
                  >
                    {col.label}
                    {sortIcon(col.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {headerRow && (
              <tr className={cn('border-b font-semibold', colorClasses.border.neutral, 'bg-neutral-50/50 dark:bg-surface-2/50')}>
                <td className={cn('px-4 py-2 text-sm whitespace-nowrap', colorClasses.text.neutralBlack)}>
                  {selectedOrg ? `${selectedOrg} 小计` : '整体'}
                </td>
                <td className={numericCellClass}>{formatNum(headerRow.A)}</td>
                <td className={numericCellClass}>{formatNum(headerRow.B)}</td>
                <td className={numericCellClass}>{formatNum(headerRow.C)}</td>
                <td className={numericCellClass}>{formatPct(headerRow.B, headerRow.A)}</td>
                <td className={numericCellClass}>{formatPct(headerRow.C, headerRow.A)}</td>
              </tr>
            )}
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={6} className={cn('px-4 py-8 text-center text-sm', colorClasses.text.neutralMuted)}>
                  暂无数据
                </td>
              </tr>
            )}
            {displayRows.map(row => (
              <tr
                key={`cat-${row.org_level_3 || 'all'}-${row.customer_category}`}
                className={cn('border-b transition-colors', colorClasses.border.neutral, 'hover:bg-primary-bg/50')}
              >
                <td className={cn('px-4 py-2 text-sm whitespace-nowrap', colorClasses.text.neutralBlack)}>
                  {row.customer_category || '(未分类)'}
                </td>
                <td className={numericCellClass}>{formatNum(row.A)}</td>
                <td className={numericCellClass}>{formatNum(row.B)}</td>
                <td className={numericCellClass}>{formatNum(row.C)}</td>
                <td className={numericCellClass}>{formatPct(row.B, row.A)}</td>
                <td className={numericCellClass}>{formatPct(row.C, row.A)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
