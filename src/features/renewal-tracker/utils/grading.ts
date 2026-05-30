/**
 * 续保追踪 · 率值健康分级（来自重设计简报「颜色即语义」）
 *
 * 健康阈值（率，越高越好）——续保率为核心健康指标，报价率为触达/跟进：
 *   续保率(C/A)  warn < 62%   danger < 58%
 *   报价率(B/A)  warn < 74%   danger < 70%
 *
 * 注：本页阈值为「续保追踪看板」专属设计口径，集中于此便于后续与业务对齐调整；
 * 与全局 RenewalStatusBadge 的默认阈值（60/56）刻意分离，互不影响。
 */
import type { RenewalRow } from '../types';

export type Grade = 'g' | 'w' | 'd';
export type RateMetric = 'quote' | 'renew';

interface Threshold {
  warn: number;
  danger: number;
}

/** 阈值以「小数率」表示（0–1） */
export const THRESHOLDS: Record<RateMetric, Threshold> = {
  renew: { warn: 0.62, danger: 0.58 },
  quote: { warn: 0.74, danger: 0.7 },
};

/** 续保率 C/A（0–1），分母为 0 返回 null */
export function renewRate(row: Pick<RenewalRow, 'A' | 'C'>): number | null {
  return row.A > 0 ? row.C / row.A : null;
}

/** 报价率 B/A（0–1），分母为 0 返回 null */
export function quoteRate(row: Pick<RenewalRow, 'A' | 'B'>): number | null {
  return row.A > 0 ? row.B / row.A : null;
}

/** 对一个率值（0–1）评级 → g(good)/w(warn)/d(danger)；null 视为最差但不上色由调用方处理 */
export function gradeRate(metric: RateMetric, rate: number | null): Grade {
  if (rate == null) return 'd';
  const t = THRESHOLDS[metric];
  if (rate < t.danger) return 'd';
  if (rate < t.warn) return 'w';
  return 'g';
}

/** 行级评级：以续保率（核心健康指标）为准 */
export function rowGrade(row: RenewalRow): Grade {
  return gradeRate('renew', renewRate(row));
}

/** 续保率低于 danger 线 → 该行为「坏行」，需高亮置顶 */
export function isBadRow(row: RenewalRow): boolean {
  return rowGrade(row) === 'd';
}
