import { colorClasses, colors, chartColors } from '../../shared/styles';

export type AchievementBand = 'ge_105' | 'ge_100' | 'ge_95' | 'ge_90' | 'lt_90' | 'no_plan';
export type GrowthBand = 'excellent' | 'healthy' | 'abnormal' | 'danger' | 'negative' | 'unknown';
export type PerformanceQuadrant =
  | 'high_growth_high_achievement'
  | 'high_growth_low_achievement'
  | 'low_growth_high_achievement'
  | 'low_growth_low_achievement'
  | 'unknown';

// 四象限分界与后端 performance-analysis/shared.ts 同源（注册表派生）：
// 达成分界 = plan_completion_pct.thresholds.warn(100)，增长分界 = premium_growth_pct.thresholds.notice(10)。
// 原 7% 为硬编码、不在任何注册表定义内（2026-06-12 用户裁决改为注册表值）。
export const PERFORMANCE_ACHIEVEMENT_THRESHOLD = 100;
export const PERFORMANCE_GROWTH_THRESHOLD = 10;

export const PERFORMANCE_QUADRANT_META: Record<Exclude<PerformanceQuadrant, 'unknown'>, {
  label: string;
  status: '优秀' | '异常' | '预警' | '危险';
  color: string;
}> = {
  high_growth_high_achievement: {
    label: '高增长高达成',
    status: '优秀',
    color: colors.success.DEFAULT,
  },
  high_growth_low_achievement: {
    label: '高增长低达成',
    status: '异常',
    color: colors.warning.DEFAULT,
  },
  low_growth_high_achievement: {
    label: '低增长高达成',
    status: '预警',
    color: chartColors.series.orange,  // #fa8c16
  },
  low_growth_low_achievement: {
    label: '低增长低达成',
    status: '危险',
    color: colors.danger.DEFAULT,
  },
};

export function classifyAchievementBand(rate: number | null | undefined): AchievementBand {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return 'no_plan';
  if (rate >= 105) return 'ge_105';
  if (rate >= 100) return 'ge_100';
  if (rate >= 95) return 'ge_95';
  if (rate >= 90) return 'ge_90';
  return 'lt_90';
}

export function classifyGrowthBand(rate: number | null | undefined): GrowthBand {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return 'unknown';
  if (rate < 0) return 'negative';
  if (rate >= 15) return 'excellent';
  if (rate >= 10) return 'healthy';
  if (rate >= 5) return 'abnormal';
  return 'danger';
}

export function classifyPerformanceQuadrant(
  achievementRate: number | null | undefined,
  growthRate: number | null | undefined
): PerformanceQuadrant {
  if (
    achievementRate === null
    || achievementRate === undefined
    || growthRate === null
    || growthRate === undefined
    || Number.isNaN(achievementRate)
    || Number.isNaN(growthRate)
  ) {
    return 'unknown';
  }
  if (growthRate >= PERFORMANCE_GROWTH_THRESHOLD && achievementRate >= PERFORMANCE_ACHIEVEMENT_THRESHOLD) {
    return 'high_growth_high_achievement';
  }
  if (growthRate >= PERFORMANCE_GROWTH_THRESHOLD && achievementRate < PERFORMANCE_ACHIEVEMENT_THRESHOLD) {
    return 'high_growth_low_achievement';
  }
  if (growthRate < PERFORMANCE_GROWTH_THRESHOLD && achievementRate >= PERFORMANCE_ACHIEVEMENT_THRESHOLD) {
    return 'low_growth_high_achievement';
  }
  return 'low_growth_low_achievement';
}

export function getAchievementBandLabel(band: AchievementBand): string {
  const labelMap: Record<AchievementBand, string> = {
    ge_105: '>=105%',
    ge_100: '100%-105%',
    ge_95: '95%-100%',
    ge_90: '90%-95%',
    lt_90: '<90%',
    no_plan: '无计划',
  };
  return labelMap[band];
}

export function getGrowthBandLabel(band: GrowthBand): string {
  const labelMap: Record<GrowthBand, string> = {
    excellent: '优秀',
    healthy: '健康',
    abnormal: '异常',
    danger: '危险',
    negative: '负增长',
    unknown: '未知',
  };
  return labelMap[band];
}

export function getAchievementTextClass(band: AchievementBand): string {
  switch (band) {
    case 'ge_105':
      return colorClasses.text.success;
    case 'ge_100':
      return colorClasses.text.primary;
    case 'ge_95':
      return colorClasses.text.warning;
    case 'ge_90':
    case 'lt_90':
      return colorClasses.text.danger;
    case 'no_plan':
      return colorClasses.text.neutralMuted;
  }
}

export function getGrowthTextClass(band: GrowthBand): string {
  switch (band) {
    case 'excellent':
      return colorClasses.text.success;
    case 'healthy':
      return colorClasses.text.primary;
    case 'abnormal':
      return colorClasses.text.warning;
    case 'danger':
    case 'negative':
      return colorClasses.text.danger;
    case 'unknown':
      return colorClasses.text.neutralMuted;
  }
}

export function getQuadrantLabel(quadrant: PerformanceQuadrant): string {
  if (quadrant === 'unknown') return '未知';
  return PERFORMANCE_QUADRANT_META[quadrant].label;
}
