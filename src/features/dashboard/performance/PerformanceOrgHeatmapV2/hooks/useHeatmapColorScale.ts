/**
 * useHeatmapColorScale — 7级发散色带映射
 *
 * 根据 (value, metric, isDark) 返回 { bg, text, tier, tierLabel }
 */

import { useMemo } from 'react';
import { useTheme } from '@/shared/theme';
import type { HeatmapColorEntry, HeatmapMetric, HeatmapTier } from '../types';
import {
  HEATMAP_COLOR_SCALE,
  PREMIUM_SCALE_COLORS,
  PREMIUM_QUANTILE_CUTS,
  THRESHOLD_MAP,
  TIER_LABELS,
  TIER_BUSINESS_NOTES,
} from '../config';

export interface ResolvedColor extends HeatmapColorEntry {
  readonly tier: HeatmapTier;
  readonly tierLabel: string;
  readonly businessNote: string;
}

/** 根据阈值配置将数值分到7级 */
function resolveTier(value: number | null, metric: 'growth' | 'achievement' | 'coefficient' | 'share' | 'per_policy'): HeatmapTier {
  if (value === null || Number.isNaN(value)) return 'unknown';
  const config = THRESHOLD_MAP[metric];
  for (const { tier, min } of config.tiers) {
    if (min === undefined || value >= min) return tier;
  }
  return 'critical';
}

/** 根据 tier + 主题返回颜色 */
function resolveColor(tier: HeatmapTier, isDark: boolean): HeatmapColorEntry {
  const scale = isDark ? HEATMAP_COLOR_SCALE.dark : HEATMAP_COLOR_SCALE.light;
  return scale[tier];
}

/** 根据保费值在分位数中的位置返回颜色（单向7级蓝色） */
function resolvePremiumColor(
  value: number | null,
  quantiles: readonly number[],
  isDark: boolean,
): HeatmapColorEntry & { tier: HeatmapTier } {
  if (value === null || Number.isNaN(value)) {
    const scale = isDark ? HEATMAP_COLOR_SCALE.dark : HEATMAP_COLOR_SCALE.light;
    return { ...scale.unknown, tier: 'unknown' };
  }
  const colors = isDark ? PREMIUM_SCALE_COLORS.dark : PREMIUM_SCALE_COLORS.light;
  let idx = 0;
  for (let i = 0; i < quantiles.length; i++) {
    if (value >= quantiles[i]) idx = i + 1;
  }
  const entry = colors[Math.min(idx, colors.length - 1)];
  // 将分位idx映射到tier名（仅用于tooltip显示）
  const tierMap: HeatmapTier[] = ['critical', 'weak', 'below', 'normal', 'above', 'strong', 'excellent'];
  return { ...entry, tier: tierMap[Math.min(idx, tierMap.length - 1)] };
}

/** 从保费数组计算分位数 */
function computeQuantiles(values: readonly number[]): readonly number[] {
  if (values.length === 0) return PREMIUM_QUANTILE_CUTS.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  return PREMIUM_QUANTILE_CUTS.map((q) => {
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  });
}

export function useHeatmapColorScale(premiumValues?: readonly number[]) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const quantiles = useMemo(
    () => computeQuantiles(premiumValues ?? []),
    [premiumValues],
  );

  const resolve = useMemo(() => {
    return (value: number | null, metric: HeatmapMetric): ResolvedColor => {
      if (metric === 'premium') {
        const result = resolvePremiumColor(value, quantiles, isDark);
        return {
          bg: result.bg,
          text: result.text,
          tier: result.tier,
          tierLabel: TIER_LABELS[result.tier],
          businessNote: TIER_BUSINESS_NOTES[result.tier],
        };
      }

      // 防御性检查：确保 metric 在 THRESHOLD_MAP 中存在
      if (!(metric in THRESHOLD_MAP)) {
        const color = resolveColor('unknown', isDark);
        return { bg: color.bg, text: color.text, tier: 'unknown' as const, tierLabel: TIER_LABELS.unknown, businessNote: TIER_BUSINESS_NOTES.unknown };
      }
      const tier = resolveTier(value, metric as keyof typeof THRESHOLD_MAP);
      const color = resolveColor(tier, isDark);
      return {
        bg: color.bg,
        text: color.text,
        tier,
        tierLabel: TIER_LABELS[tier],
        businessNote: TIER_BUSINESS_NOTES[tier],
      };
    };
  }, [isDark, quantiles]);

  return { resolve, isDark };
}
