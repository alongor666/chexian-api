/**
 * HeatmapCell — 单个热力图单元格
 *
 * 负责：颜色计算、click/hover 事件、tooltip 触发
 */

import { useCallback, useRef } from 'react';
import { cn, textStyles } from '@/shared/styles';
import { formatCount, formatPercent, formatWanAdaptive } from '@/shared/utils/formatters';
import type { PerformanceOrgHeatmapRow } from '../../../hooks/usePerformanceOrgHeatmap';
import type { PerformanceGrowthMode } from '../../../hooks/usePerformanceSummary';
import type { HeatmapCellCoord, HeatmapMetric, HeatmapTooltipContent } from '../types';
import type { ResolvedColor } from '../hooks/useHeatmapColorScale';
import { getWeekdayLabel, TIER_LABELS, TIER_BUSINESS_NOTES } from '../config';

interface HeatmapCellProps {
  readonly org: string;
  readonly date: string;
  readonly row: PerformanceOrgHeatmapRow | undefined;
  readonly metric: HeatmapMetric;
  readonly growthMode: PerformanceGrowthMode;
  readonly isBranchSummary: boolean;
  readonly isDimmed: boolean;
  readonly isSelected: boolean;
  readonly resolveColor: (value: number | null, metric: HeatmapMetric) => ResolvedColor;
  readonly onCellClick: (coord: HeatmapCellCoord) => void;
  readonly onHoverStart: (coord: HeatmapCellCoord, rect: DOMRect, content: HeatmapTooltipContent) => void;
  readonly onHoverEnd: () => void;
}

export function HeatmapCell({
  org,
  date,
  row,
  metric,
  growthMode,
  isBranchSummary,
  isDimmed,
  isSelected,
  resolveColor,
  onCellClick,
  onHoverStart,
  onHoverEnd,
}: HeatmapCellProps) {
  const cellRef = useRef<HTMLButtonElement>(null);
  const canInteract = !isBranchSummary;

  // 计算显示值和颜色
  const displayValue = getDisplayValue(row, metric, growthMode);
  const colorValue = getColorValue(row, metric, growthMode);
  const resolved = resolveColor(colorValue, metric);

  const handleClick = useCallback(() => {
    if (!canInteract) return;
    onCellClick({ org, date });
  }, [canInteract, onCellClick, org, date]);

  const handleMouseEnter = useCallback(() => {
    if (!canInteract || !cellRef.current) return;
    const rect = cellRef.current.getBoundingClientRect();
    const growthRate = row ? (growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate) : null;
    const content: HeatmapTooltipContent = {
      org,
      date,
      weekdayLabel: getWeekdayLabel(date),
      metric,
      tier: resolved.tier,
      tierLabel: TIER_LABELS[resolved.tier],
      businessNote: TIER_BUSINESS_NOTES[resolved.tier],
      growthRate,
      achievementRate: row?.achievementRate ?? null,
      premium: row?.premium ?? null,
      avgPricingCoefficient: row?.avgPricingCoefficient ?? null,
      premiumShare: row?.premiumShare ?? null,
      perPolicyPremium: row?.perPolicyPremium ?? null,
    };
    onHoverStart({ org, date }, rect, content);
  }, [canInteract, org, date, row, metric, growthMode, resolved.tier, onHoverStart]);

  const handleMouseLeave = useCallback(() => {
    if (!canInteract) return;
    onHoverEnd();
  }, [canInteract, onHoverEnd]);

  return (
    <button
      ref={cellRef}
      type="button"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'w-full rounded-md px-1 py-1.5 text-center transition-all duration-150',
        textStyles.numeric,
        isBranchSummary ? 'font-semibold cursor-default' : 'cursor-pointer',
        isDimmed ? 'opacity-[0.35]' : '',
        isSelected ? 'ring-2 ring-offset-1 ring-primary-400 dark:ring-primary-500 dark:ring-offset-surface-1' : '',
      )}
      style={{
        backgroundColor: resolved.bg,
        color: !row ? (isDimmed ? 'rgba(107,114,128,0.4)' : '#9ca3af') : resolved.text,
      }}
    >
      {displayValue}
    </button>
  );
}

// ==================== Helpers ====================

function getDisplayValue(
  row: PerformanceOrgHeatmapRow | undefined,
  metric: HeatmapMetric,
  growthMode: PerformanceGrowthMode,
): string {
  if (!row) return '-';
  switch (metric) {
    case 'premium':
      return formatWanAdaptive(row.premium);
    case 'achievement':
      return row.achievementRate === null ? '-' : formatPercent(row.achievementRate);
    case 'coefficient':
      return row.avgPricingCoefficient === null ? '-' : row.avgPricingCoefficient.toFixed(4);
    case 'share':
      return row.premiumShare === null ? '-' : formatPercent(row.premiumShare);
    case 'per_policy':
      return row.perPolicyPremium === null ? '-' : formatCount(Math.round(row.perPolicyPremium * 10000));
    default: {
      const rate = growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate;
      return rate === null ? '-' : formatPercent(rate);
    }
  }
}

function getColorValue(
  row: PerformanceOrgHeatmapRow | undefined,
  metric: HeatmapMetric,
  growthMode: PerformanceGrowthMode,
): number | null {
  if (!row) return null;
  switch (metric) {
    case 'premium': return row.premium;
    case 'achievement': return row.achievementRate;
    case 'coefficient': return row.avgPricingCoefficient;
    case 'share': return row.premiumShare;
    case 'per_policy': return row.perPolicyPremium;
    default: return growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate;
  }
}
