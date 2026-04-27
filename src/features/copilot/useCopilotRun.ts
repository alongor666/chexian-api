/**
 * useCopilotRun — 阶段 3 MVP
 *
 * 管理一次 workflow 运行的端到端状态：
 *  1. 调用 POST /api/copilot/runs 创建 run
 *  2. 通过 EventSource 订阅 SSE 进度
 *  3. 工作流完成后调用 GET /report 拉取 Markdown
 *
 * 依赖现有 cookie 鉴权（cx_access_token），EventSource withCredentials=true。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, apiClient } from '../../shared/api/client';
import type { CopilotReportResponse, CopilotRunCreateResponse, CopilotStepView, CopilotStreamEvent } from './types';

const STEP_LABELS: Record<string, string> = {
  'data-health': '数据健康检查',
  'kpi-baseline': '经营基线',
  'cost-diagnosis': '高赔付分组诊断',
  'claims-drilldown': '赔案下钻',
  'segment-risk-scan': '维度交叉风险扫描',
};

const DEFAULT_STEPS: CopilotStepView[] = [
  { nodeId: 'data-health', skillId: 'data-health', label: STEP_LABELS['data-health'], status: 'pending' },
  { nodeId: 'kpi-baseline', skillId: 'kpi-baseline', label: STEP_LABELS['kpi-baseline'], status: 'pending' },
  { nodeId: 'cost-diagnosis', skillId: 'cost-diagnosis', label: STEP_LABELS['cost-diagnosis'], status: 'pending' },
  { nodeId: 'claims-drilldown', skillId: 'claims-drilldown', label: STEP_LABELS['claims-drilldown'], status: 'pending' },
  { nodeId: 'segment-risk-scan', skillId: 'segment-risk-scan', label: STEP_LABELS['segment-risk-scan'], status: 'pending' },
];

export interface CopilotRunState {
  status: 'idle' | 'creating' | 'running' | 'fetching-report' | 'completed' | 'error';
  runId: string | null;
  workflowStatus: string | null;
  steps: CopilotStepView[];
  report: CopilotReportResponse['data'] | null;
  error: string | null;
}

const INITIAL: CopilotRunState = {
  status: 'idle',
  runId: null,
  workflowStatus: null,
  steps: DEFAULT_STEPS,
  report: null,
  error: null,
};

export interface StartRunInput {
  startDate: string;
  endDate: string;
  includeNarrative?: boolean;
}

export function useCopilotRun() {
  const [state, setState] = useState<CopilotRunState>(INITIAL);
  const esRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setState(INITIAL);
  }, [cleanup]);

  const start = useCallback(
    async (input: StartRunInput) => {
      cleanup();
      setState({ ...INITIAL, status: 'creating' });

      const token = apiClient.getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let createRes: Response;
      try {
        createRes = await fetch(`${API_BASE}/copilot/runs`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            workflowId: 'auto-risk-control-v1',
            input: { period: { startDate: input.startDate, endDate: input.endDate } },
          }),
        });
      } catch (err) {
        setState((s) => ({ ...s, status: 'error', error: err instanceof Error ? err.message : String(err) }));
        return;
      }

      if (!createRes.ok) {
        const errBody = await createRes.text().catch(() => '');
        setState((s) => ({ ...s, status: 'error', error: `创建 run 失败 (HTTP ${createRes.status}): ${errBody.slice(0, 200)}` }));
        return;
      }

      const createBody = (await createRes.json()) as CopilotRunCreateResponse;
      if (!createBody.success || !createBody.data) {
        setState((s) => ({ ...s, status: 'error', error: createBody.error ?? '创建 run 失败' }));
        return;
      }

      const { runId } = createBody.data;
      setState((s) => ({ ...s, status: 'running', runId }));

      // EventSource — 同源走 cookie；跨域需后端 CORS allow-credentials
      const sseUrl = `${API_BASE}/copilot/runs/${runId}/stream`;
      const es = new EventSource(sseUrl, { withCredentials: true });
      esRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as CopilotStreamEvent;
          setState((prev) => applyEvent(prev, data));
          if (data.type === 'workflow-completed') {
            es.close();
            esRef.current = null;
            void fetchReport(runId, input.includeNarrative ?? false).then((report) => {
              setState((prev) => ({
                ...prev,
                status: 'completed',
                workflowStatus: report?.workflowStatus ?? prev.workflowStatus,
                report,
              }));
            });
          } else if (data.type === 'stream-end') {
            es.close();
            esRef.current = null;
          }
        } catch (err) {
          // 心跳或非 JSON 行直接忽略
        }
      };

      es.onerror = () => {
        // EventSource 会自动重连。若已 done 则 onmessage 已 close
        if (esRef.current === es) {
          setState((prev) => prev.status === 'running' ? { ...prev, status: 'error', error: 'SSE 连接错误' } : prev);
        }
      };
    },
    [cleanup]
  );

  return { state, start, reset };
}

function applyEvent(state: CopilotRunState, event: CopilotStreamEvent): CopilotRunState {
  if (event.type === 'workflow-completed') {
    return { ...state, status: 'fetching-report', workflowStatus: event.status ?? state.workflowStatus };
  }
  if (event.type === 'step-started' && event.nodeId) {
    return {
      ...state,
      steps: state.steps.map((s) => (s.nodeId === event.nodeId ? { ...s, status: 'running' } : s)),
    };
  }
  if (event.type === 'step-completed' && event.nodeId) {
    return {
      ...state,
      steps: state.steps.map((s) =>
        s.nodeId === event.nodeId
          ? {
              ...s,
              status: (event.status as CopilotStepView['status']) ?? 'success',
              elapsedMs: event.elapsedMs,
              error: event.error,
            }
          : s
      ),
    };
  }
  return state;
}

async function fetchReport(runId: string, includeNarrative: boolean): Promise<CopilotReportResponse['data'] | null> {
  const token = apiClient.getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${API_BASE}/copilot/runs/${runId}/report${includeNarrative ? '?includeNarrative=1' : ''}`;
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) return null;
  const body = (await res.json()) as CopilotReportResponse;
  return body.data ?? null;
}
