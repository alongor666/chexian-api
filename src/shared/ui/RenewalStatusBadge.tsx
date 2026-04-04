/**
 * 续保率状态徽章组件
 *
 * 基于漏斗思维，聚焦件数续保率，建立红绿灯状态系统。
 * 阈值定义：≥60% 健康(绿) / 56%-60% 异常(黄) / <56% 危险(红)
 */

import React from 'react';
import { cn, colorClasses } from '../styles';

// ============================================================================
// 类型定义
// ============================================================================

export type RenewalStatus = 'success' | 'warning' | 'danger';

export interface RenewalStatusBadgeProps {
  /** 续保率 (0-1 格式，如 0.65 表示 65%) */
  rate: number;
  /** 显示模式：badge=圆角徽章, progress=进度条, dot=小圆点 */
  mode?: 'badge' | 'progress' | 'dot';
  /** 尺寸 */
  size?: 'small' | 'medium';
  /** 是否显示数值 */
  showValue?: boolean;
  /** 自定义阈值 */
  thresholds?: RenewalThresholds;
  /** 自定义类名 */
  className?: string;
}

export interface RenewalThresholds {
  /** 健康阈值（≥此值为绿色） */
  healthy: number;
  /** 警告阈值（≥此值且<健康阈值为黄色） */
  warning: number;
}

// ============================================================================
// 常量定义
// ============================================================================

/** 默认续保率阈值 */
export const DEFAULT_RENEWAL_THRESHOLDS: RenewalThresholds = {
  healthy: 0.60, // ≥60% 绿色
  warning: 0.56, // 56%-60% 黄色
  // <56% 红色
};

/** 状态配色 */
const STATUS_COLORS = {
  success: {
    bg: colorClasses.bg.success,
    border: colorClasses.border.success,
    text: colorClasses.text.successDark,
    dot: 'bg-green-500',
    progressBg: 'bg-green-500',
    label: '健康',
  },
  warning: {
    bg: colorClasses.bg.warning,
    border: colorClasses.border.warning,
    text: colorClasses.text.warningDark,
    dot: 'bg-yellow-500',
    progressBg: 'bg-yellow-500',
    label: '异常',
  },
  danger: {
    bg: colorClasses.bg.danger,
    border: colorClasses.border.danger,
    text: colorClasses.text.dangerDark,
    dot: 'bg-red-500',
    progressBg: 'bg-red-500',
    label: '危险',
  },
} as const;

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 根据续保率获取状态
 * @param rate 续保率 (0-1 格式)
 * @param thresholds 阈值配置
 */
export function getRenewalStatus(
  rate: number,
  thresholds: RenewalThresholds = DEFAULT_RENEWAL_THRESHOLDS
): RenewalStatus {
  if (rate >= thresholds.healthy) return 'success';
  if (rate >= thresholds.warning) return 'warning';
  return 'danger';
}

/**
 * 获取续保率对应的表格行背景色类名
 * @param rate 续保率 (0-1 格式)
 * @param thresholds 阈值配置
 */
export function getRenewalRowBgClass(
  rate: number,
  thresholds: RenewalThresholds = DEFAULT_RENEWAL_THRESHOLDS
): string {
  const status = getRenewalStatus(rate, thresholds);
  switch (status) {
    case 'success':
      return 'bg-success-bg/50';
    case 'warning':
      return 'bg-warning-bg/50';
    case 'danger':
      return 'bg-danger-bg/50';
    default:
      return '';
  }
}

/**
 * 获取状态标签文本
 */
export function getRenewalStatusLabel(status: RenewalStatus): string {
  return STATUS_COLORS[status].label;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 续保率状态徽章
 */
export const RenewalStatusBadge: React.FC<RenewalStatusBadgeProps> = ({
  rate,
  mode = 'badge',
  size = 'medium',
  showValue = true,
  thresholds = DEFAULT_RENEWAL_THRESHOLDS,
  className,
}) => {
  const status = getRenewalStatus(rate, thresholds);
  const colors = STATUS_COLORS[status];
  const percentage = Math.round(rate * 1000) / 10; // 保留1位小数

  // 小圆点模式
  if (mode === 'dot') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5',
          className
        )}
        title={`${percentage}% - ${colors.label}`}
      >
        <span
          className={cn(
            'rounded-full',
            colors.dot,
            size === 'small' ? 'w-1.5 h-1.5' : 'w-2 h-2'
          )}
        />
        {showValue && (
          <span className={cn(
            'font-mono tabular-nums',
            colors.text,
            size === 'small' ? 'text-xs' : 'text-sm'
          )}>
            {percentage}%
          </span>
        )}
      </span>
    );
  }

  // 进度条模式
  if (mode === 'progress') {
    return (
      <div className={cn('w-full', className)}>
        <div className="flex items-center justify-between mb-1">
          {showValue && (
            <span className={cn(
              'font-mono tabular-nums font-semibold',
              colors.text,
              size === 'small' ? 'text-xs' : 'text-sm'
            )}>
              {percentage}%
            </span>
          )}
          <span className={cn(
            colors.text,
            size === 'small' ? 'text-xs' : 'text-sm'
          )}>
            {colors.label}
          </span>
        </div>
        <div className={cn(
          'w-full bg-neutral-200 rounded-full overflow-hidden',
          size === 'small' ? 'h-1.5' : 'h-2'
        )}>
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              colors.progressBg
            )}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
    );
  }

  // 徽章模式（默认）
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        colors.bg,
        colors.border,
        colors.text,
        size === 'small' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-sm',
        className
      )}
    >
      <span
        className={cn(
          'rounded-full',
          colors.dot,
          size === 'small' ? 'w-1.5 h-1.5' : 'w-2 h-2'
        )}
      />
      {showValue ? (
        <span className="font-mono tabular-nums">{percentage}%</span>
      ) : (
        <span>{colors.label}</span>
      )}
    </span>
  );
};

export default RenewalStatusBadge;
