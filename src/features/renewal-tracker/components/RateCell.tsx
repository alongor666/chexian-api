/**
 * 率单元格 — 数字 + 迷你进度条，按健康分级着色（续保率/报价率）
 *
 * 设计：率值右对齐等宽，下方一条 54px 迷你进度条直观传达「越高越好」。
 * 分母为 0 显示「—」，不上色。
 */
import { cn, colorClasses, fontStyles } from '@/shared/styles';
import { gradeRate, type Grade, type RateMetric } from '../utils/grading';

interface Props {
  metric: RateMetric;
  numerator: number;
  denominator: number;
}

const GRADE_TEXT: Record<Grade, string> = {
  g: colorClasses.text.neutralBlack,
  w: colorClasses.text.warningDark,
  d: colorClasses.text.dangerDark,
};

const GRADE_FILL: Record<Grade, string> = {
  g: 'bg-success',
  w: 'bg-warning',
  d: 'bg-danger',
};

export default function RateCell({ metric, numerator, denominator }: Props) {
  if (denominator <= 0) {
    return <span className={cn(fontStyles.numeric, colorClasses.text.neutralMuted)}>—</span>;
  }
  const rate = numerator / denominator;
  const grade = gradeRate(metric, rate);
  const pctText = (rate * 100).toFixed(1) + '%';
  const width = Math.max(4, Math.min(100, rate * 100));

  return (
    <span className="inline-flex flex-col items-end gap-1 min-w-[54px] align-middle">
      <span className={cn(fontStyles.numeric, 'font-semibold text-[13px] leading-none', GRADE_TEXT[grade])}>
        {pctText}
      </span>
      <span className="w-[54px] h-1 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
        <span className={cn('block h-full rounded-full', GRADE_FILL[grade])} style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}
