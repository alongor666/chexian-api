/**
 * @vitest-environment jsdom
 * useCopilotRun 单元测试 — 阶段 3
 *
 * 通过 mock fetch + 假 EventSource 驱动 hook 状态机：
 *  - 创建 run（POST /api/copilot/runs）
 *  - 接收 SSE 事件 → 状态机转 running → completed
 *  - 拉取报告（GET /api/copilot/runs/:runId/report）
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// 必须 mock 在 import 前完成
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }
  emit(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

(globalThis as any).EventSource = MockEventSource;

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

// apiClient.getToken 复用（不 mock）
vi.mock('../../../src/shared/api/client', () => ({
  API_BASE: 'http://localhost:3000/api',
  apiClient: { getToken: () => 'test-token' },
}));

import { useCopilotRun } from '../../../src/features/copilot/useCopilotRun';

beforeEach(() => {
  fetchMock.mockReset();
  MockEventSource.instances.length = 0;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe('useCopilotRun', () => {
  it('初始 state.idle，5 个 pending step', () => {
    const { result } = renderHook(() => useCopilotRun());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.steps.length).toBe(5);
    expect(result.current.state.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('start → 创建 run + 订阅 SSE + 接收 step 事件', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runId: 'wr_20260426000000_auto-risk-control-v1_aabbccdd',
          workflowId: 'auto-risk-control-v1',
          streamUrl: '/api/copilot/runs/wr_xxx/stream',
          reportUrl: '/api/copilot/runs/wr_xxx/report',
        },
      }),
    });

    const { result } = renderHook(() => useCopilotRun());

    await act(async () => {
      await result.current.start({ startDate: '2026-04-01', endDate: '2026-04-26' });
    });

    expect(result.current.state.status).toBe('running');
    expect(result.current.state.runId).toBe('wr_20260426000000_auto-risk-control-v1_aabbccdd');
    expect(MockEventSource.instances.length).toBe(1);
    const es = MockEventSource.instances[0];
    expect(es.url).toContain('/copilot/runs/');
    expect(es.url).toContain('/stream');
    expect(es.withCredentials).toBe(true);

    // 触发 step-started → step running
    await act(async () => {
      es.emit({
        type: 'step-started',
        runId: 'wr_xxx',
        nodeId: 'kpi-baseline',
        skillId: 'kpi-baseline',
        index: 1,
      });
    });
    expect(result.current.state.steps.find((s) => s.nodeId === 'kpi-baseline')?.status).toBe('running');

    // 触发 step-completed
    await act(async () => {
      es.emit({
        type: 'step-completed',
        runId: 'wr_xxx',
        nodeId: 'kpi-baseline',
        skillId: 'kpi-baseline',
        status: 'success',
        elapsedMs: 1500,
      });
    });
    expect(result.current.state.steps.find((s) => s.nodeId === 'kpi-baseline')?.status).toBe('success');
    expect(result.current.state.steps.find((s) => s.nodeId === 'kpi-baseline')?.elapsedMs).toBe(1500);
  });

  it('workflow-completed → 触发 fetchReport，最终 status=completed', async () => {
    // 1) POST /runs
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { runId: 'wr_20260426_x_aabbccdd', workflowId: 'auto-risk-control-v1', streamUrl: '', reportUrl: '' },
      }),
    });
    // 2) GET /report
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runId: 'wr_xxx',
          workflowId: 'auto-risk-control-v1',
          workflowStatus: 'success',
          markdown: '# 报告\n\n本期赔付率 65%',
          sections: [],
          redLineWarnings: [],
          successCount: 5,
          failedCount: 0,
          skippedCount: 0,
          totalElapsedMs: 5000,
          narrative: null,
          narrativeMeta: null,
        },
      }),
    });

    const { result } = renderHook(() => useCopilotRun());
    await act(async () => {
      await result.current.start({ startDate: '2026-04-01', endDate: '2026-04-26' });
    });

    const es = MockEventSource.instances[0];
    await act(async () => {
      es.emit({ type: 'workflow-completed', runId: 'wr_xxx', status: 'success', elapsedMs: 5000 });
    });

    await waitFor(() => expect(result.current.state.status).toBe('completed'));
    expect(result.current.state.report?.markdown).toContain('本期赔付率 65%');
    expect(result.current.state.workflowStatus).toBe('success');
    expect(es.closed).toBe(true);
  });

  it('POST /runs 失败 → state.error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal',
    });
    const { result } = renderHook(() => useCopilotRun());
    await act(async () => {
      await result.current.start({ startDate: '2026-04-01', endDate: '2026-04-26' });
    });
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('HTTP 500');
  });

  it('reset → 回到 idle', async () => {
    const { result } = renderHook(() => useCopilotRun());
    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');
  });

  it('workflow-completed 后 /report 返回 500 → status=error，不假装 completed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { runId: 'wr_x', workflowId: 'auto-risk-control-v1', streamUrl: '', reportUrl: '' },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal',
    });

    const { result } = renderHook(() => useCopilotRun());
    await act(async () => {
      await result.current.start({ startDate: '2026-04-01', endDate: '2026-04-26' });
    });
    const es = MockEventSource.instances[0];
    await act(async () => {
      es.emit({ type: 'workflow-completed', runId: 'wr_x', status: 'success', elapsedMs: 100 });
    });

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error).toContain('HTTP 500');
    expect(result.current.state.report).toBeNull();
  });

  it('workflow-completed 后 /report success=false → status=error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { runId: 'wr_x', workflowId: 'auto-risk-control-v1', streamUrl: '', reportUrl: '' },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, error: '权限失效' }),
    });

    const { result } = renderHook(() => useCopilotRun());
    await act(async () => {
      await result.current.start({ startDate: '2026-04-01', endDate: '2026-04-26' });
    });
    const es = MockEventSource.instances[0];
    await act(async () => {
      es.emit({ type: 'workflow-completed', runId: 'wr_x', status: 'success', elapsedMs: 100 });
    });

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error).toContain('权限失效');
  });

  it('includeNarrative=true → /report?includeNarrative=1', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { runId: 'wr_x', workflowId: 'auto-risk-control-v1', streamUrl: '', reportUrl: '' },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runId: 'wr_x',
          workflowId: 'auto-risk-control-v1',
          workflowStatus: 'success',
          markdown: '# 报告',
          sections: [],
          redLineWarnings: [],
          successCount: 5,
          failedCount: 0,
          skippedCount: 0,
          totalElapsedMs: 100,
          narrative: '本期经营平稳。',
          narrativeMeta: { provider: 'mock', blockedBySqlGuard: false },
        },
      }),
    });

    const { result } = renderHook(() => useCopilotRun());
    await act(async () => {
      await result.current.start({ startDate: '2026-04-01', endDate: '2026-04-26', includeNarrative: true });
    });
    const es = MockEventSource.instances[0];
    await act(async () => {
      es.emit({ type: 'workflow-completed', runId: 'wr_x', status: 'success', elapsedMs: 100 });
    });
    await waitFor(() => expect(result.current.state.status).toBe('completed'));

    // 第二次 fetch 调用应是 report URL，含 includeNarrative
    const reportCall = fetchMock.mock.calls[1];
    expect(reportCall[0]).toContain('includeNarrative=1');
    expect(result.current.state.report?.narrative).toBe('本期经营平稳。');
  });
});
