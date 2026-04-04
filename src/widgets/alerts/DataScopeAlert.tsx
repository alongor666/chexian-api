/**
 * 数据范围提示组件
 * Data Scope Alert Component
 *
 * 用于告知用户当前板块的数据筛选特性，防止认知错位
 * - 全年数据模式：Growth、Renewal
 * - 滚动窗口模式：Cost-已赚保费
 */

import React from 'react';
import { Info, Calendar, Clock } from 'lucide-react';

export type DataScopeType = 'full-year' | 'rolling-window' | 'custom';

interface DataScopeAlertProps {
  /** 数据范围类型 */
  type: DataScopeType;
  /** 分析年度（full-year 模式需要） */
  analysisYear?: number;
  /** 滚动窗口月数（rolling-window 模式需要） */
  windowMonths?: number;
  /** 截止日期（rolling-window 模式需要） */
  cutoffDate?: string;
  /** 自定义提示文本 */
  customMessage?: string;
  /** 是否可关闭 */
  dismissible?: boolean;
  /** 关闭回调 */
  onDismiss?: () => void;
  /** 额外的 className */
  className?: string;
}

const scopeConfig: Record<DataScopeType, {
  icon: React.ElementType;
  bgColor: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
}> = {
  'full-year': {
    icon: Calendar,
    bgColor: 'bg-primary-bg',
    borderColor: 'border-primary-200',
    textColor: 'text-primary-dark',
    iconColor: 'text-primary',
  },
  'rolling-window': {
    icon: Clock,
    bgColor: 'bg-warning-bg',
    borderColor: 'border-warning-200',
    textColor: 'text-warning-dark',
    iconColor: 'text-warning',
  },
  'custom': {
    icon: Info,
    bgColor: 'bg-neutral-50 dark:bg-neutral-800',
    borderColor: 'border-neutral-200 dark:border-neutral-700',
    textColor: 'text-neutral-700 dark:text-neutral-300',
    iconColor: 'text-neutral-500 dark:text-neutral-400',
  },
};

/**
 * 数据范围提示组件
 */
export const DataScopeAlert: React.FC<DataScopeAlertProps> = ({
  type,
  analysisYear,
  windowMonths = 12,
  cutoffDate,
  customMessage,
  dismissible = false,
  onDismiss,
  className = '',
}) => {
  const config = scopeConfig[type];
  const Icon = config.icon;

  const getMessage = (): { title: string; description: string } => {
    switch (type) {
      case 'full-year':
        return {
          title: `当前分析 ${analysisYear || new Date().getFullYear()} 年全年数据`,
          description: '本板块需要完整年度数据以计算同比/环比增长率，全局日期范围筛选不适用于此页面',
        };
      case 'rolling-window':
        return {
          title: `滚动 ${windowMonths} 个月统计窗口`,
          description: cutoffDate
            ? `以 ${cutoffDate} 为统计日，向前追溯 ${windowMonths} 个月计算已赚保费，全局日期范围筛选不适用于此指标`
            : `本指标使用滚动 ${windowMonths} 个月窗口计算，全局日期范围筛选不适用`,
        };
      case 'custom':
        return {
          title: customMessage || '数据范围提示',
          description: '',
        };
      default:
        return { title: '', description: '' };
    }
  };

  const { title, description } = getMessage();

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-sm ${config.bgColor} ${config.borderColor} ${className}`}
      role="alert"
    >
      <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${config.iconColor}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold tracking-tight ${config.textColor}`}>{title}</p>
        {description && (
          <p className={`text-[13px] mt-1 ${config.textColor} opacity-90 leading-relaxed`}>{description}</p>
        )}
      </div>
      {dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          className={`p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${config.textColor}`}
          aria-label="关闭提示"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default DataScopeAlert;
