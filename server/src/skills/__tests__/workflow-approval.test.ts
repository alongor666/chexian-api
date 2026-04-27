/**
 * workflow-runner approval / resume 单元测试 — 阶段 4 PR-B
 *
 * 用 mock skill 验证审批节点的"挂起 + resume"语义：
 *   1. 含 approval 节点的 workflow → 执行到 approval 时整体 status='pending_approval'，
 *      下游 skill 完全未执行（不允许在审批前调用 pricing-simulation 等下游能力）
 *   2. resumeWorkflow 通过审批 → 从 approval 之后继续，下游 skill 被调用，最终 status='success'
 *   3. resume 时 approver role 不在 approverRoles → ApprovalError(403)
 *   4. 二次 resume 已 success 的 record → ApprovalError(409)
 *
 * 不触碰真实 DuckDB / SQL，纯逻辑测试。
 */

import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  runWorkflow,
  resumeWorkflow,
  ApprovalError,
  saveWorkflowRun,
  getWorkflowRun,
  type WorkflowDef,
  type WorkflowRunRecord,
} from '../workflow-runner.js';
import { getDataDir } from '../../config/paths.js';
import type { Skill, SkillContext, SkillResult } from '../types.js';

// 测试落盘到 server/data/runtime/workflow-runs/（已被 server/.gitignore 覆盖）
// 测试结束后清理本次创建的所有 wr_*.json，避免噪音
const createdRunIds: string[] = [];

afterAll(async () => {
  const dir = path.resolve(getDataDir(), 'runtime/workflow-runs');
  for (const id of createdRunIds) {
    try {
      await fs.unlink(path.join(dir, `${id}.json`));
    } catch {
      // ignore
    }
  }
});

const ctx: SkillContext = {
  userId: 'u1',
  username: 'u1',
  role: 'analyst',
  permissionFilter: '1=1',
  requestId: 'req-test',
  startedAt: Date.now(),
  now: new Date(),
};

const adminCtx: SkillContext = { ...ctx, userId: 'admin', username: 'admin', role: 'branch_admin' };

const InputSchema = z.object({ x: z.number().default(0) });
const ResultSchema = z.object({ ok: z.boolean(), tag: z.string().optional() });

interface CallTracker {
  calls: string[];
}

function makeOkSkill(id: string, tag: string, tracker?: CallTracker): Skill<typeof InputSchema, z.infer<typeof ResultSchema>> {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: 'test',
    inputSchema: InputSchema,
    outputResultSchema: ResultSchema,
    deterministic: true,
    async run() {
      tracker?.calls.push(id);
      return {
        result: { ok: true, tag },
        evidence: [],
        confidence: 1,
        warnings: [],
        assumptions: [],
        dataLineage: [],
        nextSuggestedSkills: [],
      } as SkillResult<z.infer<typeof ResultSchema>>;
    },
  };
}

function makeWorkflow(): WorkflowDef<typeof InputSchema> {
  return {
    id: 'wf-approval-test',
    name: 'wf-approval-test',
    version: '1.0.0',
    description: '',
    inputSchema: InputSchema,
    nodes: [
      { id: 'pre', type: 'sequential', skillId: 'pre' },
      { id: 'gate', type: 'approval', approverRoles: ['branch_admin'] },
      { id: 'post', type: 'sequential', skillId: 'post' },
    ],
  };
}

describe('runWorkflow — approval gating', () => {
  it('遇到 approval 节点 → status=pending_approval，下游 skill 完全未执行', async () => {
    const tracker: CallTracker = { calls: [] };
    const skills = [makeOkSkill('pre', 'PRE', tracker), makeOkSkill('post', 'POST', tracker)];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const wf = makeWorkflow();

    const { runId, record } = await runWorkflow(wf, { x: 1 }, ctx, {
      resolveSkill: (id) => map.get(id),
      persist: true,
    });
    createdRunIds.push(runId);

    expect(record.status).toBe('pending_approval');
    expect(record.steps).toHaveLength(2); // pre + gate（post 未执行）
    expect(record.steps[0].nodeId).toBe('pre');
    expect(record.steps[0].status).toBe('success');
    expect(record.steps[1].nodeId).toBe('gate');
    expect(record.steps[1].nodeType).toBe('approval');
    expect(record.steps[1].status).toBe('skipped'); // approval 节点本身未"通过"，标记 skipped + awaiting
    expect(record.steps[1].error).toBe('awaiting approval');

    // 关键不变量：post skill 在审批前禁止被调用
    expect(tracker.calls).toEqual(['pre']);

    // 审批状态完整落盘
    expect(record.approval).toBeDefined();
    expect(record.approval?.pendingNodeId).toBe('gate');
    expect(record.approval?.pendingNodeIndex).toBe(1);
    expect(record.approval?.approverRoles).toEqual(['branch_admin']);
    expect(record.approval?.approvedBy).toBeUndefined();
    expect(record.approval?.approvedAt).toBeUndefined();

    // 落盘 record 可读回
    const reread = await getWorkflowRun(runId);
    expect(reread?.status).toBe('pending_approval');
  });
});

describe('resumeWorkflow — 通过审批后继续', () => {
  it('approver role=branch_admin → resume 后下游执行，整体 status=success，approval audit 字段写入', async () => {
    const tracker: CallTracker = { calls: [] };
    const skills = [makeOkSkill('pre', 'PRE', tracker), makeOkSkill('post', 'POST', tracker)];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const wf = makeWorkflow();

    const { runId } = await runWorkflow(wf, { x: 1 }, ctx, {
      resolveSkill: (id) => map.get(id),
      persist: true,
    });
    createdRunIds.push(runId);
    expect(tracker.calls).toEqual(['pre']);

    const { record } = await resumeWorkflow(runId, adminCtx, {
      resolveSkill: (id) => map.get(id),
      resolveWorkflow: (id) => (id === wf.id ? wf : undefined),
      approver: { username: 'admin', role: 'branch_admin' },
      persist: true,
    });

    expect(record.status).toBe('success');
    expect(record.steps).toHaveLength(3);
    expect(record.steps[1].status).toBe('success'); // approval 步骤升级为 success
    expect(record.steps[2].nodeId).toBe('post');
    expect(record.steps[2].status).toBe('success');

    // post 仅在 resume 后被调用 1 次（即审批后才执行）
    expect(tracker.calls).toEqual(['pre', 'post']);

    // approval audit 字段
    expect(record.approval?.approvedBy).toBe('admin');
    expect(record.approval?.approvedAt).toBeDefined();
    expect(record.approval?.approverRoles).toEqual(['branch_admin']);

    // 落盘 record 反映最终状态
    const reread = await getWorkflowRun(runId);
    expect(reread?.status).toBe('success');
    expect(reread?.approval?.approvedBy).toBe('admin');
  });
});

describe('resumeWorkflow — 鉴权与状态校验', () => {
  it('approver role 不在 approverRoles → ApprovalError(403)，下游不执行', async () => {
    const tracker: CallTracker = { calls: [] };
    const skills = [makeOkSkill('pre', 'PRE', tracker), makeOkSkill('post', 'POST', tracker)];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const wf = makeWorkflow();

    const { runId } = await runWorkflow(wf, {}, ctx, {
      resolveSkill: (id) => map.get(id),
      persist: true,
    });
    createdRunIds.push(runId);

    const wrongRoleCtx: SkillContext = { ...ctx, role: 'analyst' };
    await expect(
      resumeWorkflow(runId, wrongRoleCtx, {
        resolveSkill: (id) => map.get(id),
        resolveWorkflow: (id) => (id === wf.id ? wf : undefined),
        approver: { username: 'analyst1', role: 'analyst' },
        persist: false,
      }),
    ).rejects.toMatchObject({
      name: 'ApprovalError',
      statusCode: 403,
    });

    // 关键不变量：被拒绝的审批不能让下游执行
    expect(tracker.calls).toEqual(['pre']);

    // 记录仍是 pending_approval
    const reread = await getWorkflowRun(runId);
    expect(reread?.status).toBe('pending_approval');
  });

  it('未找到 run → ApprovalError(404)', async () => {
    await expect(
      resumeWorkflow(
        // 合法格式但不存在
        'wr_20260101000000_unknown_abcdef12',
        adminCtx,
        {
          resolveSkill: () => undefined,
          resolveWorkflow: () => undefined,
          approver: { username: 'admin', role: 'branch_admin' },
          persist: false,
        },
      ),
    ).rejects.toMatchObject({ name: 'ApprovalError', statusCode: 404 });
  });

  it('record.status 不是 pending_approval → ApprovalError(409)', async () => {
    const fakeRecord: WorkflowRunRecord = {
      runId: 'wr_20260101000000_fake_aaaaaaaa',
      workflowId: 'wf-approval-test',
      workflowVersion: '1.0.0',
      status: 'success',
      userId: 'u',
      username: 'u',
      requestId: 'r',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: 0,
      input: {},
      steps: [],
      report: { narrative: null },
    };
    await saveWorkflowRun(fakeRecord);
    createdRunIds.push(fakeRecord.runId);

    await expect(
      resumeWorkflow(fakeRecord.runId, adminCtx, {
        resolveSkill: () => undefined,
        resolveWorkflow: () => makeWorkflow(),
        approver: { username: 'admin', role: 'branch_admin' },
        persist: false,
      }),
    ).rejects.toMatchObject({ name: 'ApprovalError', statusCode: 409 });
  });

  it('ApprovalError 是 Error 子类（runtime 检测可用 instanceof）', () => {
    const err = new ApprovalError(403, 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.statusCode).toBe(403);
  });
});
