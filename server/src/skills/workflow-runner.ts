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

  // 2) 顺序执行节点
  const stepRecords: WorkflowStepRecord[] = [];
  const results: Record<string, SkillResult | undefined> = {};
  const childResults: Record<string, SkillResult | undefined> = {};

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
    report: { narrative: null },
    approval: outcome.pendingApproval,
  };

  if (persist) {
    await saveWorkflowRun(record);
  }
  onStep?.({ type: 'workflow-completed', runId, status: outcome.status, elapsedMs: record.elapsedMs });
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
 * 从 pending_approval 状态恢复 workflow 执行。
 *
 * 不变量：
 * - record.status 必须是 'pending_approval'
 * - record.approval.approverRoles 必须包含 approver.role（branch_admin 不会被特殊放行；
 *   approval 节点本身定义了 ['branch_admin']，所以 admin 通过校验）
 * - 从 record.steps 重建 results / childResults，再从 pendingNodeIndex+1 继续执行
 */
export async function resumeWorkflow(
  runId: string,
  ctx: SkillContext,
  options: ResumeWorkflowOptions,
): Promise<{ record: WorkflowRunRecord }> {
  const persist = options.persist ?? true;
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

  options.onStep?.({
    type: 'workflow-started',
    runId,
    workflowId: workflow.id,
    nodeCount: workflow.nodes.length,
  });

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
    initialStatus: 'success',
  });

  const finishedAt = new Date();
  const record: WorkflowRunRecord = {
    ...prior,
    status: outcome.status,
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - new Date(prior.startedAt).getTime(),
    steps: stepRecords,
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
  return { record };
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
