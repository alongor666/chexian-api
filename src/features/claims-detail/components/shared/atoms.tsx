/**
 * 未决赔案监控 — 小型可复用原子组件
 * StatusPill / StatusDot / RiskBar / HeroMetric / SectionHeader
 */
import React from 'react';
import { cn, colorClasses, numericStyles } from '@/shared/styles';
import { severityToColor, type Severity } from './severity';

export function StatusPill({
  severity,
  label,
}: {
  severity: Severity;
  label: string;
}) {
  const c = severityToColor(severity);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
        c.bg,
        c.text,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', c.ring)} />
      {label}
    </span>
  );
}

export function StatusDot({ severity }: { severity: Severity }) {
  const c = severityToColor(severity);
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full', c.ring)}
      style={{ boxShadow: '0 0 0 3px rgba(0,0,0,0.04)' }}
    />
  );
}

export function RiskBar({ severity }: { severity: Severity }) {
  const dots =
    severity === 'bad' ? 3 : severity === 'warn' ? 2 : severity === 'good' ? 1 : 0;
  const label =
    severity === 'bad'
      ? '高'
      : severity === 'warn'
        ? '中'
        : severity === 'good'
          ? '低'
          : '—';
  const c = severityToColor(severity);
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <span className="inline-flex gap-0.5">
        {[1, 2, 3].map(n => (
          <span
            key={n}
            className={cn(
              'w-1 h-3 rounded-sm',
              n <= dots ? c.ring : 'bg-neutral-200 dark:bg-surface-3',
            )}
          />
        ))}
      </span>
      <span className={cn('text-xs font-semibold', c.text)}>{label}</span>
    </span>
  );
}

interface HeroMetricProps {
  label: string;
  value: string;
  unit: string;
  severity: Severity;
  badge?: string;
}

export function HeroMetric({ label, value, unit, severity, badge }: HeroMetricProps) {
  const c = severityToColor(severity);
  return (
    <div>
      <div className={cn('text-xs mb-1', colorClasses.text.neutralMuted)}>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={numericStyles.kpiSecondary}>{value}</span>
        <span className={cn('text-xs', colorClasses.text.neutralLight)}>{unit}</span>
      </div>
      {badge && (
        <span
          className={cn(
            'inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded font-semibold',
            c.bg,
            c.text,
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

interface SectionHeaderProps {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  sub?: string;
  rightExtra?: React.ReactNode;
  inline?: boolean;
}

export function SectionHeader({
  icon: IconCmp,
  title,
  sub,
  rightExtra,
  inline,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between', inline ? 'mb-3' : 'mb-4')}>
      <div className="flex items-center gap-2.5">
        {IconCmp && (
          <span
            className={cn(
              'inline-flex items-center justify-center w-7 h-7 rounded-lg',
              colorClasses.bg.primary,
              colorClasses.text.primary,
            )}
          >
            <IconCmp size={14} />
          </span>
        )}
        <div>
          <h3 className={cn('text-sm font-semibold', colorClasses.text.neutralBlack)}>
            {title}
          </h3>
          {sub && (
            <div className={cn('text-xs mt-0.5', colorClasses.text.neutralMuted)}>
              {sub}
            </div>
          )}
        </div>
      </div>
      {rightExtra}
    </div>
  );
}

