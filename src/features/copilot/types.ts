/**
 * Copilot 前端类型 — 与后端 server/src/skills/workflow-runner.ts 的 WorkflowStepEvent 镜像
 */

export type CopilotStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface CopilotStepView {
  nodeId: string;
  skillId?: string;
  label: string;
  status: CopilotStepStatus;
  elapsedMs?: number;
  error?: string;
}

export interface CopilotStreamEvent {
  type: 'workflow-started' | 'step-started' | 'step-completed' | 'workflow-completed' | 'stream-end';
  runId: string;
  workflowId?: string;
  nodeId?: string;
  skillId?: string;
  status?: 'success' | 'failed' | 'skipped' | 'partial' | 'pending_approval';
  index?: number;
  elapsedMs?: number;
  error?: string;
  nodeCount?: number;
}

export interface CopilotReportResponse {
  success: boolean;
  data?: {
    runId: string;
    workflowId: string;
    workflowStatus: 'success' | 'partial' | 'failed' | 'pending_approval';
    markdown: string;
    sections: Array<{ nodeId: string; skillId?: string; status: string; title: string; warningCount: number; elapsedMs: number }>;
    redLineWarnings: string[];
    successCount: number;
    failedCount: number;
    skippedCount: number;
    totalElapsedMs: number;
    narrative: string | null;
    /** 阶段 4 PR-D：narrative 来源标记 — 让前端区分是 attach-narrative skill 已落盘的（workflow-skill）还是路由层 LLM 兜底（route-llm）。null 表示无 narrative */
    narrativeSource?: 'workflow-skill' | 'route-llm' | null;
    narrativeMeta: { provider: string; blockedBySqlGuard?: boolean; tokens?: unknown; error?: string } | null;
  };
  error?: string;
}

// ─────────────────────────────────────────────
// 阶段 4 PR-D: workflow audit + approval 类型
// ─────────────────────────────────────────────

export type AuditEventType =
  | 'workflow-started'
  | 'step-completed'
  | 'approval-requested'
  | 'approval-granted'
  | 'approval-denied'
  | 'workflow-completed';

export interface AuditEvent {
  timestamp: string;
  runId: string;
  workflowId: string;
  eventType: AuditEventType;
  userId: string;
  role: string;
  requestId: string;
  payload: Record<string, unknown>;
}

export interface ApprovalState {
  pendingNodeId: string;
  pendingNodeIndex: number;
  approverRoles: ReadonlyArray<string>;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectReason?: string;
}

export interface CopilotRunCreateResponse {
  success: boolean;
  data?: {
    runId: string;
    workflowId: string;
    streamUrl: string;
    reportUrl: string;
  };
  error?: string;
}
