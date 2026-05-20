/**
 * 共享智能洞察卡片 — 整个 claims-detail 域复用
 *
 * 与 Tab 各自的 iconKey 解耦：调用方把 iconKey 映射为 LucideIcon 组件后再传入，
 * 这样 shared 层不需要知道 Tab 1/2/3 的图标枚举。
 */
import type { LucideIcon } from 'lucide-react';
import { cardStyles, cn, colorClasses } from '@/shared/styles';
import { severityToColor, type Severity } from './severity';

interface InsightCardProps {
  severity: Severity;
  icon: LucideIcon;
  title: string;
  body: string;
  metricValue: string;
  metricLabel: string;
}

export function InsightCard({
  severity,
  icon: Icon,
  title,
  body,
  metricValue,
  metricLabel,
}: InsightCardProps) {
  const c = severityToColor(severity);
  const tagLabel =
    severity === 'bad'
      ? '异常'
      : severity === 'warn'
        ? '关注'
        : severity === 'good'
          ? '正常'
          : '暂无';
  return (
    <div
      className={cn(cardStyles.standard, 'relative overflow-hidden p-4 flex flex-col')}
    >
      <div className={cn('absolute left-0 right-0 top-0 h-0.5', c.ring)} aria-hidden />
      <div className="flex items-center justify-between mb-2.5">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold',
            c.bg,
            c.text,
          )}
        >
          <Icon size={11} />
          {tagLabel}
        </span>
      </div>
      <div className={cn('text-sm font-semibold mb-1', colorClasses.text.neutralBlack)}>
        {title}
      </div>
      <div
        className={cn(
          'text-xs leading-relaxed flex-1 mb-3',
          colorClasses.text.neutralDark,
        )}
      >
        {body}
      </div>
      <div className="flex items-end justify-between pt-2.5 border-t border-dashed border-neutral-200 dark:border-subtle">
        <div>
          <div className={cn('font-numeric tabular-nums text-xl font-bold', c.text)}>
            {metricValue}
          </div>
          <div className={cn('text-[10px]', colorClasses.text.neutralMuted)}>
            {metricLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
