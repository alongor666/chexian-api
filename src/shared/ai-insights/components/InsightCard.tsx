/**
 * 洞察卡片组件
 *
 * 展示单条 AI 洞察，包含类型图标、优先级徽章和描述
 */

import { memo } from 'react';
import type { Insight, InsightType } from '../types';
import { cn, getTrendColorClassByPolarity, getTrendDirection, colorClasses } from '../../styles';

interface InsightCardProps {
  insight: Insight;
  className?: string;
}

/**
 * 类型图标配置
 */
const typeConfig: Record<InsightType, { icon: string; label: string; colorClass: string }> = {
  warning: {
    icon: '⚠️',
    label: '告警',
    colorClass: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300',
  },
  opportunity: {
    icon: '💡',
    label: '机会',
    colorClass: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300',
  },
  highlight: {
    icon: '⭐',
    label: '亮点',
    colorClass: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300',
  },
  trend: {
    icon: '📈',
    label: '趋势',
    colorClass: 'bg-purple-50 border-purple-200 text-purple-800 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300',
  },
  action: {
    icon: '🎯',
    label: '行动',
    colorClass: 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300',
  },
};

/**
 * 优先级徽章配置
 */
const priorityConfig: Record<'high' | 'medium' | 'low', { label: string; colorClass: string }> = {
  high: {
    label: '高',
    colorClass: 'bg-red-500 text-white',
  },
  medium: {
    label: '中',
    colorClass: 'bg-yellow-500 text-white',
  },
  low: {
    label: '低',
    colorClass: 'bg-gray-400 text-white',
  },
};

/**
 * 洞察卡片组件
 */
export const InsightCard = memo(function InsightCard({ insight, className }: InsightCardProps) {
  const typeInfo = typeConfig[insight.type];
  const priorityInfo = priorityConfig[insight.priority];
  const metricDelta = insight.metric?.delta;
  const metricPolarity = insight.metric?.metricPolarity ?? 'positive';
  const deltaTextClass = metricDelta === undefined
    ? colorClasses.text.neutralMuted
    : getTrendColorClassByPolarity(getTrendDirection(metricDelta), metricPolarity);
  const deltaArrow = metricDelta === undefined
    ? ''
    : metricDelta > 0
      ? '↑'
      : metricDelta < 0
        ? '↓'
        : '—';
  const deltaPrefix = metricDelta !== undefined && metricDelta > 0 ? '+' : '';

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors',
        typeInfo.colorClass,
        className
      )}
    >
      {/* 头部：类型图标 + 标题 + 优先级 */}
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0" role="img" aria-label={typeInfo.label}>
          {typeInfo.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm truncate">{insight.title}</h4>
            <span
              className={cn(
                'px-1.5 py-0.5 text-xs font-medium rounded flex-shrink-0',
                priorityInfo.colorClass
              )}
            >
              {priorityInfo.label}
            </span>
          </div>
          {/* 描述 */}
          <p className="mt-1 text-xs opacity-90">{insight.description}</p>
        </div>
      </div>

      {/* 指标信息 */}
      {insight.metric && (
        <div className="mt-2 pt-2 border-t border-current/10">
          <div className="flex items-center gap-4 text-xs">
            <span className="font-medium">{insight.metric.name}:</span>
            <span className="font-mono font-semibold">{insight.metric.value}</span>
            {metricDelta !== undefined && (
              <span className={cn('font-mono font-semibold', deltaTextClass)}>
                {deltaArrow} {deltaPrefix}{metricDelta}
              </span>
            )}
            {insight.metric.benchmark && (
              <span className="opacity-70">基准: {insight.metric.benchmark}</span>
            )}
          </div>
        </div>
      )}

      {/* 受影响实体 */}
      {insight.affectedEntities && insight.affectedEntities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {insight.affectedEntities.slice(0, 5).map((entity, idx) => (
            <span
              key={idx}
              className="px-1.5 py-0.5 text-xs rounded bg-white/50 dark:bg-black/20"
            >
              {entity}
            </span>
          ))}
          {insight.affectedEntities.length > 5 && (
            <span className="px-1.5 py-0.5 text-xs opacity-70">
              +{insight.affectedEntities.length - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default InsightCard;
