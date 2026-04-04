/**
 * HeatmapLegend — 发散型渐变图例
 *
 * 一条水平渐变条 + 7段标签，从"偏弱"到"偏强"
 */

import { useTheme } from '@/shared/theme';
import { cn, colorClasses } from '@/shared/styles';
import type { HeatmapMetric } from '../types';
import { HEATMAP_COLOR_SCALE, LEGEND_LABELS, LEGEND_TIERS, TIER_LABELS } from '../config';

interface HeatmapLegendProps {
  readonly metric: HeatmapMetric;
}

export function HeatmapLegend({ metric }: HeatmapLegendProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const scale = isDark ? HEATMAP_COLOR_SCALE.dark : HEATMAP_COLOR_SCALE.light;

  if (metric === 'premium') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className={colorClasses.text.neutralMuted}>低</span>
        <div
          className="h-2.5 flex-1 rounded-full"
          style={{
            background: isDark
              ? 'linear-gradient(to right, rgba(14,165,233,0.04), rgba(14,165,233,0.38))'
              : 'linear-gradient(to right, #f8fafc, #0284c7)',
            maxWidth: 200,
          }}
        />
        <span className={colorClasses.text.neutralMuted}>高</span>
      </div>
    );
  }

  // 发散型图例
  const gradientStops = LEGEND_TIERS.map((tier, i) => {
    const pct = (i / (LEGEND_TIERS.length - 1)) * 100;
    return `${scale[tier].bg} ${pct}%`;
  }).join(', ');

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={colorClasses.text.neutralMuted}>{LEGEND_LABELS.left}</span>
        <div
          className="h-2.5 flex-1 rounded-full border"
          style={{
            background: `linear-gradient(to right, ${gradientStops})`,
            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            maxWidth: 280,
          }}
        />
        <span className={colorClasses.text.neutralMuted}>{LEGEND_LABELS.right}</span>
      </div>
      <div className="flex justify-between text-[10px]" style={{ maxWidth: 312 }}>
        {LEGEND_TIERS.map((tier) => (
          <span
            key={tier}
            className={cn(
              tier === 'normal' ? 'font-medium' : '',
            )}
            style={{ color: scale[tier].text }}
          >
            {TIER_LABELS[tier]}
          </span>
        ))}
      </div>
    </div>
  );
}
