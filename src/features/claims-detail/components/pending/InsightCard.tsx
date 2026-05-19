/**
 * 未决赔案监控 — 智能洞察卡片
 * 严重度标签 + 标题 + 解释正文 + 单一关键指标
 */
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { cardStyles, cn, colorClasses } from '@/shared/styles';
import { severityToColor } from './insights';
import type { Insight } from './types';

const ICON_MAP = {
  alert: AlertTriangle,
  clock: Clock,
  activity: Activity,
  check: CheckCircle2,
} as const;

export function InsightCard({ insight }: { insight: Insight }) {
  const c = severityToColor(insight.severity);
  const IconCmp = ICON_MAP[insight.iconKey];
  const tagLabel =
    insight.severity === 'bad'
      ? '异常'
      : insight.severity === 'warn'
        ? '关注'
        : '正常';
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
          <IconCmp size={11} />
          {tagLabel}
        </span>
      </div>
      <div className={cn('text-sm font-semibold mb-1', colorClasses.text.neutralBlack)}>
        {insight.title}
      </div>
      <div
        className={cn(
          'text-xs leading-relaxed flex-1 mb-3',
          colorClasses.text.neutralDark,
        )}
      >
        {insight.body}
      </div>
      <div className="flex items-end justify-between pt-2.5 border-t border-dashed border-neutral-200 dark:border-subtle">
        <div>
          <div className={cn('font-numeric tabular-nums text-xl font-bold', c.text)}>
            {insight.metricValue}
          </div>
          <div className={cn('text-[10px]', colorClasses.text.neutralMuted)}>
            {insight.metricLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
