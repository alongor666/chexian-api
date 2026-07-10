/**
 * Heatmap V2 — Color scales, thresholds, and label config
 *
 * 发散型7级色带：暖红 ← 中性灰蓝 → 冷青绿
 * 正常区(L4)在深色模式下几乎透明，异常区跳出。
 */

import type {
  HeatmapThresholdConfig,
  HeatmapTier,
} from './types';

// ==================== 色带配置 ====================

// 7 级发散色带/档位标签/图例序/分位刀收拢至 SSOT src/shared/styles/heatmap-scale.ts，
// 此处按原导出名 re-export，目录内消费者引用不变
export {
  HEATMAP_COLOR_SCALE,
  HEATMAP_TIER_LABELS as TIER_LABELS,
  HEATMAP_LEGEND_TIERS as LEGEND_TIERS,
  HEATMAP_QUANTILE_CUTS as PREMIUM_QUANTILE_CUTS,
} from '@/shared/styles';

/** 保费规模单向蓝色色阶（由浅到深，7级） */
export const PREMIUM_SCALE_COLORS = {
  light: [
    { bg: '#f8fafc', text: '#64748b' },
    { bg: '#f0f9ff', text: '#475569' },
    { bg: '#e0f2fe', text: '#334155' },
    { bg: '#bae6fd', text: '#1e293b' },
    { bg: '#7dd3fc', text: '#0f172a' },
    { bg: '#38bdf8', text: '#0c4a6e' },
    { bg: '#0284c7', text: '#f0f9ff' },
  ] as const,
  dark: [
    { bg: 'rgba(14,165,233,0.04)', text: '#64748b' },
    { bg: 'rgba(14,165,233,0.08)', text: '#94a3b8' },
    { bg: 'rgba(14,165,233,0.13)', text: '#94a3b8' },
    { bg: 'rgba(14,165,233,0.18)', text: '#cbd5e1' },
    { bg: 'rgba(14,165,233,0.24)', text: '#e2e8f0' },
    { bg: 'rgba(14,165,233,0.30)', text: '#f1f5f9' },
    { bg: 'rgba(14,165,233,0.38)', text: '#f8fafc' },
  ] as const,
};

// ==================== 阈值配置 ====================

export const GROWTH_THRESHOLDS: HeatmapThresholdConfig = {
  metric: 'growth',
  tiers: [
    { tier: 'excellent', min: 20 },
    { tier: 'strong',    min: 15 },
    { tier: 'above',     min: 10 },
    { tier: 'normal',    min: 5  },
    { tier: 'below',     min: 0  },
    { tier: 'weak',      min: -5 },
    { tier: 'critical' },
  ],
};

export const ACHIEVEMENT_THRESHOLDS: HeatmapThresholdConfig = {
  metric: 'achievement',
  tiers: [
    { tier: 'excellent', min: 110 },
    { tier: 'strong',    min: 105 },
    { tier: 'above',     min: 100 },
    { tier: 'normal',    min: 95  },
    { tier: 'below',     min: 90  },
    { tier: 'weak',      min: 85  },
    { tier: 'critical' },
  ],
};

/** 系数均值阈值（商业险自主定价系数，中心 ~1.0） */
export const COEFFICIENT_THRESHOLDS: HeatmapThresholdConfig = {
  metric: 'coefficient',
  tiers: [
    { tier: 'excellent', min: 1.15 },
    { tier: 'strong',    min: 1.05 },
    { tier: 'above',     min: 0.95 },
    { tier: 'normal',    min: 0.85 },
    { tier: 'below',     min: 0.75 },
    { tier: 'weak',      min: 0.65 },
    { tier: 'critical' },
  ],
};

/** 占比阈值 */
export const SHARE_THRESHOLDS: HeatmapThresholdConfig = {
  metric: 'share',
  tiers: [
    { tier: 'excellent', min: 25 },
    { tier: 'strong',    min: 18 },
    { tier: 'above',     min: 12 },
    { tier: 'normal',    min: 7  },
    { tier: 'below',     min: 3  },
    { tier: 'weak',      min: 1  },
    { tier: 'critical' },
  ],
};

/** 件均保费阈值（万元） */
export const PER_POLICY_THRESHOLDS: HeatmapThresholdConfig = {
  metric: 'per_policy',
  tiers: [
    { tier: 'excellent', min: 0.8  },
    { tier: 'strong',    min: 0.5  },
    { tier: 'above',     min: 0.3  },
    { tier: 'normal',    min: 0.15 },
    { tier: 'below',     min: 0.08 },
    { tier: 'weak',      min: 0.03 },
    { tier: 'critical' },
  ],
};

export const THRESHOLD_MAP: Record<'growth' | 'achievement' | 'coefficient' | 'share' | 'per_policy', HeatmapThresholdConfig> = {
  growth: GROWTH_THRESHOLDS,
  achievement: ACHIEVEMENT_THRESHOLDS,
  coefficient: COEFFICIENT_THRESHOLDS,
  share: SHARE_THRESHOLDS,
  per_policy: PER_POLICY_THRESHOLDS,
};

// ==================== 标签配置 ====================

export const TIER_BUSINESS_NOTES: Record<HeatmapTier, string> = {
  critical:  '明显低于基准，需重点关注并排查原因。',
  weak:      '低于基准，建议关注趋势走向。',
  below:     '略低于基准，处于正常波动下沿。',
  normal:    '处于正常波动区间。',
  above:     '略高于基准，处于正常波动上沿。',
  strong:    '明显超越基准，表现良好。',
  excellent: '持续超越基准，表现优秀。',
  unknown:   '该期间暂无有效数据。',
};

export const LEGEND_LABELS = {
  left: '偏弱',
  center: '正常',
  right: '偏强',
};

// ==================== 周日标签 ====================

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function getWeekdayLabel(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return `周${WEEKDAY_SHORT[date.getDay()]}`;
}

export function getWeekdayKey(dateText: string): number {
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? -1 : date.getDay();
}

export function isWeekend(dateText: string): boolean {
  const day = getWeekdayKey(dateText);
  return day === 0 || day === 6;
}

export function getMonthKey(dateText: string): string {
  return dateText.slice(5, 7);
}

// ==================== 指标Tab配置 ====================

/** 根据时间视图返回环比前缀 */
function getMomPeriodLabel(timePeriod: string): string {
  switch (timePeriod) {
    case 'day': return '周';    // 日视图环比=上周同天
    case 'week': return '周';
    case 'month': return '月';
    case 'quarter': return '季';
    case 'year': return '年';
    default: return '周';
  }
}

export function getHeatmapMetricTabs(growthMode: 'mom' | 'yoy', timePeriod = 'day') {
  const growthLabel = growthMode === 'mom'
    ? `${getMomPeriodLabel(timePeriod)}环比`
    : '同比';
  return [
    { key: 'growth' as const, label: growthLabel },
    { key: 'achievement' as const, label: '进度' },
    { key: 'premium' as const, label: '保费' },
    { key: 'coefficient' as const, label: '系数均值' },
    { key: 'share' as const, label: '占比' },
    { key: 'per_policy' as const, label: '件均' },
  ];
}

export const TIME_PERIOD_HINTS: Record<string, string> = {
  day: '增长率环比按同星期几对比（周环比），同比按上年同日对比；点选单元格后将高亮同星期几列。',
  week: '每列为一个自然周的汇总保费，环比按上一周对比，同比按上年同周对比。',
  month: '每列为一个自然月的汇总保费，环比按上一月对比，同比按上年同月对比；点选后高亮同月列。',
  quarter: '每列为一个季度的汇总保费，环比按上一季度对比，同比按上年同季对比。',
  year: '每列为一个年度的汇总保费，环比按上一年度对比。',
};

/** 汇总行标签 */
export const BRANCH_SUMMARY_ROW_LABEL = '整体';
