import { useMemo, useState } from 'react';
import { cn, cardStyles, buttonStyles, colorClasses } from '@/shared/styles';
import type { RenewalRow, SortField, SortDir, Selection } from '../types';
import { shortenTeamName, stripSalesmanCode } from '../utils/format';
import { isBadRow } from '../utils/grading';
import MetricCells from './MetricCells';
import FunnelLegend from './FunnelLegend';

interface Props {
  rows: RenewalRow[];
  overall: RenewalRow | null;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}

type DrillMode = 'team' | 'salesman';

const METRIC_COLS: { key: SortField; label: string; theme?: boolean }[] = [
  { key: 'A', label: '应续件数' },
  { key: 'B', label: '报价件数' },
  { key: 'C', label: '已续件数' },
  { key: 'D', label: '报价率' },
  { key: 'E', label: '续保率', theme: true },
];

const INDENT_BASE = 16;
const INDENT_STEP = 24;

function getSortValue(row: RenewalRow, field: SortField): number {
  if (field === 'D') return row.A > 0 ? row.B / row.A : 0;
  if (field === 'E') return row.A > 0 ? row.C / row.A : 0;
  return row[field];
}

function isOrgSelected(selection: Selection, org: string): boolean {
  return selection.kind !== 'overall' && selection.org === org;
}

function isTeamSelected(selection: Selection, org: string, team: string | null): boolean {
  if (selection.kind === 'team') return selection.org === org && selection.team === team;
  return false;
}

function isSalesmanSelected(
  selection: Selection,
  org: string,
  team: string | null,
  salesman: string | null
): boolean {
  if (selection.kind !== 'salesman') return false;
  return selection.org === org && selection.team === team && selection.salesman === salesman;
}

function isOverallSelected(selection: Selection): boolean {
  return selection.kind === 'overall';
}

export default function OrgTable({
  rows,
  overall,
  selection,
  onSelectionChange,
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

  // 选中的机构名（用于判断是否展开下钻）
  const selectedOrg = selection.kind === 'overall' ? null : selection.org;

  function handleDrill(org: string, mode: DrillMode) {
    if (selectedOrg === org && drillMode === mode) {
      // 收起下钻
      setDrillMode(null);
      setExpandedTeams(new Set());
      onSelectionChange({ kind: 'org', org });
    } else {
      setDrillMode(mode);
      setExpandedTeams(new Set());
      onSelectionChange({ kind: 'org', org });
    }
  }

  function handleOverallClick() {
    if (isOverallSelected(selection)) return;
    setDrillMode(null);
    setExpandedTeams(new Set());
    onSelectionChange({ kind: 'overall' });
  }

  function handleOrgRowClick(org: string) {
    if (selection.kind === 'org' && selection.org === org) {
      // 已选中该机构 → 回到整体
      setDrillMode(null);
      setExpandedTeams(new Set());
      onSelectionChange({ kind: 'overall' });
    } else {
      onSelectionChange({ kind: 'org', org });
    }
  }

  function handleTeamRowClick(org: string, team: string | null) {
    if (isTeamSelected(selection, org, team)) {
      onSelectionChange({ kind: 'org', org });
    } else {
      onSelectionChange({ kind: 'team', org, team: team || '' });
    }
  }

  function handleSalesmanRowClick(org: string, team: string | null, salesman: string | null) {
    if (!salesman) return;
    if (isSalesmanSelected(selection, org, team, salesman)) {
      onSelectionChange({ kind: 'org', org });
    } else {
      onSelectionChange({ kind: 'salesman', org, team, salesman });
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

  const drillButtonClass = (active: boolean) =>
    cn(
      'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
      active
        ? cn(colorClasses.bg.primary, colorClasses.border.primary, colorClasses.text.primaryDark)
        : cn(colorClasses.bg.neutralLight, colorClasses.border.neutral, colorClasses.text.neutralLight, 'hover:bg-neutral-200 dark:hover:bg-surface-3'),
    );

  /** 渲染一行：统一处理 坏行高亮 / 选中左条 / 缩进 / 指标列 */
  function renderRow(
    row: RenewalRow,
    indent: number,
    isBold: boolean,
    rowKey: string,
    isSelected: boolean,
    onClick?: () => void,
    labelNode?: React.ReactNode,
    isTotal = false,
  ) {
    const bad = !isTotal && isBadRow(row);
    const barStyle = isSelected
      ? { boxShadow: 'inset 3px 0 0 var(--c-primary)' }
      : bad
        ? { boxShadow: 'inset 3px 0 0 var(--c-danger)' }
        : undefined;

    return (
      <tr
        key={rowKey}
        className={cn(
          'border-b transition-colors',
          colorClasses.border.neutral,
          onClick && 'cursor-pointer',
          isTotal && cn(colorClasses.bg.neutral, 'font-semibold'),
          isSelected
            ? colorClasses.bg.primary
            : bad
              ? colorClasses.bg.danger
              : onClick && 'hover:bg-primary-bg/50',
        )}
        onClick={onClick}
      >
        <td
          className={cn(
            'px-3 py-2 text-sm whitespace-nowrap',
            isBold ? cn('font-semibold', colorClasses.text.neutralBlack) : colorClasses.text.neutralBlack,
          )}
          style={{ paddingLeft: `${INDENT_BASE + indent * INDENT_STEP}px`, ...barStyle }}
        >
          {labelNode || row.org_level_3 || row.team_name || row.salesman_name || '—'}
        </td>
        <MetricCells row={row} showFunnel />
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
        const teamSelected = isTeamSelected(selection, org, team.team_name);
        nodes.push(
          renderRow(
            team,
            1,
            false,
            `team-${org}-${teamKey}`,
            teamSelected,
            () => handleTeamRowClick(org, team.team_name),
            <span className="flex items-center gap-1.5">
              <span
                role="button"
                aria-label={isExpanded ? '折叠团队' : '展开团队'}
                onClick={e => {
                  e.stopPropagation();
                  toggleTeam(teamKey);
                }}
                className={cn('text-xs transition-transform inline-block cursor-pointer', colorClasses.text.neutralLight, isExpanded && 'rotate-90')}
              >
                ▶
              </span>
              <span className={colorClasses.text.neutralDark}>{shortenTeamName(team.team_name)}</span>
              <span className={cn('text-[10px]', colorClasses.text.neutralMuted)}>({teamSalesmen.length} 人)</span>
            </span>,
          ),
        );
        if (isExpanded) {
          teamSalesmen.forEach((s, idx) => {
            const selected = isSalesmanSelected(selection, org, s.team_name, s.salesman_name);
            nodes.push(
              renderRow(
                s,
                2,
                false,
                `salesman-${org}-${teamKey}-${s.salesman_name || 'unknown'}-${idx}`,
                selected,
                () => handleSalesmanRowClick(org, s.team_name, s.salesman_name),
                <span className="flex items-center gap-1.5">
                  <span className={cn('font-mono', colorClasses.text.neutralMuted)}>└</span>
                  <span className={colorClasses.text.neutral}>{stripSalesmanCode(s.salesman_name)}</span>
                </span>,
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
      return sorted.map((s, idx) => {
        const selected = isSalesmanSelected(selection, org, s.team_name, s.salesman_name);
        return renderRow(
          s,
          1,
          false,
          `salesman-flat-${org}-${s.salesman_name || 'unknown'}-${idx}`,
          selected,
          () => handleSalesmanRowClick(org, s.team_name, s.salesman_name),
          <span className="flex items-center gap-1.5">
            <span className={cn('font-mono', colorClasses.text.neutralMuted)}>└</span>
            <span className={colorClasses.text.neutral}>{stripSalesmanCode(s.salesman_name)}</span>
          </span>,
        );
      });
    }

    return null;
  }

  const sortIcon = (f: SortField) => {
    if (sortField !== f) return <span className={colorClasses.text.neutralMuted}>↕</span>;
    return <span className={colorClasses.text.primary}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  const overallSelected = isOverallSelected(selection);

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      <div className={cn('px-4 py-3 border-b bg-neutral-50 dark:bg-surface-2 flex items-center justify-between', colorClasses.border.neutral)}>
        <h2 className={cn('text-base font-semibold', colorClasses.text.neutralBlack)}>按三级机构</h2>
        {!overallSelected && (
          <button
            onClick={() => {
              setDrillMode(null);
              setExpandedTeams(new Set());
              onSelectionChange({ kind: 'overall' });
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
              <th className={cn('sticky top-0 z-10 bg-neutral-50 dark:bg-surface-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap', colorClasses.text.neutralLight)}>
                三级机构
              </th>
              <th className={cn('sticky top-0 z-10 bg-neutral-50 dark:bg-surface-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap', colorClasses.text.neutralLight)}>
                漏斗 A→B→C
              </th>
              {METRIC_COLS.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'sticky top-0 z-10 bg-neutral-50 dark:bg-surface-2 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide whitespace-nowrap',
                    col.theme ? colorClasses.text.primaryDark : colorClasses.text.neutralLight,
                  )}
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
                overallSelected,
                handleOverallClick,
                <span className="flex items-center gap-2">
                  <span>整体</span>
                  <span className={cn('text-[10px] font-normal', colorClasses.text.neutralMuted)}>四川分公司 · 全部</span>
                </span>,
                true,
              )}
            </tbody>
          )}
          {sortedOrgs.map(org => {
            const orgSelected = selection.kind === 'org' && isOrgSelected(selection, org.org_level_3!);
            return (
              <tbody key={`org-${org.org_level_3}`}>
                {renderRow(
                  org,
                  0,
                  false,
                  `org-row-${org.org_level_3}`,
                  orgSelected,
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
            );
          })}
        </table>
      </div>
      <div className={cn('px-4 py-2.5 border-t bg-neutral-50 dark:bg-surface-2', colorClasses.border.neutral)}>
        <FunnelLegend />
      </div>
    </div>
  );
}
