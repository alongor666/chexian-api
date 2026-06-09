/**
 * @vitest-environment jsdom
 *
 * ApprovalActions 单元测试 — 阶段 4 PR-D
 *  - branch_admin 角色 + status='pending_approval' → 显示批准/拒绝按钮
 *  - 其他角色 → 仅显示状态徽章
 *  - 拒绝 modal：reason 留空时禁用提交按钮（必填校验）
 *  - approve/reject 接口调用并触发 onResolved
 *  - 错误码映射：403 / 409 / 404
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// vi.mock 工厂会被 hoist 到顶部，所以这里用 vi.hoisted 一并提升 mock fn
const { approveMock, rejectMock, usePermissionMock } = vi.hoisted(() => ({
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
  usePermissionMock: vi.fn(),
}));

vi.mock('../../../src/shared/api/client', () => ({
  apiClient: {
    workflows: {
      approve: approveMock,
      reject: rejectMock,
    },
  },
}));

vi.mock('../../../src/shared/contexts/PermissionContext', () => ({
  usePermission: () => usePermissionMock(),
}));

import { ApprovalActions } from '../../../src/features/copilot/components/ApprovalActions';
import type { ApprovalState } from '../../../src/features/copilot/types';

const RUN_ID = 'wr_20260427000000_auto-risk-control-v1_aabbccdd';

const PENDING_APPROVAL: ApprovalState = {
  pendingNodeId: 'gate',
  pendingNodeIndex: 6,
  approverRoles: ['branch_admin'],
};

beforeEach(() => {
  approveMock.mockReset();
  rejectMock.mockReset();
  usePermissionMock.mockReset();
});

describe('ApprovalActions — 角色门控（前端 UX 层）', () => {
  it('branch_admin + pending_approval → 显示批准 + 拒绝按钮', () => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'admin', displayName: 'Admin', role: 'branch_admin' } });
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    expect(screen.getByTestId('approve-button')).toBeTruthy();
    expect(screen.getByTestId('reject-button')).toBeTruthy();
    expect(screen.getByTestId('approval-status-badge').textContent).toBe('待审批');
  });

  it('analyst 角色（不在 approverRoles）→ 只显示徽章，不显示按钮', () => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'a1', displayName: 'A', role: 'analyst' } });
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    expect(screen.queryByTestId('approve-button')).toBeNull();
    expect(screen.queryByTestId('reject-button')).toBeNull();
    expect(screen.getByTestId('approval-status-badge')).toBeTruthy();
  });

  it('未登录 → 不显示按钮', () => {
    usePermissionMock.mockReturnValue({ userPermission: null });
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    expect(screen.queryByTestId('approve-button')).toBeNull();
    expect(screen.queryByTestId('reject-button')).toBeNull();
  });

  it('status 不是 pending_approval（比如 success/failed）→ 不显示按钮', () => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'admin', displayName: 'Admin', role: 'branch_admin' } });
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="success"
        approval={null}
      />
    );
    expect(screen.queryByTestId('approve-button')).toBeNull();
    expect(screen.queryByTestId('reject-button')).toBeNull();
    expect(screen.getByTestId('approval-status-badge').textContent).toBe('已完成');
  });
});

describe('ApprovalActions — reject modal 必填校验', () => {
  beforeEach(() => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'admin', displayName: 'Admin', role: 'branch_admin' } });
  });

  it('点拒绝 → 弹 modal；reason 空时确认按钮 disabled', () => {
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    fireEvent.click(screen.getByTestId('reject-button'));
    expect(screen.getByTestId('reject-modal')).toBeTruthy();
    const confirm = screen.getByTestId('reject-confirm-button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('填 reason 后确认按钮可点击 → 调用 workflows.reject + 触发 onResolved', async () => {
    const onResolved = vi.fn();
    rejectMock.mockResolvedValue({});
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByTestId('reject-button'));
    const textarea = screen.getByTestId('reject-reason-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '风险评估不足' } });

    const confirm = screen.getByTestId('reject-confirm-button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(rejectMock).toHaveBeenCalledWith(RUN_ID, '风险评估不足');
    });
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it('reason 超长截断到 500 字（input maxLength + 内部 slice 双保险）', () => {
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    fireEvent.click(screen.getByTestId('reject-button'));
    const textarea = screen.getByTestId('reject-reason-input') as HTMLTextAreaElement;
    const longInput = 'a'.repeat(800);
    fireEvent.change(textarea, { target: { value: longInput } });
    expect(textarea.value.length).toBeLessThanOrEqual(500);
  });
});

describe('ApprovalActions — 错误码映射', () => {
  beforeEach(() => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'admin', displayName: 'Admin', role: 'branch_admin' } });
  });

  it('approve 返回 409 → 显示「已被另一审批人处理」', async () => {
    const err = new Error('locked') as Error & { statusCode?: number };
    err.statusCode = 409;
    approveMock.mockRejectedValue(err);

    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    fireEvent.click(screen.getByTestId('approve-button'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-error').textContent).toContain('已被另一审批人处理');
    });
  });

  it('approve 返回 403 → 显示「无权限」', async () => {
    const err = new Error('forbidden') as Error & { statusCode?: number };
    err.statusCode = 403;
    approveMock.mockRejectedValue(err);

    render(
      <ApprovalActions
        runId={RUN_ID}
        status="pending_approval"
        approval={PENDING_APPROVAL}
      />
    );
    fireEvent.click(screen.getByTestId('approve-button'));
    await waitFor(() => {
      expect(screen.getByTestId('approval-error').textContent).toContain('无权限');
    });
  });
});

describe('ApprovalActions — 已批准/已拒绝展示', () => {
  it('approval.approvedBy 已写入 → 渲染审批人 + 时间', () => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'admin', displayName: 'Admin', role: 'branch_admin' } });
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="success"
        approval={{
          ...PENDING_APPROVAL,
          approvedBy: 'admin',
          approvedAt: '2026-04-27T01:00:03.000Z',
        }}
      />
    );
    const resolved = screen.getByTestId('approval-resolved-by');
    expect(resolved.textContent).toContain('admin');
  });

  it('approval.rejectedBy 已写入 → 渲染拒绝人 + reason', () => {
    usePermissionMock.mockReturnValue({ userPermission: { username: 'admin', displayName: 'Admin', role: 'branch_admin' } });
    render(
      <ApprovalActions
        runId={RUN_ID}
        status="failed"
        approval={{
          ...PENDING_APPROVAL,
          rejectedBy: 'admin',
          rejectedAt: '2026-04-27T01:00:04.000Z',
          rejectReason: '风险评估不足',
        }}
      />
    );
    const resolved = screen.getByTestId('approval-resolved-by');
    expect(resolved.textContent).toContain('admin');
    expect(resolved.textContent).toContain('风险评估不足');
  });
});
