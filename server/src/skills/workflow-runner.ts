/**
 * Workflow Runner — 阶段 2
 *
 * 状态机编排器：按 nodes/edges 顺序执行 Skill，节点类型 sequential / parallel / branch。
 * - skip-and-continue：单步 Skill 失败 → 不抛异常、保留 stepError、整体 status = 'partial'
 * - 步骤间数据传递：每步可声明 inputBuilder(prevResults, runInput) 动态构造下游 input
 * - 持久化：与 SkillRunRecord 平行结构，落盘到 server/data/runtime/workflow-runs/{runId}.json
 * - 阶段 4 将扩展 approval 节点（暂不实现，但 NodeType 已留枚举位）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z, ZodTypeAny } from 'zod';
import { getDataDir } from '../config/paths.js';
import type { Skill, SkillContext, SkillResult } from './types.js';
import { runSkill } from './runner.js';
import { appendAuditEvent, type AuditEventType } from './audit-log.js';

// ───────────────────────── Audit helpers ─────────────────────────

/**
 * 安全调用 audit-log。永远不阻塞主流程，错误吞掉。
 *
 * 调用点：workflow-started / step-completed / approval-requested /
 *          approval-granted / workflow-completed
 * （approval-denied 由 routes/workflows.ts 在 reject 路径调用）
 */
function emitAuditEvent(
  eventType: AuditEventType,
  runId: string,
  workflowId: string,
  ctx: SkillContext,
  payload: Record<string, unknown>,
): void {
  // fire-and-forget；不 await，避免 latency 累积；audit-log 内部已 try/catch 吞错
  void appendAuditEvent({
    runId,
    workflowId,
    eventType,
    userId: ctx.userId,
    role: ctx.role,
    requestId: ctx.requestId,
    payload,
  });
}

/** 节点级简要 payload，禁止包含原始数据 */
function buildStepCompletedPayload(record: WorkflowStepRecord): Record<string, unknown> {
  return {
    nodeId: record.nodeId,
    nodeType: record.nodeType,
    skillId: record.skillId,
    status: record.status,
    runId: record.runId,
    elapsedMs: record.elapsedMs,
    error: record.error,
    childCount: record.children?.length,
  };
}

// ───────────────────────── Types ─────────────────────────

export type WorkflowStatus = 'success' | 'partial' | 'failed' | 'pending_approval';

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface BuiltStepInput {
  /** 直接传给 Skill 的原始 input */
  input: unknown;
}

/**
 * 单个工作流节点。
 * type: 'sequential'（默认）→ 一步一个 Skill
 *       'parallel'        → 并行多个 Skill（共享上一步输出）
 *       'branch'          → 根据上一步输出选择分支（只取第一个返回 true 的 case）
 *       'approval'        → 阶段 4 引入；当前由 routes/workflows.ts 检测后挂起
 */
export type WorkflowNode =
  | SequentialNode
  | ParallelNode
  | BranchNode
  | ApprovalNode;

export interface SequentialNode {
  id: string;
  type: 'sequential';
  skillId: string;
  /** 失败策略，默认 'skip-and-continue' */
  onFailure?: 'skip-and-continue' | 'stop';
  /**
   * 构造 Skill 输入：可访问之前所有步骤的 result + workflow runInput
   * 默认直接传 runInput
   */
  inputBuilder?: (ctx: WorkflowExecCtx) => unknown;
}

export interface ParallelNode {
  id: string;
  type: 'parallel';
  branches: ReadonlyArray<{
    id: string;
    skillId: string;
    inputBuilder?: (ctx: WorkflowExecCtx) => unknown;
  }>;
  onFailure?: 'skip-and-continue' | 'stop';
}

export interface BranchNode {
  id: string;
  type: 'branch';
  cases: ReadonlyArray<{
    id: string;
    when: (ctx: WorkflowExecCtx) => boolean;
    skillId: string;
    inputBuilder?: (ctx: WorkflowExecCtx) => unknown;
  }>;
  /** 没有任何 case 命中时的 fallback skillId，可选 */
  fallback?: { skillId: string; inputBuilder?: (ctx: WorkflowExecCtx) => unknown };
  onFailure?: 'skip-and-continue' | 'stop';
}

export interface ApprovalNode {
  id: string;
  type: 'approval';
  /** 阶段 4 实现，当前仅占位 */
  approverRoles: ReadonlyArray<string>;
}

export interface WorkflowDef<I extends ZodTypeAny = ZodTypeAny> {
  id: string;
  name: string;
  version: string;
  description: string;
  inputSchema: I;
  nodes: ReadonlyArray<WorkflowNode>;
}

export interface WorkflowStepRecord {
  nodeId: string;
  nodeType: WorkflowNode['type'];
  skillId?: string;
  /** parallel/branch 节点的子结果 */
  children?: ReadonlyArray<{
    branchId: string;
    skillId: string;
    status: StepStatus;
    runId?: string;
    result?: SkillResult;
    error?: string;
    elapsedMs: number;
  }>;
  status: StepStatus;
  runId?: string;
  result?: SkillResult;
  error?: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
}

/**
 * 阶段 4 PR-B：审批状态。挂起时由 runner 写入；resume 后填充 approver 字段。
 * 阶段 4 PR-C：扩展 reject 路径字段（rejectedBy / rejectedAt / rejectReason）
 */
export interface WorkflowApprovalState {
  /** 当前挂起的 approval 节点 ID（与 nodes[pendingNodeIndex].id 一致） */
  pendingNodeId: string;
  /** 挂起节点在 workflow.nodes 中的下标（resume 从 +1 继续） */
  pendingNodeIndex: number;
  /** 挂起时的 approverRoles 快照 */
  approverRoles: ReadonlyArray<string>;
  approvedBy?: string;
  approvedAt?: string;
  /** 阶段 4 PR-C：拒绝审批 */
  rejectedBy?: string;
  rejectedAt?: string;
  rejectReason?: string;
}

export interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  workflowVersion: string;
  status: WorkflowStatus;
  userId: string;
  username: string;
  requestId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  input: unknown;
  steps: ReadonlyArray<WorkflowStepRecord>;
  /** 阶段 4 attach-narrative / approval 用 */
  report?: { narrative: string | null };
  /** 阶段 4 PR-B：审批节点状态 */
  approval?: WorkflowApprovalState;
}

export interface WorkflowExecCtx {
  /** 工作流运行原始 input（已通过 inputSchema） */
  runInput: unknown;
  /** 已完成步骤的结果索引：nodeId → SkillResult */
  results: Readonly<Record<string, SkillResult | undefined>>;
  /** parallel/branch 节点内部的子结果索引：`${nodeId}.${branchId}` → SkillResult */
  childResults: Readonly<Record<string, SkillResult | undefined>>;
}

// ───────────────────────── Run Store ─────────────────────────

const RUNTIME_SUBDIR = 'runtime/workflow-runs';
const RUN_ID_PATTERN = /^wr_\d{14}_[a-z0-9-]{1,64}_[0-9a-f]{8}$/;

function getRunsDir(): string {
  return path.resolve(getDataDir(), RUNTIME_SUBDIR);
}

function resolveRunPath(runId: string): string | null {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return null;
  const runsDir = getRunsDir();
  const candidate = path.resolve(runsDir, `${runId}.json`);
  const rel = path.relative(runsDir, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

/** resume 互斥锁路径：与 record JSON 同目录，扩展名 .lock，O_EXCL 创建（原子） */
function resolveLockPath(runId: string): string | null {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return null;
  const runsDir = getRunsDir();
  const candidate = path.resolve(runsDir, `${runId}.lock`);
  const rel = path.relative(runsDir, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

function generateWorkflowRunId(workflowId: string): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const uid = randomUUID().slice(0, 8);
  const safeId = workflowId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'unknown';
  return `wr_${ts}_${safeId}_${uid}`;
}

async function ensureRunsDir(): Promise<void> {
  await fs.mkdir(getRunsDir(), { recursive: true });
}

export async function saveWorkflowRun(record: WorkflowRunRecord): Promise<void> {
  const filePath = resolveRunPath(record.runId);
  if (!filePath) throw new Error(`Invalid workflow runId: ${record.runId}`);
  await ensureRunsDir();
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunRecord | null> {
  const filePath = resolveRunPath(runId);
  if (!filePath) return null;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as WorkflowRunRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface ListWorkflowRunsOptions {
  workflowId?: string;
  username?: string;
  status?: WorkflowStatus;
  limit?: number;
}

export async function listWorkflowRuns(options: ListWorkflowRunsOptions = {}): Promise<WorkflowRunRecord[]> {
  await ensureRunsDir();
  const dir = getRunsDir();
  const files = await fs.readdir(dir);
  const records: WorkflowRunRecord[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const rec = JSON.parse(raw) as WorkflowRunRecord;
      if (options.workflowId && rec.workflowId !== options.workflowId) continue;
      if (options.username && rec.username !== options.username) continue;
      if (options.status && rec.status !== options.status) continue;
      records.push(rec);
    } catch {
      // 损坏跳过
    }
  }
  records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return options.limit ? records.slice(0, options.limit) : records;
}

// ───────────────────────── Runner ─────────────────────────

export type WorkflowStepEvent =
  | { type: 'workflow-started'; runId: string; workflowId: string; nodeCount: number }
  | { type: 'step-started'; runId: string; nodeId: string; skillId?: string; index: number }
  | { type: 'step-completed'; runId: string; nodeId: string; skillId?: string; status: StepStatus; elapsedMs: number; error?: string }
  | { type: 'workflow-completed'; runId: string; status: WorkflowStatus; elapsedMs: number };

export interface RunWorkflowOptions {
  /** 是否落盘，默认 true */
  persist?: boolean;
  /** Skill 解析函数（registry.getSkill） */
  resolveSkill: (skillId: string) => Skill<any, any> | undefined;
  /** 阶段 3：每步前后回调（用于 SSE 实时推送，不影响执行流程） */
  onStep?: (event: WorkflowStepEvent) => void;
  /** 外部预生成的 runId（阶段 3：copilot 路由先生成 runId 再异步执行，前端 SSE 可立即订阅） */
  preassignedRunId?: string;
}

/**
 * 内部执行结果：核心循环抽出来供 runWorkflow / resumeWorkflow 复用。
 */
interface ExecuteNodesOutcome {
  status: WorkflowStatus;
  pendingApproval?: WorkflowApprovalState;
}

interface ExecuteNodesParams {
  workflow: WorkflowDef<ZodTypeAny>;
  runInput: unknown;
  ctx: SkillContext;
  resolveSkill: RunWorkflowOptions['resolveSkill'];
  onStep?: RunWorkflowOptions['onStep'];
  startIndex: number;
  /** 已有 step records（resume 时来自 prior run），新执行的 step 直接 push 进去 */
  stepRecords: WorkflowStepRecord[];
  /** 已有 results（resume 时从 prior run.steps 重建） */
  results: Record<string, SkillResult | undefined>;
  childResults: Record<string, SkillResult | undefined>;
  runId: string;
  /** 初始 status，resume 时通常是 'success'（前置已完成），可被本次失败下调 */
  initialStatus: WorkflowStatus;
  /**
   * 阶段 4 PR-C：narrative bucket。当 attach-narrative skill 执行成功时，
   * runner 把 result.result.narrative 写入此引用，外层在落盘时合并到 record.report.narrative。
   * 之所以用 ref 而不是 return value，是为了让 resume 与 fresh run 共用 executeNodes 入口
   * 而不强行扩展 ExecuteNodesOutcome 形状。
   */
  narrativeRef?: { value: string | null };
}

/** attach-narrative skill 的最小输出形状（避免循环依赖） */
function extractNarrativeFromResult(skillId: string, result: SkillResult | undefined): string | null {
  if (skillId !== 'attach-narrative' || !result) return null;
  const r = result.result as { narrative?: unknown } | undefined;
  if (r && typeof r.narrative === 'string') return r.narrative;
  return null;
}

async function executeNodes(params: ExecuteNodesParams): Promise<ExecuteNodesOutcome> {
  const {
    workflow,
    runInput,
    ctx,
    resolveSkill,
    onStep,
    startIndex,
    stepRecords,
    results,
    childResults,
    runId,
    initialStatus,
    narrativeRef,
  } = params;

  let overallStatus: WorkflowStatus = initialStatus;
  let pendingApproval: WorkflowApprovalState | undefined;

  const pushStep = (record: WorkflowStepRecord) => {
    stepRecords.push(record);
    onStep?.({
      type: 'step-completed',
      runId,
      nodeId: record.nodeId,
      skillId: record.skillId,
      status: record.status,
      elapsedMs: record.elapsedMs,
      error: record.error,
    });
    emitAuditEvent('step-completed', runId, workflow.id, ctx, buildStepCompletedPayload(record));

    // 阶段 4 PR-C：attach-narrative 节点完成后注入 narrative
    if (
      narrativeRef &&
      record.status === 'success' &&
      record.skillId === 'attach-narrative' &&
      record.result
    ) {
      const text = extractNarrativeFromResult(record.skillId, record.result);
      if (text !== null) {
        narrativeRef.value = text;
      }
    }
  };

  for (let nodeIndex = startIndex; nodeIndex < workflow.nodes.length; nodeIndex++) {
    const node = workflow.nodes[nodeIndex];
    const nodeStartedAt = new Date();
    const execCtx: WorkflowExecCtx = { runInput, results, childResults };
    const nodeSkillIdHint = node.type === 'sequential' ? node.skillId : node.type === 'branch' ? undefined : undefined;
    onStep?.({ type: 'step-started', runId, nodeId: node.id, skillId: nodeSkillIdHint, index: nodeIndex });

    if (node.type === 'sequential') {
      const skill = resolveSkill(node.skillId);
      if (!skill) {
        const rec = buildFailedStepRecord(node, undefined, `skill not found: ${node.skillId}`, nodeStartedAt);
        pushStep(rec);
        if ((node.onFailure ?? 'skip-and-continue') === 'stop') {
          overallStatus = 'failed';
          break;
        }
        overallStatus = 'partial';
        continue;
      }
      const input = node.inputBuilder ? node.inputBuilder(execCtx) : runInput;
      try {
        const { runId: stepRunId, result } = await runSkill(skill, input, ctx);
        const finishedAt = new Date();
        results[node.id] = result;
        pushStep({
          nodeId: node.id,
          nodeType: node.type,
          skillId: node.skillId,
          status: 'success',
          runId: stepRunId,
          result,
          startedAt: nodeStartedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          elapsedMs: finishedAt.getTime() - nodeStartedAt.getTime(),
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const rec = buildFailedStepRecord(node, undefined, errMsg, nodeStartedAt);
        pushStep(rec);
        if ((node.onFailure ?? 'skip-and-continue') === 'stop') {
          overallStatus = 'failed';
          break;
        }
        overallStatus = 'partial';
      }
      continue;
    }

    if (node.type === 'parallel') {
      const promises = node.branches.map(async (b) => {
        const skill = resolveSkill(b.skillId);
        const branchStarted = new Date();
        if (!skill) {
          return {
            branchId: b.id,
            skillId: b.skillId,
            status: 'failed' as const,
            error: `skill not found: ${b.skillId}`,
            elapsedMs: 0,
          };
        }
        const input = b.inputBuilder ? b.inputBuilder(execCtx) : runInput;
        try {
          const { runId: stepRunId, result } = await runSkill(skill, input, ctx);
          childResults[`${node.id}.${b.id}`] = result;
          const elapsed = Date.now() - branchStarted.getTime();
          return {
            branchId: b.id,
            skillId: b.skillId,
            status: 'success' as const,
            runId: stepRunId,
            result,
            elapsedMs: elapsed,
          };
        } catch (err) {
          const elapsed = Date.now() - branchStarted.getTime();
          return {
            branchId: b.id,
            skillId: b.skillId,
            status: 'failed' as const,
            error: err instanceof Error ? err.message : String(err),
            elapsedMs: elapsed,
          };
        }
      });
      const children = await Promise.all(promises);
      const finishedAt = new Date();
      const anyFailed = children.some((c) => c.status === 'failed');
      const allFailed = children.every((c) => c.status === 'failed');
      pushStep({
        nodeId: node.id,
        nodeType: node.type,
        children,
        status: allFailed ? 'failed' : anyFailed ? 'skipped' : 'success',
        startedAt: nodeStartedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: finishedAt.getTime() - nodeStartedAt.getTime(),
      });
      if (allFailed) {
        if ((node.onFailure ?? 'skip-and-continue') === 'stop') {
          overallStatus = 'failed';
          break;
        }
        overallStatus = 'partial';
      } else if (anyFailed) {
        // 'failed' 已在上面分支 break；走到这里 overallStatus 只可能是 'success' | 'partial'
        overallStatus = 'partial';
      }
      continue;
    }

    if (node.type === 'branch') {
      const matched = node.cases.find((c) => {
        try {
          return c.when(execCtx);
        } catch {
          return false;
        }
      });
      const target = matched ?? (node.fallback ? { id: 'fallback', skillId: node.fallback.skillId, inputBuilder: node.fallback.inputBuilder } : null);
      if (!target) {
        // 没有任何分支命中且无 fallback：跳过
        const finishedAt = new Date();
        pushStep({
          nodeId: node.id,
          nodeType: node.type,
          status: 'skipped',
          startedAt: nodeStartedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          elapsedMs: finishedAt.getTime() - nodeStartedAt.getTime(),
          error: 'no branch matched, no fallback',
        });
        // 'skipped' 不下调 status（与 v1.1 §11 设计一致：分支未命中是正常路径）
        continue;
      }
      const skill = resolveSkill(target.skillId);
      if (!skill) {
        pushStep(buildFailedStepRecord(node, target.skillId, `skill not found: ${target.skillId}`, nodeStartedAt));
        if ((node.onFailure ?? 'skip-and-continue') === 'stop') {
          overallStatus = 'failed';
          break;
        }
        overallStatus = 'partial';
        continue;
      }
      const input = target.inputBuilder ? target.inputBuilder(execCtx) : runInput;
      try {
        const { runId: stepRunId, result } = await runSkill(skill, input, ctx);
        const finishedAt = new Date();
        results[node.id] = result;
        pushStep({
          nodeId: node.id,
          nodeType: node.type,
          skillId: target.skillId,
          status: 'success',
          runId: stepRunId,
          result,
          startedAt: nodeStartedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          elapsedMs: finishedAt.getTime() - nodeStartedAt.getTime(),
        });
      } catch (err) {
        pushStep(buildFailedStepRecord(node, target.skillId, err instanceof Error ? err.message : String(err), nodeStartedAt));
        if ((node.onFailure ?? 'skip-and-continue') === 'stop') {
          overallStatus = 'failed';
          break;
        }
        overallStatus = 'partial';
      }
      continue;
    }

    if (node.type === 'approval') {
      // 阶段 4 PR-B：写入 pending_approval 步骤记录，挂起整个 workflow，
      // 等待 routes/workflows.ts 的 /approve 端点调用 resumeWorkflow 才继续。
      const finishedAt = new Date();
      pushStep({
        nodeId: node.id,
        nodeType: node.type,
        status: 'skipped',
        startedAt: nodeStartedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: 0,
        error: 'awaiting approval',
      });
      pendingApproval = {
        pendingNodeId: node.id,
        pendingNodeIndex: nodeIndex,
        approverRoles: node.approverRoles,
      };
      overallStatus = 'pending_approval';
      // 阶段 4 PR-C：approval 挂起 → audit 事件
      emitAuditEvent('approval-requested', runId, workflow.id, ctx, {
        nodeId: node.id,
        nodeIndex,
        approverRoles: node.approverRoles,
      });
      break;
    }
  }

  return { status: overallStatus, pendingApproval };
}

export async function runWorkflow<I extends ZodTypeAny>(
  workflow: WorkflowDef<I>,
  rawInput: unknown,
  ctx: SkillContext,
  options: RunWorkflowOptions
): Promise<{ runId: string; record: WorkflowRunRecord }> {
  const persist = options.persist ?? true;
  const runId = options.preassignedRunId ?? generateWorkflowRunId(workflow.id);
  const startedAt = new Date(ctx.startedAt);
  const onStep = options.onStep;

  // 1) inputSchema 校验
  const parsed = workflow.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Workflow ${workflow.id} input invalid: ${issue?.path.join('.')} - ${issue?.message ?? 'unknown'}`
    );
  }
  const runInput: z.infer<I> = parsed.data;

  onStep?.({ type: 'workflow-started', runId, workflowId: workflow.id, nodeCount: workflow.nodes.length });
  emitAuditEvent('workflow-started', runId, workflow.id, ctx, {
    nodeCount: workflow.nodes.length,
    workflowVersion: workflow.version,
  });

  // 2) 顺序执行节点
  const stepRecords: WorkflowStepRecord[] = [];
  const results: Record<string, SkillResult | undefined> = {};
  const childResults: Record<string, SkillResult | undefined> = {};
  const narrativeRef: { value: string | null } = { value: null };

  const outcome = await executeNodes({
    workflow,
    runInput,
    ctx,
    resolveSkill: options.resolveSkill,
    onStep,
    startIndex: 0,
    stepRecords,
    results,
    childResults,
    runId,
    initialStatus: 'success',
    narrativeRef,
  });

  const finishedAt = new Date();
  const record: WorkflowRunRecord = {
    runId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    status: outcome.status,
    userId: ctx.userId,
    username: ctx.username,
    requestId: ctx.requestId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    input: runInput,
    steps: stepRecords,
    report: { narrative: narrativeRef.value },
    approval: outcome.pendingApproval,
  };

  if (persist) {
    await saveWorkflowRun(record);
  }
  onStep?.({ type: 'workflow-completed', runId, status: outcome.status, elapsedMs: record.elapsedMs });
  emitAuditEvent('workflow-completed', runId, workflow.id, ctx, {
    status: outcome.status,
    elapsedMs: record.elapsedMs,
    stepCount: stepRecords.length,
    hasNarrative: narrativeRef.value !== null,
  });
  return { runId, record };
}

/** 暴露 runId 生成器供 copilot 路由预先订阅 SSE */
export { generateWorkflowRunId };

// ───────────────────────── Resume (阶段 4 PR-B) ─────────────────────────

export class ApprovalError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface ResumeWorkflowOptions {
  resolveSkill: RunWorkflowOptions['resolveSkill'];
  /** workflow 定义解析（registry.getWorkflow），用于按 runRecord.workflowId 取回 nodes 序列 */
  resolveWorkflow: (workflowId: string) => WorkflowDef<any> | undefined;
  /** 通过审批的人，必须 role ∈ approverRoles，否则 403 */
  approver: { username: string; role: string };
  onStep?: RunWorkflowOptions['onStep'];
  persist?: boolean;
}

/**
 * 从 prior steps 推导 resume 的 initialStatus。
 *
 * 触发场景（codex P1）：前置 5 步 skip-and-continue 配置允许 partial，
 * 即 approval 之前可能已有 failed step。如果 initialStatus 强行设为 'success'，
 * resume 后整体会被误报为成功。规则：
 *   - 任一历史 step.status === 'failed' → 'partial'
 *   - 任一历史 parallel children 中 status === 'failed' → 'partial'
 *   - approval 节点的 'skipped'/'awaiting' 不算失败（已在外层升级为 success）
 *   - 否则 → 'success'
 */
function deriveInitialStatusFromHistory(
  steps: ReadonlyArray<WorkflowStepRecord>,
  approvalNodeId: string,
): WorkflowStatus {
  for (const step of steps) {
    if (step.nodeId === approvalNodeId) continue;
    if (step.status === 'failed') return 'partial';
    if (step.children) {
      for (const child of step.children) {
        if (child.status === 'failed') return 'partial';
      }
    }
  }
  return 'success';
}

/**
 * 抢占 resume 互斥锁（codex P2）。
 *
 * 用 fs.open(lockPath, 'wx') —— POSIX `O_CREAT | O_EXCL`，文件已存在即抛 EEXIST，
 * 操作系统层面保证原子。两个并发 approve 请求只有一个能持锁；持锁失败抛
 * ApprovalError(409)，调用方知道有审批正在进行，避免下游 skill 被重复执行。
 *
 * 锁文件内容写入 approver / pid，便于死锁排查；finally 中通过 unlinkLock 释放。
 */
async function acquireResumeLock(runId: string, approver: string): Promise<string> {
  const lockPath = resolveLockPath(runId);
  if (!lockPath) {
    throw new ApprovalError(400, `Invalid runId: ${runId}`);
  }
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle: import('node:fs/promises').FileHandle | null = null;
  try {
    handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(
      JSON.stringify({ approver, pid: process.pid, lockedAt: new Date().toISOString() }),
      'utf8',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ApprovalError(409, `Workflow run ${runId} is being approved by another request`);
    }
    throw err;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
  return lockPath;
}

async function releaseResumeLock(lockPath: string): Promise<void> {
  try {
    await fs.unlink(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // 锁文件已不存在（比如人工清理）不算错误；其他错误吞掉以免覆盖原始业务异常
    }
  }
}

/**
 * 从 pending_approval 状态恢复 workflow 执行。
 *
 * 不变量：
 * - record.status 必须是 'pending_approval'
 * - record.approval.approverRoles 必须包含 approver.role
 * - 从 record.steps 重建 results / childResults，再从 pendingNodeIndex+1 继续执行
 * - 同一 runId 的并发 approve 由 fs O_EXCL 锁保证只能成功一次（codex P2）
 * - resume 起始 status 从 prior.steps 派生，保留前置失败的 'partial' 信号（codex P1）
 */
export async function resumeWorkflow(
  runId: string,
  ctx: SkillContext,
  options: ResumeWorkflowOptions,
): Promise<{ record: WorkflowRunRecord }> {
  const persist = options.persist ?? true;

  // 1) 抢锁（原子）— 失败立即 409，避免后续 read 又被并发请求看到 pending_approval
  const lockPath = await acquireResumeLock(runId, options.approver.username);

  try {
    const prior = await getWorkflowRun(runId);
    if (!prior) {
      throw new ApprovalError(404, `Workflow run not found: ${runId}`);
    }
    if (prior.status !== 'pending_approval') {
      throw new ApprovalError(409, `Workflow run is not pending approval (status=${prior.status})`);
    }
    const approval = prior.approval;
    if (!approval) {
      throw new ApprovalError(500, `Workflow run is pending_approval but missing approval state`);
    }
    if (!approval.approverRoles.includes(options.approver.role)) {
      throw new ApprovalError(
        403,
        `Approver role '${options.approver.role}' is not in approverRoles [${approval.approverRoles.join(', ')}]`,
      );
    }

    const workflow = options.resolveWorkflow(prior.workflowId);
    if (!workflow) {
      throw new ApprovalError(500, `Workflow definition not found for resume: ${prior.workflowId}`);
    }

    // 校验 pendingNodeIndex 与 nodes 一致（防止 workflow 版本变更后 schema 漂移）
    const pendingNode = workflow.nodes[approval.pendingNodeIndex];
    if (!pendingNode || pendingNode.type !== 'approval' || pendingNode.id !== approval.pendingNodeId) {
      throw new ApprovalError(
        500,
        `Workflow definition drift: nodes[${approval.pendingNodeIndex}] does not match pending approval node '${approval.pendingNodeId}'`,
      );
    }

    // 重建 results / childResults
    const stepRecords: WorkflowStepRecord[] = [...prior.steps];
    const results: Record<string, SkillResult | undefined> = {};
    const childResults: Record<string, SkillResult | undefined> = {};
    for (const step of prior.steps) {
      if (step.status === 'success' && step.result) {
        results[step.nodeId] = step.result;
      }
      if (step.children) {
        for (const child of step.children) {
          if (child.status === 'success' && child.result) {
            childResults[`${step.nodeId}.${child.branchId}`] = child.result;
          }
        }
      }
    }

    // 标记审批通过：把原 'skipped' / awaiting 状态升级为 'success'
    const approvedAt = new Date().toISOString();
    const approvalStepIndex = stepRecords.findIndex((s) => s.nodeId === approval.pendingNodeId);
    if (approvalStepIndex >= 0) {
      const old = stepRecords[approvalStepIndex];
      stepRecords[approvalStepIndex] = {
        ...old,
        status: 'success',
        error: undefined,
        finishedAt: approvedAt,
      };
    }

    // codex P1：从历史 steps 推导起始 status，保留前置 partial 信号
    const initialStatus = deriveInitialStatusFromHistory(prior.steps, approval.pendingNodeId);

    options.onStep?.({
      type: 'workflow-started',
      runId,
      workflowId: workflow.id,
      nodeCount: workflow.nodes.length,
    });
    emitAuditEvent('approval-granted', runId, workflow.id, ctx, {
      nodeId: approval.pendingNodeId,
      approvedBy: options.approver.username,
      approverRole: options.approver.role,
    });

    const narrativeRef: { value: string | null } = { value: prior.report?.narrative ?? null };

    const outcome = await executeNodes({
      workflow,
      runInput: prior.input,
      ctx,
      resolveSkill: options.resolveSkill,
      onStep: options.onStep,
      startIndex: approval.pendingNodeIndex + 1,
      stepRecords,
      results,
      childResults,
      runId,
      initialStatus,
      narrativeRef,
    });

    const finishedAt = new Date();
    const record: WorkflowRunRecord = {
      ...prior,
      status: outcome.status,
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - new Date(prior.startedAt).getTime(),
      steps: stepRecords,
      report: { narrative: narrativeRef.value },
      approval: outcome.pendingApproval ?? {
        ...approval,
        approvedBy: options.approver.username,
        approvedAt,
      },
    };

    if (persist) {
      await saveWorkflowRun(record);
    }
    options.onStep?.({
      type: 'workflow-completed',
      runId,
      status: outcome.status,
      elapsedMs: record.elapsedMs,
    });
    emitAuditEvent('workflow-completed', runId, workflow.id, ctx, {
      status: outcome.status,
      elapsedMs: record.elapsedMs,
      stepCount: stepRecords.length,
      hasNarrative: narrativeRef.value !== null,
    });
    return { record };
  } finally {
    await releaseResumeLock(lockPath);
  }
}

function buildFailedStepRecord(
  node: WorkflowNode,
  skillId: string | undefined,
  error: string,
  startedAt: Date
): WorkflowStepRecord {
  const finishedAt = new Date();
  return {
    nodeId: node.id,
    nodeType: node.type,
    skillId,
    status: 'failed',
    error,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
