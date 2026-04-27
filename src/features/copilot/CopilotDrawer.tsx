/**
 * CopilotDrawer — 阶段 3 MVP
 *
 * 全局右下角悬浮按钮 + 抽屉。点击后选择 period（默认本月），触发 auto-risk-control-v1。
 * 实时显示 5 步 workflow 进度；完成后渲染模板报告（react-markdown）。
 *
 * 红线：
 *  - LLM 叙述是 opt-in 复选框（默认关闭，避免不必要的 LLM 调用）
 *  - 红线 warning 由后端 markdown 顶部生成，前端直接 render，不二次过滤
 */

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useCopilotRun } from './useCopilotRun';
import type { CopilotStepView } from './types';

function getDefaultPeriod() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startObj = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = startObj.toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

const STATUS_LABELS: Record<CopilotStepView['status'], string> = {
  pending: '待执行',
  running: '执行中…',
  success: '✅ 完成',
  failed: '❌ 失败',
  skipped: '⏭️ 跳过',
};

const STATUS_COLORS: Record<CopilotStepView['status'], string> = {
  pending: 'text-neutral-400',
  running: 'text-primary-500 animate-pulse',
  success: 'text-success',
  failed: 'text-danger',
  skipped: 'text-neutral-400',
};

export function CopilotDrawer() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(getDefaultPeriod);
  const [includeNarrative, setIncludeNarrative] = useState(false);
  const { state, start, reset } = useCopilotRun();

  const isBusy = state.status === 'creating' || state.status === 'running' || state.status === 'fetching-report';
  const overallSummary = useMemo(() => {
    if (!state.report) return null;
    const r = state.report;
    return `${r.workflowStatus} · 成功 ${r.successCount} / 失败 ${r.failedCount} / 跳过 ${r.skippedCount} · 耗时 ${(r.totalElapsedMs / 1000).toFixed(1)}s`;
  }, [state.report]);

  return (
    <>
      <button
        type="button"
        aria-label="打开 Copilot"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:bg-primary-light active:bg-primary-dark transition-colors flex items-center justify-center text-xl"
      >
        🤖
      </button>

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white dark:bg-neutral-900 shadow-2xl border-l border-neutral-200 dark:border-subtle flex flex-col">
          <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-subtle">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">经营 Copilot</h2>
              <p className="text-xs text-neutral-500">auto-risk-control-v1（5 步 workflow）</p>
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
              className="text-2xl text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              ×
            </button>
          </header>

          <div className="px-4 py-3 border-b border-neutral-200 dark:border-subtle space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">起始日期</span>
                <input
                  type="date"
                  className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                  value={period.startDate}
                  onChange={(e) => setPeriod((p) => ({ ...p, startDate: e.target.value }))}
                  disabled={isBusy}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">截止日期</span>
                <input
                  type="date"
                  className="px-2 py-1 border border-neutral-300 dark:border-subtle rounded bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                  value={period.endDate}
                  onChange={(e) => setPeriod((p) => ({ ...p, endDate: e.target.value }))}
                  disabled={isBusy}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={includeNarrative}
                onChange={(e) => setIncludeNarrative(e.target.checked)}
                disabled={isBusy}
              />
              附加 LLM 执行摘要（mock 环境下走本地占位）
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => start({ startDate: period.startDate, endDate: period.endDate, includeNarrative })}
                disabled={isBusy}
                className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBusy ? '执行中…' : '执行经营巡检'}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={state.status === 'idle'}
                className="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 dark:border-subtle text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 disabled:opacity-50"
              >
                重置
              </button>
            </div>
          </div>

          {/* 进度区 */}
          <section className="px-4 py-3 border-b border-neutral-200 dark:border-subtle">
            <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">执行进度</h3>
            <ol className="space-y-1.5 text-sm">
              {state.steps.map((s, i) => (
                <li key={s.nodeId} className="flex items-center justify-between gap-2">
                  <span className="text-neutral-600 dark:text-neutral-300">
                    <span className="text-neutral-400 mr-1">{i + 1}.</span>
                    {s.label}
                  </span>
                  <span className={STATUS_COLORS[s.status]}>
                    {STATUS_LABELS[s.status]}
                    {s.elapsedMs !== undefined && ` (${s.elapsedMs}ms)`}
                  </span>
                </li>
              ))}
            </ol>
            {state.error && (
              <div className="mt-2 px-2 py-1 text-xs text-danger-dark bg-danger-bg rounded">
                {state.error}
              </div>
            )}
          </section>

          {/* 报告区 */}
          <section className="flex-1 overflow-auto px-4 py-3">
            {state.status === 'idle' && (
              <p className="text-sm text-neutral-400 text-center pt-8">
                选择 period，点击「执行经营巡检」开始。
              </p>
            )}
            {state.status === 'running' && (
              <p className="text-sm text-neutral-500 text-center pt-8">workflow 执行中…请耐心等待</p>
            )}
            {state.report && (
              <>
                {overallSummary && (
                  <div className="mb-3 px-3 py-2 text-xs bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-subtle rounded">
                    {overallSummary}
                  </div>
                )}
                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{state.report.markdown}</ReactMarkdown>
                </article>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
