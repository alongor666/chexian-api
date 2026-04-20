/**
 * 右侧联动面板（原 CategoryTable）— 5 个维度 Tab
 *
 * 根据左侧 Selection 切换展示口径：
 *   overall   → 全量维度分布
 *   org       → 指定机构的维度分布
 *   team      → 指定团队的维度分布
 *   salesman  → 指定业务员的维度分布
 *
 * Tab 维度：客户类别 / 险别组合 / 能源类型 / 新旧过户 / 续转新车
 */
import { useMemo, useState } from 'react';
import { cn, cardStyles, colorClasses, fontStyles } from '@/shared/styles';
import type { RenewalRow, SortField, SortDir, Selection, LinkageDimension } from '../types';
import { formatNum, formatPct, shortenTeamName, stripSalesmanCode } from '../utils/format';

interface Props {
  selection: Selection;
  overall: RenewalRow | null;
  orgRows: RenewalRow[];
  categoryRows: RenewalRow[];
  coverageRows: RenewalRow[];
  fuelRows: RenewalRow[];
  usedTransferRows: RenewalRow[];
  renewalTypeRows: RenewalRow[];
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

interface DimensionConfig {
  key: LinkageDimension;
  label: string;
  field: keyof RenewalRow;
  headerLabel: string;
  levelPrefix: string;
}

const DIMENSIONS: DimensionConfig[] = [
  { key: 'customer_category', label: '客户类别', field: 'customer_category', headerLabel: '客户类别', levelPrefix: 'category' },
  { key: 'coverage_combination', label: '险别组合', field: 'coverage_combination', headerLabel: '险别组合', levelPrefix: 'coverage' },
  { key: 'fuel_category', label: '能源类型', field: 'fuel_category', headerLabel: '能源类型', levelPrefix: 'fuel' },
  { key: 'used_transfer_type', label: '新旧过户', field: 'used_transfer_type', headerLabel: '新旧过户', levelPrefix: 'used_transfer' },
  { key: 'renewal_type', label: '续转新车', field: 'renewal_type', headerLabel: '续转新车', levelPrefix: 'renewal_type' },
];

function getSortValue(row: RenewalRow, field: SortField): number {
  if (field === 'D') return row.A > 0 ? row.B / row.A : 0;
  if (field === 'E') return row.A > 0 ? row.C / row.A : 0;
  return row[field];
}

/**
 * 根据 selection 返回 row_level 前缀 (overall/org/team/salesman)
 */
function selectionToLevel(selection: Selection): 'overall' | 'org' | 'team' | 'salesman' {
  return selection.kind;
}

/**
 * 从联动数据里按 selection 过滤出目标维度分布
 */
function filterDimensionRows(
  rows: RenewalRow[],
  selection: Selection,
  levelPrefix: string
): RenewalRow[] {
  const level = selectionToLevel(selection);
  const targetRowLevel = level === 'overall'
    ? `overall_${levelPrefix}`
    : `${level}_${levelPrefix}`;

  return rows.filter(r => {
    if (r.row_level !== targetRowLevel) return false;
    if (selection.kind === 'overall') return true;
    if (selection.kind === 'org') return r.org_level_3 === selection.org;
    if (selection.kind === 'team')
      return r.org_level_3 === selection.org && r.team_name === selection.team;
    // salesman
    return (
      r.org_level_3 === selection.org
      && r.team_name === selection.team
      && r.salesman_name === selection.salesman
    );
  });
}

/**
 * 找到当前 selection 对应的基础层 headerRow（口径小计）
 */
function findHeaderRow(
  selection: Selection,
  overall: RenewalRow | null,
  orgRows: RenewalRow[]
): RenewalRow | null {
  if (selection.kind === 'overall') return overall;
  if (selection.kind === 'org') {
    return orgRows.find(r => r.row_level === 'org' && r.org_level_3 === selection.org) || null;
  }
  if (selection.kind === 'team') {
    return (
      orgRows.find(
        r =>
          r.row_level === 'team'
          && r.org_level_3 === selection.org
          && r.team_name === selection.team,
      ) || null
    );
  }
  return (
    orgRows.find(
      r =>
        r.row_level === 'salesman'
        && r.org_level_3 === selection.org
        && r.team_name === selection.team
        && r.salesman_name === selection.salesman,
    ) || null
  );
}

function buildSelectionLabel(selection: Selection): string {
  switch (selection.kind) {
    case 'overall':
      return '整体';
    case 'org':
      return selection.org;
    case 'team':
      return `${selection.org} · ${shortenTeamName(selection.team)}`;
    case 'salesman':
      return `${selection.org} · ${stripSalesmanCode(selection.salesman)}`;
  }
}

export default function CategoryTable({
  selection,
  overall,
  orgRows,
  categoryRows,
  coverageRows,
  fuelRows,
  usedTransferRows,
  renewalTypeRows,
  sortField,
  sortDir,
  onSort,
}: Props) {
  const [activeTab, setActiveTab] = useState<LinkageDimension>('customer_category');

  const rowsByDimension: Record<LinkageDimension, RenewalRow[]> = {
    customer_category: categoryRows,
    coverage_combination: coverageRows,
    fuel_category: fuelRows,
    used_transfer_type: usedTransferRows,
    renewal_type: renewalTypeRows,
  };

  const activeConfig = useMemo(
    () => DIMENSIONS.find(d => d.key === activeTab) ?? DIMENSIONS[0],
    [activeTab]
  );

  const displayRows = useMemo(() => {
    const filtered = filterDimensionRows(rowsByDimension[activeTab], selection, activeConfig.levelPrefix);
    return [...filtered].sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [rowsByDimension, activeTab, selection, activeConfig.levelPrefix, sortField, sortDir]);

  const headerRow = findHeaderRow(selection, overall, orgRows);
  const selectionLabel = buildSelectionLabel(selection);
  const title = `${selectionLabel} · ${activeConfig.label}`;

  const sortIcon = (f: SortField) => {
    if (sortField !== f) return <span className={colorClasses.text.neutralMuted}>↕</span>;
    return <span className={colorClasses.text.primary}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  const numericCellClass = cn('px-4 py-2 text-sm text-right whitespace-nowrap', fontStyles.numeric, colorClasses.text.neutralBlack);

  const tabClass = (active: boolean) =>
    cn(
      'px-3 py-1 text-xs rounded-md border transition-colors cursor-pointer select-none',
      active
        ? cn(colorClasses.bg.primarySolid, 'text-white', colorClasses.border.primary)
        : cn('bg-white dark:bg-surface-2', colorClasses.text.neutralLight, colorClasses.border.neutral, 'hover:bg-neutral-100 dark:hover:bg-surface-3'),
    );

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      <div className={cn('px-4 py-3 border-b bg-neutral-50 dark:bg-surface-2', colorClasses.border.neutral)}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={cn('text-base font-semibold truncate', colorClasses.text.neutralBlack)}>{title}</h2>
          {selection.kind !== 'overall' && (
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded whitespace-nowrap',
                colorClasses.bg.primary,
                colorClasses.text.primaryDark,
              )}
            >
              联动: {selectionLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {DIMENSIONS.map(d => (
            <button
              key={d.key}
              type="button"
              onClick={() => setActiveTab(d.key)}
              className={tabClass(activeTab === d.key)}
              aria-pressed={activeTab === d.key}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead>
            <tr className={cn('bg-neutral-50 dark:bg-surface-2 border-b-2', colorClasses.border.neutral)}>
              <th className={cn('px-4 py-2 text-left text-xs font-medium uppercase whitespace-nowrap', colorClasses.text.neutralMuted)}>
                {activeConfig.headerLabel}
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
                  {selectionLabel} 小计
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
            {displayRows.map((row, idx) => {
              const dimValue = (row[activeConfig.field] as string | null) || '(未分类)';
              return (
                <tr
                  key={`${activeConfig.key}-${dimValue}-${idx}`}
                  className={cn('border-b transition-colors', colorClasses.border.neutral, 'hover:bg-primary-bg/50')}
                >
                  <td className={cn('px-4 py-2 text-sm whitespace-nowrap', colorClasses.text.neutralBlack)}>
                    {dimValue}
                  </td>
                  <td className={numericCellClass}>{formatNum(row.A)}</td>
                  <td className={numericCellClass}>{formatNum(row.B)}</td>
                  <td className={numericCellClass}>{formatNum(row.C)}</td>
                  <td className={numericCellClass}>{formatPct(row.B, row.A)}</td>
                  <td className={numericCellClass}>{formatPct(row.C, row.A)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
