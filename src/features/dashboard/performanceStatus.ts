import { colorClasses } from '../../shared/styles';

export type AchievementBand = 'ge_105' | 'ge_100' | 'ge_95' | 'ge_90' | 'lt_90' | 'no_plan';
export type GrowthBand = 'excellent' | 'healthy' | 'abnormal' | 'danger' | 'negative' | 'unknown';

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
      return colorClasses.text.danger;
    case 'negative':
      return colorClasses.text.growthNegative;
    case 'unknown':
      return colorClasses.text.neutralMuted;
  }
}

