/**
 * KPI 状态引擎
 *
 * 根据「值 / 阈值 / 反向指标」判定 KPI 状态：达标 / 接近 / 落后（或健康 / 接近 / 超标）。
 * 用于卡片左侧 status rail、status tag（✓ / !）与 delta 涨跌色逻辑。
 *
 * 设计简报 §3 法则 3：状态预注意编码（color + shape + 文案，不单靠颜色）
 *
 * 阈值参考：
 * - 保费进度：99%（达成率 ≥99% 为达标）
 * - 变动成本率：91%（≤91% 为健康）
 * - 综合成本率：91%（≤91% 为健康）
 */

/** 四种状态 key */
export type KpiStatusKey = 'good' | 'warn' | 'bad' | 'neutral';

/** 状态色调（沿用项目语义色） */
export type StatusTone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

/** 文案标签 */
export interface KpiStatus {
  key: KpiStatusKey;
  tone: StatusTone;
  label: string;
  /** ✓ 或 ! 标记（兼容色盲） */
  mark: '' | '✓' | '!';
}

const NEUTRAL: KpiStatus = { key: 'neutral', tone: 'neutral', label: '', mark: '' };

interface StatusInput {
  /** 当前值（百分数形式：94.8 = 94.8%） */
  value: number | null | undefined;
  /** 阈值（同上） */
  threshold?: number | null;
  /** 反向指标：true=值越小越好（成本/赔付率），false=值越大越好（达成/增长） */
  reverse?: boolean;
  /** 接近阈值的预警带宽（默认 3pt） */
  warnBand?: number;
}

/**
 * 计算 KPI 状态
 */
export function statusFor({
  value,
  threshold,
  reverse = false,
  warnBand = 3,
}: StatusInput): KpiStatus {
  if (value == null || threshold == null) return NEUTRAL;

  if (!reverse) {
    // 正向指标：达成率 / 增长率 — 越高越好
    if (value >= threshold) return { key: 'good', tone: 'success', label: '达标', mark: '✓' };
    if (value >= threshold - warnBand)
      return { key: 'warn', tone: 'warning', label: '接近', mark: '!' };
    return { key: 'bad', tone: 'danger', label: '落后', mark: '!' };
  }
  // 反向指标：成本率 / 赔付率 — 越低越好
  if (value <= threshold - warnBand)
    return { key: 'good', tone: 'success', label: '健康', mark: '✓' };
  if (value <= threshold) return { key: 'warn', tone: 'warning', label: '接近', mark: '!' };
  return { key: 'bad', tone: 'danger', label: '超标', mark: '!' };
}

/**
 * Delta 涨跌色（反向指标涨红跌绿）— 设计简报 §6
 */
export function deltaTone(
  delta: number | null | undefined,
  reverse = false
): StatusTone {
  if (delta == null || delta === 0) return 'neutral';
  const positive = delta > 0;
  const isGood = reverse ? !positive : positive;
  return isGood ? 'success' : 'danger';
}

/**
 * 给定 status tone，返回对应的 CSS 变量字符串（用于 style 内联）
 * 项目走 CSS 变量自动适配 dark mode
 */
export const TONE_VAR = {
  text: {
    success: 'var(--c-success-solid)',
    warning: 'var(--c-warning-solid)',
    danger: 'var(--c-danger-solid)',
    primary: 'var(--c-primary-solid)',
    neutral: 'currentColor',
  },
  bg: {
    success: 'var(--c-success-bg)',
    warning: 'var(--c-warning-bg)',
    danger: 'var(--c-danger-bg)',
    primary: 'var(--c-primary-bg)',
    neutral: 'transparent',
  },
  solid: {
    success: 'var(--c-success)',
    warning: 'var(--c-warning)',
    danger: 'var(--c-danger)',
    primary: 'var(--c-primary)',
    neutral: 'transparent',
  },
} as const;
