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
      className={`p-3 rounded-lg border ${levelConfig.bgColor} ${
        alert.read ? 'opacity-70' : ''
      } ${alert.resolved ? 'line-through opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{levelConfig.icon}</span>
            <span className={`font-medium ${levelConfig.color}`}>
              {alert.title}
            </span>
            <span className="text-xs px-2 py-0.5 bg-gray-200 rounded-full text-gray-600">
              {typeConfig.label}
            </span>
          </div>
          <p className="text-sm text-gray-600 ml-7">{alert.description}</p>
          {alert.dimension && (
            <p className="text-xs text-gray-500 ml-7 mt-1">
              维度: {alert.dimension}
            </p>
          )}
          <p className="text-xs text-gray-400 ml-7 mt-1">
            {new Date(alert.timestamp).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          {!alert.read && onMarkAsRead && (
            <button
              onClick={() => onMarkAsRead(alert.id)}
              className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded"
              title="标记已读"
            >
              已读
            </button>
          )}
          {!alert.resolved && onMarkAsResolved && (
            <button
              onClick={() => onMarkAsResolved(alert.id)}
              className="text-xs px-2 py-1 text-green-600 hover:bg-green-50 rounded"
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
    <div className={`px-3 py-2 rounded-lg ${config.bgColor} text-center`}>
      <div className="text-lg">{config.icon}</div>
      <div className={`text-xl font-bold ${config.color}`}>{count}</div>
      <div className="text-xs text-gray-500">{config.label}</div>
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
    <div className="bg-white rounded-lg shadow-sm border">
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b cursor-pointer hover:bg-gray-50"
        onClick={() => onCollapsedChange?.(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🔔</span>
          <h3 className="font-medium text-gray-800">业务预警</h3>
          {summary.unread > 0 && (
            <span className="px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
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
              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
              title="刷新预警"
            >
              <svg
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
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
          <button className="p-1.5 text-gray-500 hover:text-gray-700">
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
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
            <div className="flex gap-1">
              {filterButtons.map(btn => (
                <button
                  key={btn.key}
                  onClick={() => setFilter(btn.key)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filter === btn.key
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {btn.label}
                  {btn.count > 0 && (
                    <span className="ml-1 text-xs">({btn.count})</span>
                  )}
                </button>
              ))}
            </div>
            {summary.unread > 0 && onMarkAllAsRead && (
              <button
                onClick={onMarkAllAsRead}
                className="text-xs text-blue-600 hover:underline"
              >
                全部已读
              </button>
            )}
          </div>

          {/* 预警列表 */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-gray-500">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                正在检测预警...
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <span className="text-3xl">✅</span>
                <p className="mt-2">暂无预警信息</p>
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
          <div className="mt-3 pt-3 border-t text-xs text-gray-400 text-center">
            最后更新: {summary.lastUpdated.toLocaleString('zh-CN')}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertPanel;
