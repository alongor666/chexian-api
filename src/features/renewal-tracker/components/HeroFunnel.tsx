/**
 * 大漏斗 — 应续A → 报价B → 已续C 的横向阶梯条（概览带专用）
 *
 * 三级递减条按 A 归一，右侧标注报价率/续保率，强化漏斗式收口的视觉暗示。
 */
import { cn, fontStyles, colorClasses } from '@/shared/styles';
import { formatNum, formatPct } from '../utils/format';
import type { RenewalRow } from '../types';

interface Props {
  row: RenewalRow;
}

interface Step {
  label: string;
  value: number;
  width: number;
  bar: string;
  text: string;
  note: string;
}

export default function HeroFunnel({ row }: Props) {
  const a = row.A || 1;
  const steps: Step[] = [
    { label: '应续 A', value: row.A, width: 100, bar: 'bg-neutral-400 dark:bg-neutral-500', text: 'text-white', note: '基准 100%' },
    {
      label: '报价 B',
      value: row.B,
      width: (row.B / a) * 100,
      bar: 'bg-primary-border',
      text: colorClasses.text.primaryDark,
      note: `报价率 ${formatPct(row.B, row.A)}`,
    },
    {
      label: '已续 C',
      value: row.C,
      width: (row.C / a) * 100,
      bar: 'bg-primary',
      text: 'text-white',
      note: `续保率 ${formatPct(row.C, row.A)}`,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map(s => (
        <div key={s.label} className="grid grid-cols-[64px_1fr_auto] items-center gap-3">
          <span className={cn('text-xs', colorClasses.text.neutralLight)}>{s.label}</span>
          <div
            className={cn('h-6 rounded-md flex items-center pl-2.5 text-xs font-semibold whitespace-nowrap', s.bar, s.text, fontStyles.numeric)}
            style={{ width: `${Math.max(16, s.width).toFixed(1)}%` }}
          >
            {formatNum(s.value)}
          </div>
          <span className={cn('text-xs text-right min-w-[80px]', fontStyles.numeric, colorClasses.text.neutralLight)}>
            {s.note}
          </span>
        </div>
      ))}
    </div>
  );
}
