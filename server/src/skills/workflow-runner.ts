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

export interface RunWorkflowOptions {
  /** 是否落盘，默认 true */
  persist?: boolean;
  /** Skill 解析函数（registry.getSkill） */
  resolveSkill: (skillId: string) => Skill<any, any> | undefined;
}

export async function runWorkflow<I extends ZodTypeAny>(
  workflow: WorkflowDef<I>,
  rawInput: unknown,
  ctx: SkillContext,
  options: RunWorkflowOptions
): Promise<{ runId: string; record: WorkflowRunRecord }> {
  const persist = options.persist ?? true;
  const runId = generateWorkflowRunId(workflow.id);
  const startedAt = new Date(ctx.startedAt);

  // 1) inputSchema 校验
  const parsed = workflow.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Workflow ${workflow.id} input invalid: ${issue?.path.join('.')} - ${issue?.message ?? 'unknown'}`
    );
  }
  const runInput: z.infer<I> = parsed.data;

  // 2) 顺序执行节点
  const stepRecords: WorkflowStepRecord[] = [];
  const results: Record<string, SkillResult | undefined> = {};
  const childResults: Record<string, SkillResult | undefined> = {};

  let overallStatus: WorkflowStatus = 'success';

  for (const node of workflow.nodes) {
    const nodeStartedAt = new Date();
    const execCtx: WorkflowExecCtx = { runInput, results, childResults };

    if (node.type === 'sequential') {
      const skill = options.resolveSkill(node.skillId);
      if (!skill) {
        const rec = buildFailedStepRecord(node, undefined, `skill not found: ${node.skillId}`, nodeStartedAt);
        stepRecords.push(rec);
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
        stepRecords.push({
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
        stepRecords.push(rec);
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
        const skill = options.resolveSkill(b.skillId);
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
      stepRecords.push({
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
        overallStatus = overallStatus === 'failed' ? overallStatus : 'partial';
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
        stepRecords.push({
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
      const skill = options.resolveSkill(target.skillId);
      if (!skill) {
        stepRecords.push(buildFailedStepRecord(node, target.skillId, `skill not found: ${target.skillId}`, nodeStartedAt));
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
        stepRecords.push({
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
        stepRecords.push(buildFailedStepRecord(node, target.skillId, err instanceof Error ? err.message : String(err), nodeStartedAt));
        if ((node.onFailure ?? 'skip-and-continue') === 'stop') {
          overallStatus = 'failed';
          break;
        }
        overallStatus = 'partial';
      }
      continue;
    }

    if (node.type === 'approval') {
      // 阶段 4 实现；当前直接挂起（status=pending_approval），后续节点不再执行
      const finishedAt = new Date();
      stepRecords.push({
        nodeId: node.id,
        nodeType: node.type,
        status: 'skipped',
        startedAt: nodeStartedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: 0,
        error: 'approval node not implemented in stage 2',
      });
      overallStatus = 'pending_approval';
      break;
    }
  }

  const finishedAt = new Date();
  const record: WorkflowRunRecord = {
    runId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    status: overallStatus,
    userId: ctx.userId,
    username: ctx.username,
    requestId: ctx.requestId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    input: runInput,
    steps: stepRecords,
    report: { narrative: null },
  };

  if (persist) {
    await saveWorkflowRun(record);
  }
  return { runId, record };
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
