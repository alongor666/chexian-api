/**
 * 预警面板组件
 *
 * @module AlertPanel
 * @author @claude
 * @since 2026-01-14
 */

import React, { useState } from 'react';
import type { AlertMessage, AlertLevel, AlertSummary } from '../../shared/types/alert';
import { ALERT_LEVEL_CONFIG, ALERT_TYPE_CONFIG } from '../../shared/types/alert';

/** 组件属性 */
export interface AlertPanelProps {
  /** 预警消息列表 */
  alerts: AlertMessage[];
  /** 预警摘要 */
  summary: AlertSummary;
  /** 加载状态 */
  loading?: boolean;
  /** 刷新回调 */
  onRefresh?: () => void;
  /** 标记已读回调 */
  onMarkAsRead?: (alertId: string) => void;
  /** 标记全部已读回调 */
  onMarkAllAsRead?: () => void;
  /** 标记已处理回调 */
  onMarkAsResolved?: (alertId: string) => void;
  /** 是否折叠显示（默认展开） */
  collapsed?: boolean;
  /** 折叠状态变化回调 */
  onCollapsedChange?: (collapsed: boolean) => void;
}

/** 预警项组件 */
const AlertItem: React.FC<{
  alert: AlertMessage;
  onMarkAsRead?: (id: string) => void;
  onMarkAsResolved?: (id: string) => void;
}> = ({ alert, onMarkAsRead, onMarkAsResolved }) => {
  const levelConfig = ALERT_LEVEL_CONFIG[alert.level];
  const typeConfig = ALERT_TYPE_CONFIG[alert.type];

  return (
    <div
      className={`p-3 rounded-lg border ${levelConfig.bgColor} ${alert.read ? 'opacity-70' : ''
        } ${alert.resolved ? 'line-through opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-lg">{levelConfig.icon}</span>
            <span className={`font-semibold tracking-tight ${levelConfig.color}`}>
              {alert.title}
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-md text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700">
              {typeConfig.label}
            </span>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 ml-8 leading-relaxed">{alert.description}</p>
          {alert.dimension && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 ml-8 mt-1.5 font-medium">
              维度: {alert.dimension}
            </p>
          )}
          <p className="text-xs text-neutral-400 dark:text-neutral-500 ml-8 mt-1 font-mono">
            {new Date(alert.timestamp).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 mt-1">
          {!alert.read && onMarkAsRead && (
            <button
              onClick={() => onMarkAsRead(alert.id)}
              className="text-xs font-medium px-2.5 py-1 text-primary hover:bg-primary-bg dark:hover:bg-blue-900/20 rounded-md transition-colors"
              title="标记已读"
            >
              已读
            </button>
          )}
          {!alert.resolved && onMarkAsResolved && (
            <button
              onClick={() => onMarkAsResolved(alert.id)}
              className="text-xs font-medium px-2.5 py-1 text-success dark:text-success-light hover:bg-success-bg dark:hover:bg-green-900/20 rounded-md transition-colors"
              title="标记已处理"
            >
              处理
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** 摘要卡片 */
const SummaryCard: React.FC<{
  level: AlertLevel;
  count: number;
}> = ({ level, count }) => {
  const config = ALERT_LEVEL_CONFIG[level];
  return (
    <div className={`px-3 py-2.5 rounded-lg border border-transparent hover:border-current transition-colors ${config.bgColor} text-center`}>
      <div className="text-[22px] mb-1">{config.icon}</div>
      <div className={`text-2xl font-bold tracking-tight font-sans ${config.color}`}>{count}</div>
      <div className={`text-[11px] font-medium mt-0.5 ${config.color} opacity-80`}>{config.label}</div>
    </div>
  );
};

/** 筛选标签 */
type FilterType = 'all' | AlertLevel | 'unread';

/**
 * 预警面板组件
 */
export const AlertPanel: React.FC<AlertPanelProps> = ({
  alerts,
  summary,
  loading = false,
  onRefresh,
  onMarkAsRead,
  onMarkAllAsRead,
  onMarkAsResolved,
  collapsed = false,
  onCollapsedChange,
}) => {
  const [filter, setFilter] = useState<FilterType>('all');

  // 筛选预警
  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !alert.read;
    return alert.level === filter;
  });

  // 过滤按钮
  const filterButtons: { key: FilterType; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: summary.total },
    { key: 'critical', label: '严重', count: summary.byLevel.critical },
    { key: 'warning', label: '警告', count: summary.byLevel.warning },
    { key: 'info', label: '提示', count: summary.byLevel.info },
    { key: 'unread', label: '未读', count: summary.unread },
  ];

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
        onClick={() => onCollapsedChange?.(!collapsed)}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🔔</span>
          <h3 className="font-semibold tracking-tight text-neutral-800 dark:text-neutral-100">业务预警</h3>
          {summary.unread > 0 && (
            <span className="px-2 py-0.5 text-[11px] font-bold bg-danger dark:bg-danger-dark text-white rounded-md shadow-sm">
              {summary.unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={loading}
              className="p-1.5 text-neutral-500 hover:text-primary dark:hover:text-primary-light hover:bg-primary-bg dark:hover:bg-blue-900/20 rounded-md disabled:opacity-50 transition-colors"
              title="刷新预警"
            >
              <svg
                className={`w-[18px] h-[18px] ${loading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
          <button className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
            <svg
              className={`w-[18px] h-[18px] transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* 内容区 */}
      {!collapsed && (
        <div className="p-4">
          {/* 摘要卡片 */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <SummaryCard level="critical" count={summary.byLevel.critical} />
            <SummaryCard level="warning" count={summary.byLevel.warning} />
            <SummaryCard level="info" count={summary.byLevel.info} />
          </div>

          {/* 筛选栏 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1.5">
              {filterButtons.map(btn => (
                <button
                  key={btn.key}
                  onClick={() => setFilter(btn.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${filter === btn.key
                      ? 'bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 shadow-sm'
                      : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                >
                  {btn.label}
                  {btn.count > 0 && (
                    <span className="ml-1 opacity-80">({btn.count})</span>
                  )}
                </button>
              ))}
            </div>
            {summary.unread > 0 && onMarkAllAsRead && (
              <button
                onClick={onMarkAllAsRead}
                className="text-xs font-medium text-primary dark:text-primary-light hover:underline underline-offset-2 transition-all"
              >
                全部已读
              </button>
            )}
          </div>

          {/* 预警列表 */}
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {loading ? (
              <div className="text-center py-10 text-neutral-500 dark:text-neutral-400">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <span className="text-sm font-medium">正在检测预警...</span>
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-neutral-400 dark:text-neutral-500">
                <span className="text-4xl mb-3 opacity-80 grayscale">✅</span>
                <p className="text-sm font-medium">暂无预警信息</p>
              </div>
            ) : (
              filteredAlerts.map(alert => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  onMarkAsRead={onMarkAsRead}
                  onMarkAsResolved={onMarkAsResolved}
                />
              ))
            )}
          </div>

          {/* 底部信息 */}
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-[11px] text-neutral-400 dark:text-neutral-500 text-center font-mono">
            最后更新: {summary.lastUpdated.toLocaleString('zh-CN')}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertPanel;
