import { useMemo, useState } from 'react';
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

  function renderRow(
    row: RenewalRow,
    indent: number,
    isBold: boolean,
    onClick?: () => void,
    labelNode?: React.ReactNode,
  ) {
    const D = formatPct(row.B, row.A);
    const E = formatPct(row.C, row.A);
    const isSelectedOrg = row.org_level_3 === selectedOrg && row.row_level === 'org';
    return (
      <tr
        key={`${row.row_level}-${row.org_level_3}-${row.team_name}-${row.salesman_name}-${indent}`}
        className={`border-b border-border transition-colors ${
          onClick ? 'cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30' : ''
        } ${isSelectedOrg ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}
        onClick={onClick}
      >
        <td
          className={`px-4 py-2 text-sm whitespace-nowrap ${
            isBold ? 'font-semibold text-foreground' : 'text-foreground'
          }`}
          style={{ paddingLeft: `${16 + indent * 24}px` }}
        >
          {labelNode || row.org_level_3 || row.team_name || row.salesman_name || '—'}
        </td>
        <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">{formatNum(row.A)}</td>
        <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">{formatNum(row.B)}</td>
        <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">{formatNum(row.C)}</td>
        <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">{D}</td>
        <td className="px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap text-foreground">{E}</td>
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
            () => toggleTeam(teamKey),
            <span className="flex items-center gap-1.5">
              <span className={`text-xs transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
              <span>{team.team_name || '(未分团队)'}</span>
              <span className="text-[10px] text-muted-foreground">({teamSalesmen.length} 人)</span>
            </span>,
          ),
        );
        if (isExpanded) {
          teamSalesmen.forEach(s => {
            nodes.push(renderRow(s, 2, false, undefined, s.salesman_name || '(未分配)'));
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
      return sorted.map(s => renderRow(s, 1, false, undefined, s.salesman_name || '(未分配)'));
    }

    return null;
  }

  const sortIcon = (f: SortField) => {
    if (sortField !== f) return <span className="text-muted-foreground/50">↕</span>;
    return <span className="text-blue-600 dark:text-blue-400">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">按三级机构</h2>
        {selectedOrg && (
          <button
            onClick={() => {
              setDrillMode(null);
              setExpandedTeams(new Set());
              onOrgSelect(null);
            }}
            className="text-xs text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
          >
            清除选中
          </button>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b-2 border-border">
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">
                三级机构
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
          {overall && (
            <tbody>
              {renderRow(
                overall,
                0,
                true,
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
                () => handleOrgRowClick(org.org_level_3!),
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="truncate">{org.org_level_3}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDrill(org.org_level_3!, 'team');
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        selectedOrg === org.org_level_3 && drillMode === 'team'
                          ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-300'
                          : 'bg-muted border-border text-muted-foreground hover:bg-muted/70'
                      }`}
                    >
                      团队
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDrill(org.org_level_3!, 'salesman');
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        selectedOrg === org.org_level_3 && drillMode === 'salesman'
                          ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-300'
                          : 'bg-muted border-border text-muted-foreground hover:bg-muted/70'
                      }`}
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
