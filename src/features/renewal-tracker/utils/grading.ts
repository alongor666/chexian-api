/**
 * 续保追踪 · 率值健康分级（「颜色即语义」）
 *
 * 续保率(C/A)：**直接复用全局 `getRenewalStatus` + `DEFAULT_RENEWAL_THRESHOLDS`**
 *   （healthy 0.60 / warning 0.56）——单一事实源，避免本页另维护一套阈值漂移。
 *   本页与全局徽章/KPI 漏斗对同一续保率的判色完全一致。
 *
 * 报价率(B/A)：全局无对应口径，保留本页唯一的本地阈值（healthy 0.74 / warning 0.70），
 *   但仍走全局 `getRenewalStatus` 的同一套分级逻辑，仅传入不同阈值。
 */
import type { RenewalRow, SortField, SortDir } from '../types';
import {
  getRenewalStatus,
  DEFAULT_RENEWAL_THRESHOLDS,
  type RenewalStatus,
  type RenewalThresholds,
} from '@/shared/ui/RenewalStatusBadge';

export type Grade = 'g' | 'w' | 'd';
export type RateMetric = 'quote' | 'renew';

/** 全局续保状态 → 本页 Grade 字母（g/w/d） */
const STATUS_TO_GRADE: Record<RenewalStatus, Grade> = {
  success: 'g',
  warning: 'w',
  danger: 'd',
};

/** 报价率阈值（本页专属，全局无报价率口径）。续保率不在此处——它用全局阈值。 */
const QUOTE_THRESHOLDS: RenewalThresholds = { healthy: 0.74, warning: 0.7 };

/** 续保率 C/A（0–1），分母为 0（无应续业务）返回 null */
export function renewRate(row: Pick<RenewalRow, 'A' | 'C'>): number | null {
  return row.A > 0 ? row.C / row.A : null;
}

/** 报价率 B/A（0–1），分母为 0 返回 null */
export function quoteRate(row: Pick<RenewalRow, 'A' | 'B'>): number | null {
  return row.A > 0 ? row.B / row.A : null;
}

/**
 * 对一个率值（0–1）评级 → g(good)/w(warn)/d(danger)。
 * 续保率走全局阈值，报价率走本页阈值，二者共用全局 `getRenewalStatus` 分级逻辑。
 * null（分母为 0）视为最差，但是否上色由调用方（如 RateCell 显示「—」）决定。
 */
export function gradeRate(metric: RateMetric, rate: number | null): Grade {
  if (rate == null) return 'd';
  const thresholds = metric === 'renew' ? DEFAULT_RENEWAL_THRESHOLDS : QUOTE_THRESHOLDS;
  return STATUS_TO_GRADE[getRenewalStatus(rate, thresholds)];
}

/** 行级评级：以续保率（核心健康指标）为准 */
export function rowGrade(row: RenewalRow): Grade {
  return gradeRate('renew', renewRate(row));
}

/**
 * 续保率低于 danger 线 → 该行为「坏行」，需高亮置顶。
 *
 * 零应续（A=0，无到期业务）不算坏行 —— 它是「无数据」而非「续保崩了」，
 * 与 RateCell 对 A=0 显示中性「—」的口径保持一致，避免把空口径误报成预警。
 */
export function isBadRow(row: RenewalRow): boolean {
  const rate = renewRate(row);
  return rate != null && gradeRate('renew', rate) === 'd';
}

/** 排序取值：率值列（D 报价率 / E 续保率）取比值，其余取件数 */
export function sortValue(row: RenewalRow, field: SortField): number {
  if (field === 'D') return row.A > 0 ? row.B / row.A : 0;
  if (field === 'E') return row.A > 0 ? row.C / row.A : 0;
  return row[field];
}

/**
 * 行比较器（升/降序）。零应续（A=0）行恒排在末尾——无数据不应冒充「最差」
 * 浮到升序顶部，也不应冒充「最大」占据降序顶部。
 */
export function compareRows(a: RenewalRow, b: RenewalRow, field: SortField, dir: SortDir): number {
  const za = a.A === 0;
  const zb = b.A === 0;
  if (za !== zb) return za ? 1 : -1;
  const va = sortValue(a, field);
  const vb = sortValue(b, field);
  return dir === 'desc' ? vb - va : va - vb;
}
