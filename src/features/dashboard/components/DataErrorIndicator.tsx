/**
 * DataErrorIndicator - 数据加载错误提示组件
 *
 * 解决 Silent Failures 问题：让用户知道数据加载失败，并提供重试选项
 */

import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { DataError, DataLoadingKey } from '../hooks/useDashboardData';

interface DataErrorIndicatorProps {
  errors: Record<DataLoadingKey, DataError | null>;
  hasErrors: boolean;
  onRetry: () => void;
  onDismiss: (key: DataLoadingKey) => void;
  onDismissAll: () => void;
}

/** 错误类型的中文名称 */
const errorLabels: Record<DataLoadingKey, string> = {
  kpi: 'KPI 指标',
  chart: '业务员排名图表',
  table: '业务员明细表',
  customerCategory: '客户类别分布',
  coverageCombination: '险别组合分布',
  terminalSource: '来源渠道分布',
};

/**
 * 数据加载错误提示条
 */
export function DataErrorIndicator({
  errors,
  hasErrors,
  onRetry,
  onDismiss,
  onDismissAll,
}: DataErrorIndicatorProps) {
  if (!hasErrors) return null;

  const errorEntries = Object.entries(errors).filter(
    (entry): entry is [DataLoadingKey, DataError] => entry[1] !== null
  );

  if (errorEntries.length === 0) return null;

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-800">数据加载失败</h3>
            <div className="mt-2 text-sm text-red-700">
              <ul className="list-disc list-inside space-y-1">
                {errorEntries.map(([key, error]) => (
                  <li key={key} className="flex items-center justify-between">
                    <span>
                      <strong>{errorLabels[key]}</strong>：{error.message}
                      {error.retryable && (
                        <span className="text-red-500 ml-1">（可重试）</span>
                      )}
                    </span>
                    <button
                      onClick={() => onDismiss(key)}
                      className="ml-2 p-1 hover:bg-red-100 rounded"
                      title="忽略此错误"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 text-sm font-medium rounded-md transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                重新加载
              </button>
              {errorEntries.length > 1 && (
                <button
                  onClick={onDismissAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-red-50 text-red-700 text-sm font-medium rounded-md border border-red-200 transition-colors"
                >
                  全部忽略
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 单个数据块的错误提示（用于 Card/Panel 内部）
 */
export function InlineDataError({
  error,
  label,
  onRetry,
}: {
  error: DataError | null;
  label: string;
  onRetry?: () => void;
}) {
  if (!error) return null;

  return (
    <div className="flex items-center justify-center h-full bg-red-50 rounded-md p-4">
      <div className="text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-700 mb-2">
          {label}加载失败
        </p>
        <p className="text-xs text-red-500 mb-3">{error.message}</p>
        {onRetry && error.retryable && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}
