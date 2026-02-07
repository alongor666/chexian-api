/**
 * 预警徽章组件
 *
 * 用于在导航栏或标题栏显示预警数量
 *
 * @module AlertBadge
 * @author @claude
 * @since 2026-01-14
 */

import React from 'react';
import type { AlertSummary } from '../../shared/types/alert';

/** 组件属性 */
export interface AlertBadgeProps {
  /** 预警摘要 */
  summary: AlertSummary;
  /** 点击回调 */
  onClick?: () => void;
  /** 是否显示详细信息 */
  showDetail?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 预警徽章组件
 */
export const AlertBadge: React.FC<AlertBadgeProps> = ({
  summary,
  onClick,
  showDetail = false,
  className = '',
}) => {
  const hasAlerts = summary.total > 0;
  const hasCritical = summary.byLevel.critical > 0;
  const hasWarning = summary.byLevel.warning > 0;

  // 根据最高级别确定颜色
  const getBadgeColor = () => {
    if (hasCritical) return 'bg-red-500';
    if (hasWarning) return 'bg-yellow-500';
    if (hasAlerts) return 'bg-blue-500';
    return 'bg-gray-400';
  };

  // 显示的数字（未读数或总数）
  const displayCount = summary.unread > 0 ? summary.unread : summary.total;

  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
        hasAlerts ? 'hover:bg-gray-100' : 'opacity-60'
      } ${className}`}
      title={`${summary.total} 条预警，${summary.unread} 条未读`}
    >
      {/* 铃铛图标 */}
      <span className="text-lg relative">
        🔔
        {hasAlerts && (
          <span
            className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${getBadgeColor()} ${
              hasCritical ? 'animate-pulse' : ''
            }`}
          />
        )}
      </span>

      {/* 数字徽章 */}
      {displayCount > 0 && (
        <span
          className={`text-xs font-medium px-1.5 py-0.5 rounded-full text-white ${getBadgeColor()}`}
        >
          {displayCount > 99 ? '99+' : displayCount}
        </span>
      )}

      {/* 详细信息（可选） */}
      {showDetail && hasAlerts && (
        <span className="text-xs text-gray-500">
          {hasCritical && <span className="text-red-600">{summary.byLevel.critical}严重</span>}
          {hasCritical && hasWarning && <span className="mx-0.5">/</span>}
          {hasWarning && <span className="text-yellow-600">{summary.byLevel.warning}警告</span>}
        </span>
      )}
    </button>
  );
};

export default AlertBadge;
