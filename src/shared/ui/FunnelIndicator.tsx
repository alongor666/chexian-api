/**
 * 轻量级漏斗指示器组件
 *
 * 用于直观展示续保漏斗转化：应续件数 → 报价件数 → 已续件数
 * 支持两种模式：compact（紧凑条形图）和 detailed（详细数值）
 */

import React from 'react';
import { cn, colorClasses } from '../styles';
import { formatCount } from '../utils/formatters';

// ============================================================================
// 类型定义
// ============================================================================

export interface FunnelIndicatorProps {
  /** 应续件数（漏斗基数） */
  dueCount: number;
  /** 报价件数 */
  quotedCount: number;
  /** 已续件数 */
  renewedCount: number;
  /** 显示模式：compact=紧凑条形图, detailed=详细数值 */
  mode?: 'compact' | 'detailed';
  /** 宽度 */
  width?: number | string;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 轻量级漏斗指示器
 *
 * 效果示例（compact模式）:
 * [████████░░░░] 67.4%
 *  ↑绿色已续  ↑橙色仅报价
 */
export const FunnelIndicator: React.FC<FunnelIndicatorProps> = ({
  dueCount,
  quotedCount,
  renewedCount,
  mode = 'compact',
  width = 80,
  className,
}) => {
  // 计算比率
  const renewalRate = dueCount > 0 ? renewedCount / dueCount : 0;
  const quoteRate = dueCount > 0 ? quotedCount / dueCount : 0;

  // 百分比显示
  const renewalPercent = Math.round(renewalRate * 1000) / 10;
  const quotePercent = Math.round(quoteRate * 1000) / 10;
  const onlyQuotedPercent = Math.round((quoteRate - renewalRate) * 1000) / 10;

  // 紧凑模式
  if (mode === 'compact') {
    return (
      <div
        className={cn('flex items-center gap-2', className)}
        title={`已续 ${renewedCount}件(${renewalPercent}%) | 仅报价 ${quotedCount - renewedCount}件 | 未报价 ${dueCount - quotedCount}件`}
      >
        {/* 漏斗条形图 */}
        <div
          className="h-3 bg-neutral-200 rounded-sm overflow-hidden flex"
          style={{ width: typeof width === 'number' ? `${width}px` : width }}
        >
          {/* 已续部分（绿色） */}
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${renewalPercent}%` }}
          />
          {/* 仅报价部分（橙色） */}
          {onlyQuotedPercent > 0 && (
            <div
              className="h-full bg-orange-400 transition-all duration-300"
              style={{ width: `${onlyQuotedPercent}%` }}
            />
          )}
          {/* 未报价部分（灰色，由背景色体现） */}
        </div>
        {/* 续保率数值 */}
        <span className={`text-xs font-mono tabular-nums whitespace-nowrap ${colorClasses.text.neutral}`}>
          {renewalPercent}%
        </span>
      </div>
    );
  }

  // 详细模式
  return (
    <div className={cn('space-y-1.5', className)}>
      {/* 漏斗流程 */}
      <div className="flex items-center gap-1 text-xs">
        <span className={colorClasses.text.neutral}>{formatCount(dueCount)}</span>
        <span className={colorClasses.text.neutralMuted}>→</span>
        <span className={colorClasses.text.orange}>{formatCount(quotedCount)}</span>
        <span className={`text-[10px] ${colorClasses.text.amber}`}>({quotePercent}%)</span>
        <span className={colorClasses.text.neutralMuted}>→</span>
        <span className={`font-semibold ${colorClasses.text.successDark}`}>{formatCount(renewedCount)}</span>
        <span className={`text-[10px] ${colorClasses.text.success}`}>({renewalPercent}%)</span>
      </div>

      {/* 进度条 */}
      <div className="h-2 bg-neutral-200 rounded-sm overflow-hidden flex">
        <div
          className="h-full bg-green-500"
          style={{ width: `${renewalPercent}%` }}
        />
        {onlyQuotedPercent > 0 && (
          <div
            className="h-full bg-orange-400"
            style={{ width: `${onlyQuotedPercent}%` }}
          />
        )}
      </div>

      {/* 图例 */}
      <div className={`flex items-center gap-3 text-[10px] ${colorClasses.text.neutralLight}`}>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-sm" />
          已续 {renewalPercent}%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-orange-400 rounded-sm" />
          仅报价 {onlyQuotedPercent > 0 ? onlyQuotedPercent : 0}%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-neutral-200 rounded-sm" />
          未报价
        </span>
      </div>
    </div>
  );
};

export default FunnelIndicator;
