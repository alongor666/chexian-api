/**
 * ApprovalActions — 阶段 4 PR-D
 *
 * 在 copilot 报告页右上角显示审批操作：
 *  - 当前用户 role ∈ approval.approverRoles 且 status='pending_approval' → 显示「批准 / 拒绝」按钮
 *  - 其他角色或非 pending → 仅显示状态徽章（已批准/已拒绝/已完成等）
 *  - 「拒绝」点击后弹 modal 让 approver 填 reason（max 500 字），POST /reject
 *  - 「批准」直接 POST /approve
 *
 * 红线：
 *  - 前端 role 校验只是 UX 层（隐藏按钮）；后端 403 是真正的护栏，不依赖前端判断
 *  - 错误处理：409（并发）显示「已被另一审批人处理」；403 显示「无权限」
 */

import { useId, useState } from 'react';
import { usePermission } from '../../../shared/contexts/PermissionContext';
import { apiClient } from '../../../shared/api/client';
import type { ApprovalState } from '../types';
import {
  badgeStyles,
  buttonStyles,
  cardStyles,
  cn,
  colorClasses,
  inputStyles,
} from '../../../shared/styles';

type WorkflowStatus = 'success' | 'partial' | 'failed' | 'pending_approval';

interface ApprovalActionsProps {
  runId: string;
  status: WorkflowStatus;
  approval: ApprovalState | null | undefined;
  onResolved?: () => void;
}

const STATUS_BADGE: Record<WorkflowStatus, { label: string; className: string }> = {
  success: { label: '已完成', className: cn(badgeStyles.base, badgeStyles.success) },
  partial: { label: '部分成功', className: cn(badgeStyles.base, badgeStyles.warning) },
  failed: { label: '已失败', className: cn(badgeStyles.base, badgeStyles.danger) },
  pending_approval: { label: '待审批', className: cn(badgeStyles.base, badgeStyles.warning) },
};

const REASON_MAX_LENGTH = 500;

function describeError(err: unknown): { message: string; statusCode?: number } {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as Error & { statusCode?: number };
    return { message: e.message ?? '未知错误', statusCode: e.statusCode };
  }
  return { message: String(err) };
}

function formatErrorByCode(err: unknown): string {
  const { message, statusCode } = describeError(err);
  if (statusCode === 409) return '已被另一审批人处理，请刷新';
  if (statusCode === 403) return '无权限：当前角色不在审批人列表内';
  if (statusCode === 404) return '该 workflow run 不存在或已过期';
  return message || '操作失败';
}

export function ApprovalActions({ runId, status, approval, onResolved }: ApprovalActionsProps) {
  const { userPermission } = usePermission();
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reason, setReason] = useState('');
  const reasonInputId = useId();

  const isPending = status === 'pending_approval';
  const role = userPermission?.role;
  const approverRoles = approval?.approverRoles ?? [];
  const canApprove = isPending && !!role && approverRoles.includes(role);
  const badge = STATUS_BADGE[status];

  const handleApprove = async () => {
    setPendingAction('approve');
    setError(null);
    try {
      await apiClient.approveWorkflowRun(runId);
      onResolved?.();
    } catch (err) {
      setError(formatErrorByCode(err));
    } finally {
      setPendingAction(null);
    }
  };

  const handleSubmitReject = async () => {
    setPendingAction('reject');
    setError(null);
    try {
      await apiClient.rejectWorkflowRun(runId, reason || undefined);
      setShowRejectModal(false);
      setReason('');
      onResolved?.();
    } catch (err) {
      setError(formatErrorByCode(err));
    } finally {
      setPendingAction(null);
    }
  };

  const isBusy = pendingAction !== null;

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="approval-actions">
      <span className={badge.className} data-testid="approval-status-badge">
        {badge.label}
      </span>

      {/* 已批准 / 已拒绝 — 只展示，不再操作 */}
      {approval?.approvedBy && (
        <span className={cn('text-xs', colorClasses.text.neutralMuted)} data-testid="approval-resolved-by">
          ✅ {approval.approvedBy} · {approval.approvedAt ? new Date(approval.approvedAt).toLocaleString('zh-CN', { hour12: false }) : ''}
        </span>
      )}
      {approval?.rejectedBy && (
        <span className={cn('text-xs', colorClasses.text.neutralMuted)} data-testid="approval-resolved-by">
          ❌ {approval.rejectedBy}
          {approval.rejectReason ? ` · ${approval.rejectReason}` : ''}
        </span>
      )}

      {canApprove && (
        <div className="flex items-center gap-1.5" data-testid="approval-buttons">
          <button
            type="button"
            data-testid="approve-button"
            onClick={handleApprove}
            disabled={isBusy}
            className={cn(buttonStyles.base, buttonStyles.success, buttonStyles.sizeSmall)}
          >
            {pendingAction === 'approve' ? '批准中…' : '批准'}
          </button>
          <button
            type="button"
            data-testid="reject-button"
            onClick={() => {
              setShowRejectModal(true);
              setError(null);
            }}
            disabled={isBusy}
            className={cn(buttonStyles.base, buttonStyles.danger, buttonStyles.sizeSmall)}
          >
            拒绝
          </button>
        </div>
      )}

      {error && (
        <span
          role="alert"
          data-testid="approval-error"
          className={cn(
            'text-xs px-2 py-0.5 rounded',
            colorClasses.bg.danger,
            colorClasses.text.dangerDark,
          )}
        >
          {error}
        </span>
      )}

      {showRejectModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 dark:bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-modal-title"
          data-testid="reject-modal"
        >
          <div className={cn(cardStyles.spacious, 'w-full max-w-md mx-4 space-y-3')}>
            <h3
              id="reject-modal-title"
              className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
            >
              拒绝该 workflow
            </h3>
            <p className={cn('text-xs', colorClasses.text.neutralMuted)}>
              请填写拒绝原因（最多 {REASON_MAX_LENGTH} 字），将记录到审计日志。
            </p>
            <label htmlFor={reasonInputId} className="sr-only">
              拒绝原因
            </label>
            <textarea
              id={reasonInputId}
              data-testid="reject-reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX_LENGTH))}
              maxLength={REASON_MAX_LENGTH}
              rows={4}
              placeholder="风险评估不足…"
              className={cn(inputStyles.base, inputStyles.default, 'resize-none')}
            />
            <div className={cn('text-right text-xs', colorClasses.text.neutralMuted)}>
              {reason.length} / {REASON_MAX_LENGTH}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowRejectModal(false);
                  setReason('');
                }}
                disabled={isBusy}
                className={cn(buttonStyles.base, buttonStyles.secondary, buttonStyles.sizeSmall)}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="reject-confirm-button"
                onClick={handleSubmitReject}
                disabled={isBusy || reason.trim().length === 0}
                className={cn(buttonStyles.base, buttonStyles.danger, buttonStyles.sizeSmall)}
              >
                {pendingAction === 'reject' ? '提交中…' : '确认拒绝'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
