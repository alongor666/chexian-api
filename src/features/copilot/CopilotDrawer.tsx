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

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useCopilotRun } from './useCopilotRun';
import { AuditTimeline } from './components/AuditTimeline';
import { ApprovalActions } from './components/ApprovalActions';
import { ForecastScenarioPanel } from './components/ForecastScenarioPanel';
import { apiClient } from '../../shared/api/client';
import type { ApprovalState, CopilotStepView } from './types';

type CopilotMode = 'patrol' | 'forecast';

const MODE_LABELS: Record<CopilotMode, string> = {
  patrol: '经营巡检',
  forecast: '经营利润情景测算',
};

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultPeriod() {
  // 用本地时区组合，避免 toISOString() 在非 UTC 时区把日期偏移到「明天」或「上月末」
  const now = new Date();
  const end = formatLocalYmd(now);
  const start = formatLocalYmd(new Date(now.getFullYear(), now.getMonth(), 1));
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
  const [mode, setMode] = useState<CopilotMode>('patrol');
  const [period, setPeriod] = useState(getDefaultPeriod);
  const [includeNarrative, setIncludeNarrative] = useState(false);
  const { state, start, reset, refresh } = useCopilotRun();
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [auditRefreshToken, setAuditRefreshToken] = useState(0);

  const isBusy = state.status === 'creating' || state.status === 'running' || state.status === 'fetching-report';
  const overallSummary = useMemo(() => {
    if (!state.report) return null;
    const r = state.report;
    return `${r.workflowStatus} · 成功 ${r.successCount} / 失败 ${r.failedCount} / 跳过 ${r.skippedCount} · 耗时 ${(r.totalElapsedMs / 1000).toFixed(1)}s`;
  }, [state.report]);

  // 阶段 4 PR-D：拉取 workflow run record 以获取 approval 状态
  // 仅在 status='completed' / 'fetching-report' 之后（即报告已存在）才尝试拉取
  // 失败静默忽略 — approval 不存在不影响报告本身渲染
  const fetchApproval = useCallback(async (runId: string) => {
    try {
      const record = await apiClient.getWorkflowRun(runId);
      setApproval((record.approval ?? null) as ApprovalState | null);
    } catch {
      setApproval(null);
    }
  }, []);

  useEffect(() => {
    if (state.runId && (state.status === 'completed' || state.status === 'error')) {
      void fetchApproval(state.runId);
    } else if (!state.runId) {
      setApproval(null);
    }
  }, [state.runId, state.status, fetchApproval]);

  const handleApprovalResolved = useCallback(() => {
    void refresh();
    if (state.runId) void fetchApproval(state.runId);
    setAuditRefreshToken((t) => t + 1);
  }, [refresh, state.runId, fetchApproval]);

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
              <p className="text-xs text-neutral-500">
                {mode === 'patrol' ? 'auto-risk-control-v1（5 步 workflow）' : '确定性情景测算（无 LLM / 无 SQL）'}
              </p>
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

          {/* Mode 切换器：「经营巡检」与「经营利润情景测算」并列入口 */}
          <div
            role="tablist"
            aria-label="Copilot 模式"
            className="flex border-b border-neutral-200 dark:border-subtle px-2 pt-2 gap-1"
          >
            {(Object.keys(MODE_LABELS) as CopilotMode[]).map((m) => {
              const active = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`copilot-panel-${m}`}
                  id={`copilot-tab-${m}`}
                  onClick={() => setMode(m)}
                  className={
                    active
                      ? 'px-3 py-1.5 text-sm font-medium border-b-2 border-primary text-primary -mb-px'
                      : 'px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 border-b-2 border-transparent -mb-px'
                  }
                >
                  {MODE_LABELS[m]}
                </button>
              );
            })}
          </div>

          {mode === 'forecast' && (
            <div
              role="tabpanel"
              id="copilot-panel-forecast"
              aria-labelledby="copilot-tab-forecast"
              className="flex-1 flex flex-col overflow-hidden"
            >
              <ForecastScenarioPanel />
            </div>
          )}

          {mode === 'patrol' && (
            <div
              role="tabpanel"
              id="copilot-panel-patrol"
              aria-labelledby="copilot-tab-patrol"
              className="flex-1 flex flex-col overflow-hidden"
            >
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
                {/* 顶部 status 行：summary + ApprovalActions（仅 pending_approval 时显示按钮） */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-subtle rounded">
                  <span>{overallSummary}</span>
                  {state.runId && state.report?.workflowStatus && (
                    <ApprovalActions
                      runId={state.runId}
                      status={state.report.workflowStatus}
                      approval={approval}
                      onResolved={handleApprovalResolved}
                    />
                  )}
                </div>

                {/* narrative 来源标记 — 让审计/合规可识别叙述是否经过审批节点的 attach-narrative skill */}
                {state.report.narrative && state.report.narrativeSource && (
                  <div className="mb-2 text-[10px] text-neutral-500 dark:text-neutral-400">
                    narrative source: <code>{state.report.narrativeSource}</code>
                  </div>
                )}

                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{state.report.markdown}</ReactMarkdown>
                </article>

                {/* 阶段 4 PR-D：审计事件时序 */}
                {state.runId && (
                  <div className="mt-4">
                    <AuditTimeline runId={state.runId} refreshToken={auditRefreshToken} />
                  </div>
                )}
              </>
            )}
          </section>
            </div>
          )}
        </div>
      )}
    </>
  );
}
