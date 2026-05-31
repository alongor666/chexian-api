/**
 * 漏斗迷你条 — 单行内直观暗示 应续A → 报价B → 已续C 的转化结构
 *
 * 三段：已续 C / 报价未续 B−C / 未报价 A−B（按 A 归一）。
 * 续保率低于健康线（坏行）时整条切红，强化「差一眼可见」。
 */
import { cn } from '@/shared/styles';
import { formatNum, formatPct } from '../utils/format';
import { isBadRow } from '../utils/grading';
import type { RenewalRow } from '../types';

interface Props {
  row: RenewalRow;
}

export default function FunnelBar({ row }: Props) {
  const a = row.A || 1;
  // clamp 到 [0,100]：防脏数据（C>A / B>A）导致段宽溢出、比例语义失真
  const cW = Math.min(100, Math.max(0, (row.C / a) * 100));
  const bW = Math.min(100, Math.max(0, ((row.B - row.C) / a) * 100));
  const aW = Math.min(100, Math.max(0, ((a - row.B) / a) * 100));
  const bad = isBadRow(row);

  const title = `已续 ${formatNum(row.C)} (${formatPct(row.C, row.A)}) / 报价 ${formatNum(row.B)} (${formatPct(
    row.B,
    row.A,
  )}) / 应续 ${formatNum(row.A)}`;

  return (
    <span
      className="inline-flex w-24 h-3 rounded-sm overflow-hidden bg-neutral-100 dark:bg-surface-3 border border-neutral-200 dark:border-subtle align-middle"
      title={title}
    >
      <span className={cn('block h-full', bad ? 'bg-danger' : 'bg-primary')} style={{ width: `${cW.toFixed(1)}%` }} />
      <span
        className={cn('block h-full', bad ? 'bg-danger-light' : 'bg-primary-border')}
        style={{ width: `${bW.toFixed(1)}%` }}
      />
      <span className="block h-full bg-neutral-200 dark:bg-white/10" style={{ width: `${aW.toFixed(1)}%` }} />
    </span>
  );
}
