/**
 * @vitest-environment jsdom
 *
 * AuditTimeline 单元测试 — 阶段 4 PR-D
 *  - mock apiClient.getWorkflowAudit 返回 6 类事件
 *  - 断言每类事件渲染 + 时间戳 + payload 白名单字段
 *  - 断言不在白名单的 payload 字段不渲染（PII 防护）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AuditEvent } from '../../../src/features/copilot/types';

// vi.mock 工厂会被 vitest hoist 到文件顶部，此时模块顶层变量尚未初始化。
// 用 vi.hoisted 把 mock fn 一并提升到模块顶部，确保工厂执行时已可用。
const { getWorkflowAuditMock } = vi.hoisted(() => ({
  getWorkflowAuditMock: vi.fn(),
}));

vi.mock('../../../src/shared/api/client', () => ({
  apiClient: { getWorkflowAudit: getWorkflowAuditMock },
}));

import { AuditTimeline } from '../../../src/features/copilot/components/AuditTimeline';

const RUN_ID = 'wr_20260427000000_auto-risk-control-v1_aabbccdd';

const SAMPLE_EVENTS: AuditEvent[] = [
  {
    timestamp: '2026-04-27T01:00:00.000Z',
    runId: RUN_ID,
    workflowId: 'auto-risk-control-v1',
    eventType: 'workflow-started',
    userId: 'admin',
    role: 'branch_admin',
    requestId: 'r-1',
    payload: { nodeCount: 9, workflowVersion: '1.2.0' },
  },
  {
    timestamp: '2026-04-27T01:00:01.000Z',
    runId: RUN_ID,
    workflowId: 'auto-risk-control-v1',
    eventType: 'step-completed',
    userId: 'admin',
    role: 'branch_admin',
    requestId: 'r-1',
    payload: {
      nodeId: 'data-health',
      skillId: 'data-health',
      status: 'success',
      elapsedMs: 250,
      // 不在白名单的字段，必须不渲染
      rawSql: 'SELECT * FROM secret',
      pii: '13800000000',
    },
  },
  {
    timestamp: '2026-04-27T01:00:02.000Z',
    runId: RUN_ID,
    workflowId: 'auto-risk-control-v1',
    eventType: 'approval-requested',
    userId: 'analyst1',
    role: 'analyst',
    requestId: 'r-1',
    payload: { nodeId: 'gate', approverRoles: ['branch_admin'] },
  },
  {
    timestamp: '2026-04-27T01:00:03.000Z',
    runId: RUN_ID,
    workflowId: 'auto-risk-control-v1',
    eventType: 'approval-granted',
    userId: 'admin',
    role: 'branch_admin',
    requestId: 'r-2',
    payload: { nodeId: 'gate', approvedBy: 'admin', approverRole: 'branch_admin' },
  },
  {
    timestamp: '2026-04-27T01:00:04.000Z',
    runId: RUN_ID,
    workflowId: 'auto-risk-control-v1',
    eventType: 'approval-denied',
    userId: 'admin',
    role: 'branch_admin',
    requestId: 'r-3',
    payload: { nodeId: 'gate', reason: '风险评估不足' },
  },
  {
    timestamp: '2026-04-27T01:00:05.000Z',
    runId: RUN_ID,
    workflowId: 'auto-risk-control-v1',
    eventType: 'workflow-completed',
    userId: 'admin',
    role: 'branch_admin',
    requestId: 'r-3',
    payload: { status: 'failed', elapsedMs: 5000, stepCount: 9, hasNarrative: true },
  },
];

beforeEach(() => {
  getWorkflowAuditMock.mockReset();
});

describe('AuditTimeline', () => {
  it('渲染 6 类事件并按 eventType 区分（dom data-event-type 属性）', async () => {
    getWorkflowAuditMock.mockResolvedValue(SAMPLE_EVENTS);

    const { container } = render(<AuditTimeline runId={RUN_ID} />);

    await waitFor(() => {
      expect(getWorkflowAuditMock).toHaveBeenCalledWith(RUN_ID);
    });

    // 6 类事件标签都应出现
    await waitFor(() => {
      expect(screen.getByText('工作流启动')).toBeTruthy();
    });
    expect(screen.getByText('步骤完成')).toBeTruthy();
    expect(screen.getByText('请求审批')).toBeTruthy();
    expect(screen.getByText('审批通过')).toBeTruthy();
    expect(screen.getByText('审批拒绝')).toBeTruthy();
    expect(screen.getByText('工作流完成')).toBeTruthy();

    // data-event-type 应有 6 个不同的值
    const items = container.querySelectorAll('[data-event-type]');
    const types = Array.from(items).map((el) => el.getAttribute('data-event-type'));
    expect(types).toEqual([
      'workflow-started',
      'step-completed',
      'approval-requested',
      'approval-granted',
      'approval-denied',
      'workflow-completed',
    ]);
  });

  it('白名单外的 payload 字段不渲染（PII 防护）', async () => {
    getWorkflowAuditMock.mockResolvedValue(SAMPLE_EVENTS);

    render(<AuditTimeline runId={RUN_ID} />);

    await waitFor(() => {
      expect(screen.getByText('步骤完成')).toBeTruthy();
    });

    // 白名单字段渲染（多个事件都有 nodeId，所以用 getAllByText）
    expect(screen.getAllByText('nodeId').length).toBeGreaterThan(0);
    expect(screen.getAllByText('elapsedMs').length).toBeGreaterThan(0);
    // 非白名单字段：rawSql / pii 必须不出现
    expect(screen.queryByText('rawSql')).toBeNull();
    expect(screen.queryByText(/SELECT \* FROM secret/)).toBeNull();
    expect(screen.queryByText('pii')).toBeNull();
    expect(screen.queryByText('13800000000')).toBeNull();
  });

  it('audit 拉取失败时显示错误信息', async () => {
    getWorkflowAuditMock.mockRejectedValue(new Error('audit not available'));

    render(<AuditTimeline runId={RUN_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('audit not available');
  });

  it('refreshToken 变化时重新 fetch', async () => {
    getWorkflowAuditMock.mockResolvedValue(SAMPLE_EVENTS);

    const { rerender } = render(<AuditTimeline runId={RUN_ID} refreshToken={0} />);
    await waitFor(() => expect(getWorkflowAuditMock).toHaveBeenCalledTimes(1));

    rerender(<AuditTimeline runId={RUN_ID} refreshToken={1} />);
    await waitFor(() => expect(getWorkflowAuditMock).toHaveBeenCalledTimes(2));
  });
});
