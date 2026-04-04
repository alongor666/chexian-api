/**
 * 洞察面板组件
 *
 * 可折叠的 AI 洞察展示面板，包含生成按钮和加载状态
 */

import { memo, useState } from 'react';
import type { Insight } from '../types';
import { InsightCard } from './InsightCard';
import { buttonStyles, cn, colorClasses } from '../../styles';

interface InsightPanelProps {
  /** 洞察列表 */
  insights: Insight[];
  /** 加载状态 */
  loading?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 是否已配置 API */
  isConfigured?: boolean;
  /** 生成洞察回调 */
  onGenerate?: () => void;
  /** 重置回调 */
  onReset?: () => void;
  /** Token 消耗 */
  tokens?: { prompt: number; completion: number; total: number };
  /** 耗时（毫秒） */
  duration?: number;
  /** 自定义类名 */
  className?: string;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
}

/**
 * 洞察面板组件
 */
export const InsightPanel = memo(function InsightPanel({
  insights,
  loading = false,
  error = null,
  isConfigured = true,
  onGenerate,
  onReset,
  tokens,
  duration,
  className,
  defaultExpanded = false,
}: InsightPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasInsights = insights.length > 0;
  const showGenerate = !hasInsights && !loading;

  return (
    <div
      className={cn(
        'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20',
        'rounded-lg border border-indigo-200',
        className
      )}
    >
      {/* 头部：可折叠 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/30 dark:hover:bg-white/5 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <div>
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-200">AI 洞察分析</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {loading
                ? '正在分析数据...'
                : hasInsights
                  ? `已生成 ${insights.length} 条洞察`
                  : '点击生成按钮获取智能分析'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 统计信息 */}
          {tokens && duration && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 hidden sm:block">
              <span>{tokens.total} tokens</span>
              <span className="mx-1">•</span>
              <span>{(duration / 1000).toFixed(1)}s</span>
            </div>
          )}
          {/* 展开/收起图标 */}
          <svg
            className={cn(
              'w-5 h-5 text-neutral-400 transition-transform',
              expanded && 'rotate-180'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 内容区 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* 加载状态 */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo border-t-transparent" />
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  AI 正在分析数据，请稍候...
                </span>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className={cn('rounded-lg border p-3', colorClasses.bg.danger, colorClasses.border.danger)}>
              <div className="flex items-start gap-2">
                <span className={colorClasses.text.danger}>❌</span>
                <div>
                  <p className={cn('text-sm font-medium', colorClasses.text.dangerDark)}>分析失败</p>
                  <p className={cn('text-xs mt-1', colorClasses.text.danger)}>{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* 未配置提示 */}
          {!isConfigured && !loading && (
            <div className={cn('rounded-lg border p-3', colorClasses.bg.warning, colorClasses.border.warning)}>
              <div className="flex items-start gap-2">
                <span className={colorClasses.text.warning}>⚙️</span>
                <div>
                  <p className={cn('text-sm font-medium', colorClasses.text.warningDark)}>需要配置 API</p>
                  <p className={cn('text-xs mt-1', colorClasses.text.warning)}>
                    请先在系统 AI 设置中配置智谱 API Key
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 洞察列表 */}
          {hasInsights && !loading && (
            <div className="space-y-2">
              {insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          {!loading && (
            <div className="flex items-center justify-between pt-2 border-t border-indigo-200/50">
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {hasInsights
                  ? '基于当前页面数据生成'
                  : '分析将基于当前页面展示的数据'}
              </div>
              <div className="flex items-center gap-2">
                {hasInsights && onReset && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReset();
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
                  >
                    清除
                  </button>
                )}
                {showGenerate && onGenerate && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerate();
                    }}
                    disabled={!isConfigured}
                    className={cn(buttonStyles.base, buttonStyles.primary, 'px-4 py-1.5 text-sm')}
                  >
                    生成洞察
                  </button>
                )}
                {hasInsights && onGenerate && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerate();
                    }}
                    className={cn(buttonStyles.base, buttonStyles.primary, 'px-4 py-1.5 text-sm')}
                  >
                    重新生成
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default InsightPanel;
