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
    narrativeMeta: { provider: string; blockedBySqlGuard?: boolean; tokens?: unknown; error?: string } | null;
  };
  error?: string;
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
