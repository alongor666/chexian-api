/**
 * 未决赔案监控 — KPI 卡片
 * 左边色条 (severity tone) + 状态点 + 主值 + 辅助文字 + 上下文 hint
 */
import { Info } from 'lucide-react';
import {
  cardStyles,
  cn,
  colorClasses,
  numericStyles,
} from '@/shared/styles';
import { StatusDot } from './atoms';
import { severityToColor } from './insights';
import type { Severity } from './types';

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  hint?: string;
  severity: Severity;
}

export function KpiCard({ label, value, unit, sub, hint, severity }: KpiCardProps) {
  const c = severityToColor(severity);
  return (
    <div className={cn(cardStyles.standard, 'relative overflow-hidden p-5')}>
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', c.ring)} aria-hidden />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusDot severity={severity} />
          <span className={cn('text-xs font-medium', colorClasses.text.neutralDark)}>
            {label}
          </span>
        </div>
      </div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className={numericStyles.kpiPrimary}>{value}</span>
        {unit && (
          <span className={cn('text-sm', colorClasses.text.neutralLight)}>{unit}</span>
        )}
      </div>
      {sub && (
        <div className={cn('text-xs mb-3', colorClasses.text.neutralMuted)}>{sub}</div>
      )}
      {hint && (
        <div
          className={cn(
            'flex items-start gap-1.5 text-xs leading-snug',
            colorClasses.text.neutralDark,
          )}
        >
          <Info
            size={12}
            className={cn('mt-0.5 shrink-0', colorClasses.text.neutralMuted)}
          />
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}
