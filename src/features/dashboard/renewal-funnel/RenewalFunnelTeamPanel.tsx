/**
 * 团队续保排行面板
 */

import React from 'react';
import { useRenewalFunnelTeam } from './hooks/useRenewalFunnel';
import { cardStyles, tableStyles, textStyles, fontStyles, cn, colorClasses } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import type { FunnelFilters } from './types';

interface Props {
  filters: FunnelFilters;
  onTeamClick: (teamName: string) => void;
}

export const RenewalFunnelTeamPanel: React.FC<Props> = ({ filters, onTeamClick }) => {
  const { data, isLoading } = useRenewalFunnelTeam(filters);

  if (!filters.orgName) return null;

  return (
    <div className={cardStyles.standard}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={textStyles.titleSmall}>
          {filters.orgName} — 团队续保排行
        </h3>
        <span className={textStyles.caption}>
          {(data ?? []).length} 个团队
        </span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-neutral-100 rounded" />
          ))}
        </div>
      ) : (
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>团队</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>应续</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>已续</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>续保率</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>报价转化</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>自留</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>流失续</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>自留率</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.team_name} className={tableStyles.row}>
                  <td className={tableStyles.cell}>
                    <button
                      onClick={() => onTeamClick(row.team_name)}
                      className={textStyles.link}
                    >
                      {row.team_name || '未分配'}
                    </button>
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    {formatCount(row.total_due ?? 0)}
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    {formatCount(row.total_renewed ?? 0)}
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    <RateCell value={row.renewal_rate ?? 0} />
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    {(row.quote_to_renewal_rate ?? 0).toFixed(1)}%
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    {formatCount(row.self_retained_count ?? 0)}
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    {formatCount(row.lost_renewed_count ?? 0)}
                  </td>
                  <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                    {(row.self_retention_rate ?? 0).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const RateCell: React.FC<{ value: number }> = ({ value }) => {
  const colorClass =
    value >= 60 ? colorClasses.text.success
    : value >= 45 ? colorClasses.text.warning
    : colorClasses.text.danger;

  return (
    <span className={cn(colorClass, 'font-semibold')}>
      {value.toFixed(1)}%
    </span>
  );
};
