/**
 * Heatmap V2 — Color scales, thresholds, and label config
 *
 * 发散型7级色带：暖红 ← 中性灰蓝 → 冷青绿
 * 正常区(L4)在深色模式下几乎透明，异常区跳出。
 */

import type {
  HeatmapColorScale,
  HeatmapThresholdConfig,
  HeatmapTier,
} from './types';

// ==================== 色带配置 ====================

export const HEATMAP_COLOR_SCALE: HeatmapColorScale = {
  light: {
    critical:  { bg: '#fef2f2', text: '#991b1b' },  // L1 暖红
    weak:      { bg: '#fffbeb', text: '#92400e' },  // L2 暖橙
    below:     { bg: '#fefce8', text: '#a16207' },  // L3 浅暖
    normal:    { bg: '#f9fafb', text: '#6b7280' },  // L4 中性灰 — 退后
    above:     { bg: '#f0f9ff', text: '#075985' },  // L5 浅冷蓝
    strong:    { bg: '#e0f2fe', text: '#0c4a6e' },  // L6 冷蓝
    excellent: { bg: '#f0fdfa', text: '#134e4a' },  // L7 冷青绿
    unknown:   { bg: '#f3f4f6', text: '#9ca3af' },  // 缺失
  },
  dark: {
    critical:  { bg: 'rgba(220,80,60,0.30)',  text: '#fca5a5' },  // L1 暗砖红
    weak:      { bg: 'rgba(217,119,6,0.20)',  text: '#fcd34d' },  // L2 暗橙
    below:     { bg: 'rgba(217,119,6,0.09)',  text: '#d4a574' },  // L3 微暖
    normal:    { bg: 'rgba(255,255,255,0.04)', text: '#6b7280' },  // L4 近透明 — 退后
    above:     { bg: 'rgba(14,165,233,0.09)', text: '#7dd3fc' },  // L5 微冷蓝
    strong:    { bg: 'rgba(14,165,233,0.20)', text: '#38bdf8' },  // L6 冷蓝
    excellent: { bg: 'rgba(20,184,166,0.26)', text: '#5eead4' },  // L7 冷青绿
    unknown:   { bg: 'rgba(255,255,255,0.02)', text: '#4b5563' },  // 缺失
  },
};

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

export const THRESHOLD_MAP: Record<'growth' | 'achievement', HeatmapThresholdConfig> = {
  growth: GROWTH_THRESHOLDS,
  achievement: ACHIEVEMENT_THRESHOLDS,
};

// ==================== 标签配置 ====================

export const TIER_LABELS: Record<HeatmapTier, string> = {
  critical:  '危险',
  weak:      '偏弱',
  below:     '轻弱',
  normal:    '正常',
  above:     '轻强',
  strong:    '偏强',
  excellent: '优秀',
  unknown:   '无数据',
};

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

/** 图例用的有序列表（从差到好） */
export const LEGEND_TIERS: readonly HeatmapTier[] = [
  'critical', 'weak', 'below', 'normal', 'above', 'strong', 'excellent',
];

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

export function getHeatmapMetricTabs(growthMode: 'mom' | 'yoy') {
  return [
    { key: 'growth' as const, label: growthMode === 'mom' ? '周环比增长率' : '年同比增长率' },
    { key: 'achievement' as const, label: '计划达成率' },
    { key: 'premium' as const, label: '保费规模' },
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

/** 保费规模分位数切分点 */
export const PREMIUM_QUANTILE_CUTS = [0.05, 0.20, 0.40, 0.60, 0.80, 0.95];
