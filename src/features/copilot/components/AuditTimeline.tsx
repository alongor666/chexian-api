/**
 * AuditTimeline — 阶段 4 PR-D
 *
 * 展示 workflow 的 audit 事件时序卡片（来自 GET /api/workflows/runs/:runId/audit）。
 * 6 类事件按 eventType 着色；payload 仅展示白名单字段，禁止整个 record 渲染（避免 PII 泄漏到 UI）。
 *
 * 红线（CLAUDE.md §10）：
 *  - 前端不渲染 payload 中未在白名单内的字段
 *  - 不调 LLM；事件来自后端 append-only JSONL
 */

import { useEffect, useState } from 'react';
import { apiClient } from '../../../shared/api/client';
import type { AuditEvent, AuditEventType } from '../types';
import { badgeStyles, cardStyles, cn, colorClasses } from '../../../shared/styles';

interface AuditTimelineProps {
  runId: string;
  /** 外部触发 refetch 的 token（每次 +1 重新拉取） */
  refreshToken?: number;
}

const EVENT_TYPE_LABEL: Record<AuditEventType, string> = {
  'workflow-started': '工作流启动',
  'step-completed': '步骤完成',
  'approval-requested': '请求审批',
  'approval-granted': '审批通过',
  'approval-denied': '审批拒绝',
  'workflow-completed': '工作流完成',
};

const PAGE_SIZE = 20;
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * 6 类事件的语义色（dark mode 友好，使用设计系统语义色块）。
 * - workflow-started: blue/primary（启动）
 * - step-completed: green/success（步骤成功）
 * - approval-requested: amber/warning（待人工）
 * - approval-granted: green/success
 * - approval-denied: red/danger
 * - workflow-completed: neutral（终态）
 */
const EVENT_BADGE: Record<AuditEventType, string> = {
  'workflow-started': cn(badgeStyles.base, badgeStyles.primary),
  'step-completed': cn(badgeStyles.base, badgeStyles.success),
  'approval-requested': cn(badgeStyles.base, badgeStyles.warning),
  'approval-granted': cn(badgeStyles.base, badgeStyles.success),
  'approval-denied': cn(badgeStyles.base, badgeStyles.danger),
  'workflow-completed': cn(badgeStyles.base, badgeStyles.default),
};

/**
 * payload 字段白名单 — 显式列出允许显示的字段。
 * 任何不在白名单的 key 都不会渲染（防御性默认拒绝 — 防止 audit-log 写入时不慎暴露 PII）。
 */
const PAYLOAD_WHITELIST: ReadonlySet<string> = new Set([
  'nodeId',
  'nodeIndex',
  'skillId',
  'nodeType',
  'status',
  'elapsedMs',
  'error',
  'childCount',
  'nodeCount',
  'workflowVersion',
  'stepCount',
  'hasNarrative',
  'approverRoles',
  'approvedBy',
  'approverRole',
  'reason',
]);

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return TIMESTAMP_FORMATTER.format(d);
  } catch {
    return iso;
  }
}

function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function selectVisiblePayload(payload: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(payload).filter(([k]) => PAYLOAD_WHITELIST.has(k));
}

export function AuditTimeline({ runId, refreshToken = 0 }: AuditTimelineProps) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisibleCount(PAGE_SIZE);
    apiClient
      .getWorkflowAudit(runId)
      .then((data) => {
        if (cancelled) return;
        setEvents(data as AuditEvent[]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '审计事件拉取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, refreshToken]);

  const visibleEvents = events ? events.slice(Math.max(0, events.length - visibleCount)) : [];
  const hiddenCount = events ? Math.max(0, events.length - visibleEvents.length) : 0;

  return (
    <section className={cn(cardStyles.standard, 'space-y-2')} aria-label="审计事件时序">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">审计时序</h3>
        <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
          {events ? `${events.length} 条事件` : loading ? '加载中…' : ''}
        </span>
      </header>

      {error && (
        <div
          role="alert"
          className={cn('px-2 py-1 text-xs rounded', colorClasses.bg.danger, colorClasses.text.dangerDark)}
        >
          {error}
        </div>
      )}

      {!error && events && events.length === 0 && (
        <p className={cn('text-xs', colorClasses.text.neutralMuted)}>暂无审计事件。</p>
      )}

      {!error && events && events.length > 0 && (
        <>
          <ol className="space-y-1.5">
            {visibleEvents.map((e, idx) => {
              const visiblePairs = selectVisiblePayload(e.payload);
              return (
                <li
                  key={`${e.timestamp}-${e.eventType}-${idx}`}
                  className={cn(
                    'flex flex-col gap-1 rounded border px-2 py-1.5',
                    colorClasses.border.neutral,
                    'bg-white dark:bg-surface-2',
                  )}
                  data-event-type={e.eventType}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={EVENT_BADGE[e.eventType]}>{EVENT_TYPE_LABEL[e.eventType]}</span>
                    <span className={cn('font-numeric tabular-nums', colorClasses.text.neutralMuted)}>
                      {formatTimestamp(e.timestamp)}
                    </span>
                  </div>
                  <div className={cn('text-xs', colorClasses.text.neutralDark)}>
                    <span className={colorClasses.text.neutralMuted}>{e.userId}</span>
                    <span className="mx-1.5 text-neutral-300 dark:text-neutral-600">·</span>
                    <span>{e.role}</span>
                  </div>
                  {visiblePairs.length > 0 && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                      {visiblePairs.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className={colorClasses.text.neutralMuted}>{k}</dt>
                          <dd className={cn('truncate', colorClasses.text.neutralDark)}>
                            {formatPayloadValue(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ol>
          {hiddenCount > 0 && (
            <button
              type="button"
              className={cn(
                'w-full rounded border px-2 py-1.5 text-xs font-medium',
                colorClasses.border.neutral,
                colorClasses.text.neutralDark,
                'hover:bg-neutral-50 dark:hover:bg-surface-2',
              )}
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              加载更多（{hiddenCount}）
            </button>
          )}
        </>
      )}
    </section>
  );
}
