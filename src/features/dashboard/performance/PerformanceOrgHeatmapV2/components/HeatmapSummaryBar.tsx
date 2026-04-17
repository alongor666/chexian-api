/**
 * HeatmapSummaryBar — 热力图上方3个摘要Chips
 *
 * 异常机构数 / 连续异常最长 / 改善最快
 */

import { cn } from '@/shared/styles';
import { formatPercent } from '@/shared/utils/formatters';
import type { HeatmapSummaryStats } from '../types';

interface HeatmapSummaryBarProps {
  readonly stats: HeatmapSummaryStats;
  readonly loading: boolean;
}

function SummaryChip({
  icon,
  label,
  highlight,
}: {
  icon: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
        highlight
          ? 'bg-danger-50 dark:bg-[rgba(220,80,60,0.12)] text-danger-700 dark:text-red-300'
          : 'bg-neutral-100 dark:bg-[rgba(255,255,255,0.06)] text-neutral-600 dark:text-neutral-400',
      )}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

export function HeatmapSummaryBar({ stats, loading }: HeatmapSummaryBarProps) {
  if (loading) return null;

  const { abnormalOrgCount, maxConsecutiveDanger, fastestImprovement } = stats;

  return (
    <div className="flex flex-wrap gap-2">
      <SummaryChip
        icon={abnormalOrgCount > 0 ? '!' : '-'}
        label={
          abnormalOrgCount > 0
            ? `${abnormalOrgCount}个机构处于危险档位`
            : '无危险档位机构'
        }
        highlight={abnormalOrgCount > 0}
      />
      {maxConsecutiveDanger && (
        <SummaryChip
          icon="~"
          label={`连续异常最长：${maxConsecutiveDanger.org} ${maxConsecutiveDanger.days}天`}
          highlight={maxConsecutiveDanger.days >= 3}
        />
      )}
      {fastestImprovement && (
        <SummaryChip
          icon="^"
          label={`改善最快：${fastestImprovement.org}(+${formatPercent(fastestImprovement.delta)})`}
        />
      )}
    </div>
  );
}
