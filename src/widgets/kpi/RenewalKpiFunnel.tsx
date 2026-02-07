/**
 * 续保漏斗 KPI 卡片组件
 *
 * 用流程图式展示续保漏斗：应续件数 → 报价 → 成功续保
 * 替代原有6个独立KPI卡片，聚焦件数续保率。
 *
 * 效果示例：
 * ┌────────────────────────────────────────────────────────────┐
 * │  应续件数        报价率         报价件数       转化率        已续件数    │
 * │   3,477    ───92.8%───>    3,227   ───72.6%───>   2,343    │
 * │                                                             │
 * │              最终续保率: 67.4% [健康 ✓]                       │
 * └────────────────────────────────────────────────────────────┘
 */

import React from 'react';
import { cn } from '../../shared/styles';
import { formatCount } from '../../shared/utils/formatters';
import {
  RenewalStatusBadge,
  getRenewalStatus,
  getRenewalStatusLabel,
  type RenewalThresholds,
  DEFAULT_RENEWAL_THRESHOLDS,
} from '../../shared/ui/RenewalStatusBadge';

// ============================================================================
// 类型定义
// ============================================================================

export interface RenewalKpiFunnelProps {
  /** 应续件数 */
  dueCount: number;
  /** 报价件数 */
  quotedCount: number;
  /** 已续件数 */
  renewedCount: number;
  /** 自定义阈值 */
  thresholds?: RenewalThresholds;
  /** 加载状态 */
  loading?: boolean;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 子组件
// ============================================================================

/** 漏斗数值节点 */
const FunnelNode: React.FC<{
  label: string;
  value: number;
  highlight?: boolean;
  color?: string;
}> = ({ label, value, highlight, color }) => (
  <div className="flex flex-col items-center">
    <span className="text-xs text-neutral-500 mb-1">{label}</span>
    <span
      className={cn(
        'text-xl font-bold font-mono tabular-nums',
        highlight ? color || 'text-green-600' : 'text-neutral-800'
      )}
    >
      {formatCount(value)}
    </span>
  </div>
);

/** 漏斗转化箭头 */
const FunnelArrow: React.FC<{
  rate: number;
  label?: string;
  color?: string;
}> = ({ rate, label, color = 'text-neutral-400' }) => {
  const percent = Math.round(rate * 1000) / 10;
  return (
    <div className="flex flex-col items-center px-2">
      <span className="text-[10px] text-neutral-400 mb-0.5">{label || '转化率'}</span>
      <div className="flex items-center gap-1">
        <span className="text-neutral-300">─</span>
        <span className={cn('text-xs font-semibold font-mono tabular-nums', color)}>
          {percent}%
        </span>
        <span className="text-neutral-300">→</span>
      </div>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

/**
 * 续保漏斗 KPI 卡片
 */
export const RenewalKpiFunnel: React.FC<RenewalKpiFunnelProps> = ({
  dueCount,
  quotedCount,
  renewedCount,
  thresholds = DEFAULT_RENEWAL_THRESHOLDS,
  loading = false,
  className,
}) => {
  // 计算比率
  const quoteRate = dueCount > 0 ? quotedCount / dueCount : 0;
  const conversionRate = quotedCount > 0 ? renewedCount / quotedCount : 0;
  const renewalRate = dueCount > 0 ? renewedCount / dueCount : 0;

  // 获取状态
  const status = getRenewalStatus(renewalRate, thresholds);
  const statusLabel = getRenewalStatusLabel(status);

  // 状态颜色映射
  const statusColors = {
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger: 'text-red-600',
  };

  if (loading) {
    return (
      <div className={cn(
        'bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm p-4',
        className
      )}>
        <div className="animate-pulse">
          <div className="h-4 bg-neutral-200 rounded w-24 mb-4" />
          <div className="flex items-center justify-center gap-4">
            <div className="h-12 w-16 bg-neutral-200 rounded" />
            <div className="h-4 w-12 bg-neutral-200 rounded" />
            <div className="h-12 w-16 bg-neutral-200 rounded" />
            <div className="h-4 w-12 bg-neutral-200 rounded" />
            <div className="h-12 w-16 bg-neutral-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm p-4',
      className
    )}>
      {/* 标题 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          续保漏斗（件数）
        </h3>
        <RenewalStatusBadge
          rate={renewalRate}
          mode="badge"
          size="small"
          showValue={false}
          thresholds={thresholds}
        />
      </div>

      {/* 漏斗流程图 */}
      <div className="flex items-center justify-center flex-wrap gap-y-2">
        {/* 应续件数 */}
        <FunnelNode label="应续件数" value={dueCount} />

        {/* 报价率箭头 */}
        <FunnelArrow rate={quoteRate} label="报价率" color="text-orange-500" />

        {/* 报价件数 */}
        <FunnelNode label="报价件数" value={quotedCount} color="text-orange-600" />

        {/* 转化率箭头 */}
        <FunnelArrow rate={conversionRate} label="转化率" color="text-blue-500" />

        {/* 已续件数 */}
        <FunnelNode label="已续件数" value={renewedCount} highlight color="text-green-600" />
      </div>

      {/* 最终续保率 */}
      <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-700">
        <div className="flex items-center justify-center gap-3">
          <span className="text-sm text-neutral-500">最终续保率</span>
          <span className={cn(
            'text-2xl font-bold font-mono tabular-nums',
            statusColors[status]
          )}>
            {Math.round(renewalRate * 1000) / 10}%
          </span>
          <span className={cn(
            'px-2 py-0.5 rounded text-xs font-medium',
            status === 'success' && 'bg-green-100 text-green-700',
            status === 'warning' && 'bg-yellow-100 text-yellow-700',
            status === 'danger' && 'bg-red-100 text-red-700'
          )}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* 阈值说明 */}
      <div className="mt-2 text-center">
        <span className="text-[10px] text-neutral-400">
          阈值: ≥{thresholds.healthy * 100}% 健康 | {thresholds.warning * 100}%-{thresholds.healthy * 100}% 异常 | &lt;{thresholds.warning * 100}% 危险
        </span>
      </div>
    </div>
  );
};

export default RenewalKpiFunnel;
