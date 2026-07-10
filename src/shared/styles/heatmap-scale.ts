/**
 * 热力图 7 级发散色带体系（SSOT）
 *
 * 来源：热力图收拢第一批（backlog 2026-06-11-claude-3093a3 ⑤）。
 * 此前 CrossSellMetricsHeatmap 与 PerformanceOrgHeatmapV2 各持一份逐字节相同的
 * 档位类型 / 明暗双主题色值 / 档位标签 / 阈值分档 / 分位数分档实现，本文件收拢为唯一事实源。
 *
 * 设计语义：暖红（偏弱）← 中性灰（正常，深色模式近透明退后）→ 冷青绿（偏强），
 * 异常单元格跳出、正常区退后。
 *
 * 各业务的阈值表（如推介率 75% 基准、增长率 ±5% 波动带）属于业务口径，
 * 留在各 feature 内配置，本文件只提供档位机制与色值。
 */

// ==================== 档位与类型 ====================

/** 7 级发散档位 + 缺失值 */
export type HeatmapTier =
  | 'critical'   // L1 明显低于基准
  | 'weak'       // L2 低于基准
  | 'below'      // L3 略低于基准
  | 'normal'     // L4 正常波动带
  | 'above'      // L5 略高于基准
  | 'strong'     // L6 明显超越
  | 'excellent'  // L7 持续超越
  | 'unknown';   // 缺失值

export interface HeatmapColorEntry {
  readonly bg: string;
  readonly text: string;
}

export interface HeatmapColorScale {
  readonly light: Record<HeatmapTier, HeatmapColorEntry>;
  readonly dark: Record<HeatmapTier, HeatmapColorEntry>;
}

export interface HeatmapThresholdTier {
  readonly tier: HeatmapTier;
  /** value >= min 则匹配此档（从高到低遍历，第一个匹配即停；末档不设 min 兜底） */
  readonly min?: number;
}

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

// ==================== 标签与图例 ====================

export const HEATMAP_TIER_LABELS: Record<HeatmapTier, string> = {
  critical:  '危险',
  weak:      '偏弱',
  below:     '轻弱',
  normal:    '正常',
  above:     '轻强',
  strong:    '偏强',
  excellent: '优秀',
  unknown:   '无数据',
};

/** 图例用的有序列表（从差到好） */
export const HEATMAP_LEGEND_TIERS: readonly HeatmapTier[] = [
  'critical', 'weak', 'below', 'normal', 'above', 'strong', 'excellent',
];

// ==================== 分档函数 ====================

/** 根据阈值表将数值分到 7 级（阈值表从高到低排列，第一个 value >= min 即停） */
export function resolveTierByThresholds(
  value: number,
  thresholds: readonly HeatmapThresholdTier[],
): HeatmapTier {
  for (const { tier, min } of thresholds) {
    if (min === undefined || value >= min) return tier;
  }
  return 'critical';
}

/** 分位数切分点（6 刀切 7 段） */
export const HEATMAP_QUANTILE_CUTS: readonly number[] = [0.05, 0.20, 0.40, 0.60, 0.80, 0.95];

/** 从数值数组计算分位数切分值（内部排序副本，线性插值；空数组 → 全 0） */
export function computeQuantiles(
  values: readonly number[],
  cuts: readonly number[] = HEATMAP_QUANTILE_CUTS,
): readonly number[] {
  if (values.length === 0) return cuts.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  return cuts.map((q) => {
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  });
}

/** 件数类指标：按已排序样本池的动态分位数分 7 段（入参必须已升序，空池 → 'normal'） */
export function resolveTierByQuantile(value: number, sorted: readonly number[]): HeatmapTier {
  if (sorted.length === 0) return 'normal';
  const cuts = HEATMAP_QUANTILE_CUTS.map((q) => {
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  });
  const tiers: HeatmapTier[] = ['critical', 'weak', 'below', 'normal', 'above', 'strong', 'excellent'];
  let idx = 0;
  for (let i = 0; i < cuts.length; i++) {
    if (value >= cuts[i]) idx = i + 1;
  }
  return tiers[Math.min(idx, tiers.length - 1)];
}
