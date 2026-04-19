import { useMemo, useState } from 'react';
import { cn, cardStyles, buttonStyles, colorClasses, fontStyles } from '@/shared/styles';
import type { RenewalRow, SortField, SortDir } from '../types';
import { formatNum, formatPct } from '../utils/format';

interface Props {
  rows: RenewalRow[];
  overall: RenewalRow | null;
  selectedOrg: string | null;
  onOrgSelect: (org: string | null) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}

type DrillMode = 'team' | 'salesman';

const METRIC_COLS: { key: SortField; label: string }[] = [
  { key: 'A', label: '应续件数' },
  { key: 'B', label: '报价件数' },
  { key: 'C', label: '已续件数' },
  { key: 'D', label: '报价率' },
  { key: 'E', label: '续保率' },
];

const INDENT_BASE = 16;
const INDENT_STEP = 24;

function getSortValue(row: RenewalRow, field: SortField): number {
  if (field === 'D') return row.A > 0 ? row.B / row.A : 0;
  if (field === 'E') return row.A > 0 ? row.C / row.A : 0;
  return row[field];
}

export default function OrgTable({
  rows,
  overall,
  selectedOrg,
  onOrgSelect,
  sortField,
  sortDir,
  onSort,
}: Props) {
  const [drillMode, setDrillMode] = useState<DrillMode | null>(null);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const orgRows = useMemo(() => rows.filter(r => r.row_level === 'org'), [rows]);
  const teamRows = useMemo(() => rows.filter(r => r.row_level === 'team'), [rows]);
  const salesmanRows = useMemo(() => rows.filter(r => r.row_level === 'salesman'), [rows]);

  const sortedOrgs = useMemo(() => {
    return [...orgRows].sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [orgRows, sortField, sortDir]);

  function handleDrill(org: string, mode: DrillMode) {
    if (selectedOrg === org && drillMode === mode) {
      setDrillMode(null);
      setExpandedTeams(new Set());
      onOrgSelect(null);
    } else {
      setDrillMode(mode);
      setExpandedTeams(new Set());
      onOrgSelect(org);
    }
  }

  function handleOrgRowClick(org: string) {
    if (selectedOrg === org) {
      setDrillMode(null);
      setExpandedTeams(new Set());
      onOrgSelect(null);
    } else {
      if (drillMode === null) setDrillMode(null);
      onOrgSelect(org);
    }
  }

  function toggleTeam(team: string) {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  const numericCellClass = cn('px-4 py-2 text-sm text-right whitespace-nowrap', fontStyles.numeric, colorClasses.text.neutralBlack);

  const drillButtonClass = (active: boolean) =>
    cn(
      'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
      active
        ? cn(colorClasses.bg.primary, colorClasses.border.primary, colorClasses.text.primaryDark)
        : cn(colorClasses.bg.neutralLight, colorClasses.border.neutral, colorClasses.text.neutralLight, 'hover:bg-neutral-200 dark:hover:bg-surface-3'),
    );

  function renderRow(
    row: RenewalRow,
    indent: number,
    isBold: boolean,
    rowKey: string,
    onClick?: () => void,
    labelNode?: React.ReactNode,
  ) {
    const D = formatPct(row.B, row.A);
    const E = formatPct(row.C, row.A);
    const isSelectedOrg = row.org_level_3 === selectedOrg && row.row_level === 'org';
    return (
      <tr
        key={rowKey}
        className={cn(
          'border-b transition-colors',
          colorClasses.border.neutral,
          onClick && cn('cursor-pointer', 'hover:bg-primary-bg/50'),
          isSelectedOrg && colorClasses.bg.primary,
        )}
        onClick={onClick}
      >
        <td
          className={cn(
            'px-4 py-2 text-sm whitespace-nowrap',
            isBold ? cn('font-semibold', colorClasses.text.neutralBlack) : colorClasses.text.neutralBlack,
          )}
          style={{ paddingLeft: `${INDENT_BASE + indent * INDENT_STEP}px` }}
        >
          {labelNode || row.org_level_3 || row.team_name || row.salesman_name || '—'}
        </td>
        <td className={numericCellClass}>{formatNum(row.A)}</td>
        <td className={numericCellClass}>{formatNum(row.B)}</td>
        <td className={numericCellClass}>{formatNum(row.C)}</td>
        <td className={numericCellClass}>{D}</td>
        <td className={numericCellClass}>{E}</td>
      </tr>
    );
  }

  function renderDrilldown(org: string) {
    if (selectedOrg !== org || !drillMode) return null;

    if (drillMode === 'team') {
      const orgTeams = teamRows.filter(r => r.org_level_3 === org);
      const sortedTeams = [...orgTeams].sort((a, b) => {
        const va = getSortValue(a, sortField);
        const vb = getSortValue(b, sortField);
        return sortDir === 'desc' ? vb - va : va - vb;
      });
      const nodes: React.ReactNode[] = [];
      sortedTeams.forEach(team => {
        const teamKey = team.team_name || '';
        const isExpanded = expandedTeams.has(teamKey);
        const teamSalesmen = salesmanRows
          .filter(s => s.org_level_3 === org && s.team_name === team.team_name)
          .sort((a, b) => {
            const va = getSortValue(a, sortField);
            const vb = getSortValue(b, sortField);
            return sortDir === 'desc' ? vb - va : va - vb;
          });
        nodes.push(
          renderRow(
            team,
            1,
            false,
            `team-${org}-${teamKey}`,
            () => toggleTeam(teamKey),
            <span className="flex items-center gap-1.5">
              <span className={cn('text-xs transition-transform inline-block', isExpanded && 'rotate-90')}>▶</span>
              <span>{team.team_name || '(未分团队)'}</span>
              <span className={cn('text-[10px]', colorClasses.text.neutralMuted)}>({teamSalesmen.length} 人)</span>
            </span>,
          ),
        );
        if (isExpanded) {
          teamSalesmen.forEach((s, idx) => {
            nodes.push(
              renderRow(
                s,
                2,
                false,
                `salesman-${org}-${teamKey}-${s.salesman_name || 'unknown'}-${idx}`,
                undefined,
                s.salesman_name || '(未分配)',
              ),
            );
          });
        }
      });
      return nodes;
    }

    if (drillMode === 'salesman') {
      const orgSalesmen = salesmanRows.filter(r => r.org_level_3 === org);
      const sorted = [...orgSalesmen].sort((a, b) => {
        const va = getSortValue(a, sortField);
        const vb = getSortValue(b, sortField);
        return sortDir === 'desc' ? vb - va : va - vb;
      });
      return sorted.map((s, idx) =>
        renderRow(
          s,
          1,
          false,
          `salesman-flat-${org}-${s.salesman_name || 'unknown'}-${idx}`,
          undefined,
          s.salesman_name || '(未分配)',
        ),
      );
    }

    return null;
  }

  const sortIcon = (f: SortField) => {
    if (sortField !== f) return <span className={colorClasses.text.neutralMuted}>↕</span>;
    return <span className={colorClasses.text.primary}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      <div className={cn('px-4 py-3 border-b bg-neutral-50 dark:bg-surface-2 flex items-center justify-between', colorClasses.border.neutral)}>
        <h2 className={cn('text-base font-semibold', colorClasses.text.neutralBlack)}>按三级机构</h2>
        {selectedOrg && (
          <button
            onClick={() => {
              setDrillMode(null);
              setExpandedTeams(new Set());
              onOrgSelect(null);
            }}
            className={cn(buttonStyles.base, buttonStyles.link, 'text-xs')}
          >
            清除选中
          </button>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead>
            <tr className={cn('bg-neutral-50 dark:bg-surface-2 border-b-2', colorClasses.border.neutral)}>
              <th className={cn('px-4 py-2 text-left text-xs font-medium uppercase whitespace-nowrap', colorClasses.text.neutralMuted)}>
                三级机构
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
          {overall && (
            <tbody>
              {renderRow(
                overall,
                0,
                true,
                'overall-row',
                () => {
                  setDrillMode(null);
                  setExpandedTeams(new Set());
                  onOrgSelect(null);
                },
                '整体',
              )}
            </tbody>
          )}
          {sortedOrgs.map(org => (
            <tbody key={`org-${org.org_level_3}`}>
              {renderRow(
                org,
                0,
                false,
                `org-row-${org.org_level_3}`,
                () => handleOrgRowClick(org.org_level_3!),
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="truncate">{org.org_level_3}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDrill(org.org_level_3!, 'team');
                      }}
                      className={drillButtonClass(selectedOrg === org.org_level_3 && drillMode === 'team')}
                    >
                      团队
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDrill(org.org_level_3!, 'salesman');
                      }}
                      className={drillButtonClass(selectedOrg === org.org_level_3 && drillMode === 'salesman')}
                    >
                      业务员
                    </button>
                  </div>
                </div>,
              )}
              {renderDrilldown(org.org_level_3!)}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
