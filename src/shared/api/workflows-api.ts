/**
 * 工作流子客户端（ApiClient 神类拆分 Phase 2 · workflows 域）
 *
 * 挂载点：apiClient.workflows.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 5 个端点：run/audit/runsHealth 为 GET（富返回类型逐字段保留，不降级为 any）；
 * approve/reject 为 POST（body JSON.stringify）。路由均走 /workflows/ 前缀，
 * 非 /query/，故统一经 this.t.request 收口（不用 queryGet）。
 *
 * 注：原 client.ts 方法的丰富内联返回类型在此**逐字段保留**（不降级为 any），
 *    故对调用方零类型回退。
 */

import { WORKFLOWS_ROUTES } from './routes';
import type { ApiTransport } from './client-core';

export class WorkflowsApi {
  constructor(private readonly t: ApiTransport) {}

  /** 获取 workflow run 完整记录（含 approval 状态） */
  run(runId: string): Promise<{
    runId: string;
    workflowId: string;
    workflowVersion: string;
    status: 'success' | 'partial' | 'failed' | 'pending_approval';
    userId: string;
    username: string;
    requestId: string;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    input: unknown;
    steps: Array<Record<string, unknown>>;
    report?: { narrative: string | null };
    approval?: {
      pendingNodeId: string;
      pendingNodeIndex: number;
      approverRoles: ReadonlyArray<string>;
      approvedBy?: string;
      approvedAt?: string;
      rejectedBy?: string;
      rejectedAt?: string;
      rejectReason?: string;
    } | null;
  }> {
    const path = WORKFLOWS_ROUTES.RUN_BY_ID.replace(':runId', encodeURIComponent(runId));
    return this.t.request(`/${path}`);
  }

  /** 列出指定 runId 的审计事件序列（按时间升序） */
  audit(runId: string): Promise<Array<{
    timestamp: string;
    runId: string;
    workflowId: string;
    eventType: 'workflow-started' | 'step-completed' | 'approval-requested' | 'approval-granted' | 'approval-denied' | 'workflow-completed';
    userId: string;
    role: string;
    requestId: string;
    payload: Record<string, unknown>;
  }>> {
    const path = WORKFLOWS_ROUTES.RUN_AUDIT.replace(':runId', encodeURIComponent(runId));
    return this.t.request(`/${path}`);
  }

  /** 审批通过 pending_approval 的 workflow run，触发 resume */
  approve(runId: string): Promise<Record<string, unknown>> {
    const path = WORKFLOWS_ROUTES.RUN_APPROVE.replace(':runId', encodeURIComponent(runId));
    return this.t.request(`/${path}`, { method: 'POST', body: JSON.stringify({}) });
  }

  /** 拒绝 pending_approval 的 workflow run；reason 透传到 audit + record.approval.rejectReason */
  reject(runId: string, reason?: string): Promise<Record<string, unknown>> {
    const path = WORKFLOWS_ROUTES.RUN_REJECT.replace(':runId', encodeURIComponent(runId));
    return this.t.request(`/${path}`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  /** Workflow run 运维健康汇总（branch_admin only） */
  runsHealth(): Promise<{
    windowHours: number;
    generatedAt: string;
    workflows: Array<{
      workflowId: string;
      total: number;
      counts: Record<'success' | 'partial' | 'failed' | 'pending_approval', number>;
      elapsedMs: { p50: number | null; p95: number | null };
    }>;
    auditLog: {
      totalFileCount: number;
      totalBytes: number;
      earliestEventTime: string | null;
    };
  }> {
    return this.t.request(`/${WORKFLOWS_ROUTES.HEALTH_RUNS_SUMMARY}`);
  }
}
