/**
 * HeatmapFocusPanel — 焦点诊断区
 *
 * 选中单元格后展示诊断摘要 + 下钻入口按钮。
 * 替代 PerformanceAnalysisPanel 中的"已选择"区块。
 */

import { useTheme } from '@/shared/theme';
import { formatCount, formatPercent, formatWanAdaptive } from '@/shared/utils/formatters';
import { cardStyles, cn, colorClasses, textStyles } from '@/shared/styles';
import type { HeatmapFocusPanelProps } from '../types';
import { getWeekdayLabel, TIER_LABELS, TIER_BUSINESS_NOTES, THRESHOLD_MAP, HEATMAP_COLOR_SCALE } from '../config';
import type { HeatmapTier } from '../types';

function resolveTier(value: number | null, metric: keyof typeof THRESHOLD_MAP): HeatmapTier {
  if (value === null || Number.isNaN(value)) return 'unknown';
  const config = THRESHOLD_MAP[metric];
  if (!config) return 'unknown';
  for (const { tier, min } of config.tiers) {
    if (min === undefined || value >= min) return tier;
  }
  return 'critical';
}

export function HeatmapFocusPanel({
  activeCell,
  row,
  metric,
  growthMode,
  onDrillClick,
  onClear,
}: HeatmapFocusPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (!activeCell) return null;

  const growthRate = row ? (growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate) : null;
  const primaryValue = (() => {
    switch (metric) {
      case 'premium': return row?.premium ?? null;
      case 'achievement': return row?.achievementRate ?? null;
      case 'coefficient': return row?.avgPricingCoefficient ?? null;
      case 'share': return row?.premiumShare ?? null;
      case 'per_policy': return row?.perPolicyPremium ?? null;
      default: return growthRate;
    }
  })();

  const tier: HeatmapTier = metric === 'premium'
    ? 'normal'
    : resolveTier(primaryValue, metric as keyof typeof THRESHOLD_MAP);

  const tierColor = isDark ? HEATMAP_COLOR_SCALE.dark[tier] : HEATMAP_COLOR_SCALE.light[tier];

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      {/* 标题行 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: tierColor.bg, border: `1px solid ${tierColor.text}40` }}
          />
          <span className={cn(textStyles.body, 'font-semibold', colorClasses.text.neutralDark)}>
            {activeCell.org}
          </span>
          <span className={cn(textStyles.caption, colorClasses.text.neutralMuted)}>
            {activeCell.date} ({getWeekdayLabel(activeCell.date)})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDrillClick}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              colorClasses.border.primary,
              colorClasses.text.primary,
              'hover:bg-primary-50 dark:hover:bg-primary-900/20',
            )}
          >
            选择下钻维度
          </button>
          <button
            type="button"
            onClick={onClear}
            className={cn(
              'px-2 py-1.5 text-sm rounded-lg transition-colors',
              colorClasses.text.neutralMuted,
              'hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
          >
            清除
          </button>
        </div>
      </div>

      {/* 指标卡片 */}
      {row && (
        <div className="flex flex-wrap gap-4">
          <MetricChip
            label={growthMode === 'mom' ? '环比' : '同比'}
            value={growthRate !== null ? formatPercent(growthRate) : '-'}
            isActive={metric === 'growth'}
          />
          <MetricChip
            label="进度"
            value={row.achievementRate !== null ? formatPercent(row.achievementRate) : '-'}
            isActive={metric === 'achievement'}
          />
          <MetricChip
            label="保费(万)"
            value={formatWanAdaptive(row.premium)}
            isActive={metric === 'premium'}
          />
          <MetricChip
            label="系数均值"
            value={row.avgPricingCoefficient !== null ? row.avgPricingCoefficient.toFixed(4) : '-'}
            isActive={metric === 'coefficient'}
          />
          <MetricChip
            label="占比"
            value={row.premiumShare !== null ? formatPercent(row.premiumShare) : '-'}
            isActive={metric === 'share'}
          />
          <MetricChip
            label="件均(元)"
            value={row.perPolicyPremium !== null ? formatCount(Math.round(row.perPolicyPremium * 10000)) : '-'}
            isActive={metric === 'per_policy'}
          />
        </div>
      )}

      {/* 诊断摘要 */}
      <div
        className="rounded-lg px-3 py-2 text-xs"
        style={{
          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb',
          color: isDark ? '#9ca3af' : '#6b7280',
        }}
      >
        <span className="font-medium" style={{ color: tierColor.text }}>
          {TIER_LABELS[tier]}
        </span>
        <span className="mx-1.5">·</span>
        <span>{TIER_BUSINESS_NOTES[tier]}</span>
      </div>
    </section>
  );
}

function MetricChip({
  label,
  value,
  isActive,
}: {
  label: string;
  value: string;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-1.5 text-xs',
        isActive
          ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
          : 'bg-neutral-50 dark:bg-[rgba(255,255,255,0.04)]',
      )}
    >
      <div className={colorClasses.text.neutralMuted}>{label}</div>
      <div className={cn('font-semibold mt-0.5', textStyles.numeric, colorClasses.text.neutralDark)}>
        {value}
      </div>
    </div>
  );
}
