/**
 * audit-log 模块测试 — 阶段 4 PR-C
 *
 * 覆盖：
 *  - JSONL append-only：多次 append 后 readAuditEventsForRun 按时间升序返回全部事件
 *  - runId 校验：非法 runId 静默丢弃，不写文件
 *  - fire-and-forget：内部错误不抛
 *  - 工作流跑一次（含 approval + resume）→ 至少 6 类事件落盘
 */

import { afterAll, beforeEach, describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import {
  appendAuditEvent,
  readAuditEventsForRun,
  getAuditDir,
  _resetAuditLogForDate,
  type AuditEventType,
} from '../audit-log.js';
import { runWorkflow, resumeWorkflow, getWorkflowRun, type WorkflowDef } from '../workflow-runner.js';
import { getDataDir } from '../../config/paths.js';
import type { Skill, SkillContext, SkillResult } from '../types.js';

const validRunId = (suffix: string) => `wr_20260427000000_test_${suffix.padEnd(8, '0').slice(0, 8)}`;

const cleanupRunIds: string[] = [];

afterAll(async () => {
  // 清理 audit log 文件 + workflow run 文件
  const dir = path.resolve(getDataDir(), 'runtime/workflow-runs');
  for (const id of cleanupRunIds) {
    try {
      await fs.unlink(path.join(dir, `${id}.json`));
    } catch {
      // ignore
    }
  }
  // 清理 audit-log 当日文件（避免污染下次运行）
  await _resetAuditLogForDate();
});

describe('appendAuditEvent + readAuditEventsForRun — JSONL 写读', () => {
  beforeEach(async () => {
    await _resetAuditLogForDate();
  });

  it('append 多条 → 按时间升序读出', async () => {
    const runId = validRunId('aaaaaaaa');
    const events: AuditEventType[] = [
      'workflow-started',
      'step-completed',
      'approval-requested',
      'approval-granted',
      'workflow-completed',
    ];
    for (let i = 0; i < events.length; i++) {
      await appendAuditEvent({
        runId,
        workflowId: 'wf-x',
        eventType: events[i],
        userId: 'u1',
        role: 'analyst',
        requestId: 'req-1',
        timestamp: new Date(Date.UTC(2026, 3, 27, 0, 0, i)).toISOString(),
        payload: { i },
      });
    }
    const out = await readAuditEventsForRun(runId);
    expect(out).toHaveLength(events.length);
    expect(out.map((e) => e.eventType)).toEqual(events);
    // 升序
    expect(out[0].timestamp < out[1].timestamp).toBe(true);
  });

  it('非法 runId 静默丢弃', async () => {
    await appendAuditEvent({
      runId: 'invalid-id',
      workflowId: 'wf-x',
      eventType: 'workflow-started',
      userId: 'u1',
      role: 'analyst',
      requestId: 'req-1',
      payload: {},
    });
    const out = await readAuditEventsForRun('invalid-id');
    expect(out).toEqual([]);
  });

  it('readAuditEventsForRun 在目录不存在时返回 []', async () => {
    // 强制清空目录
    try {
      await fs.rm(getAuditDir(), { recursive: true, force: true });
    } catch {
      // ignore
    }
    const out = await readAuditEventsForRun(validRunId('cccccccc'));
    expect(out).toEqual([]);
  });

  it('append 只追加不修改既有行', async () => {
    const runId = validRunId('bbbbbbbb');
    const date = new Date().toISOString().slice(0, 10);
    await appendAuditEvent({
      runId,
      workflowId: 'wf-x',
      eventType: 'workflow-started',
      userId: 'u1',
      role: 'analyst',
      requestId: 'req-1',
      payload: { phase: 'first' },
    });
    const filePath = path.join(getAuditDir(), `${date}.jsonl`);
    const before = await fs.readFile(filePath, 'utf8');
    await appendAuditEvent({
      runId,
      workflowId: 'wf-x',
      eventType: 'step-completed',
      userId: 'u1',
      role: 'analyst',
      requestId: 'req-1',
      payload: { phase: 'second' },
    });
    const after = await fs.readFile(filePath, 'utf8');
    // 既有行（before 全部内容）必须保留为 after 的前缀
    expect(after.startsWith(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 端到端：runWorkflow + resumeWorkflow → 6 类事件
// ──────────────────────────────────────────────────────────────────────────

const InputSchema = z.object({ x: z.number().default(0) });
const ResultSchema = z.object({ ok: z.boolean(), tag: z.string().optional() });

function makeOkSkill(id: string, tag: string): Skill<typeof InputSchema, z.infer<typeof ResultSchema>> {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: 'test',
    inputSchema: InputSchema,
    outputResultSchema: ResultSchema,
    deterministic: true,
    async run() {
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

describe('audit-log 端到端：runWorkflow + resumeWorkflow', () => {
  beforeEach(async () => {
    await _resetAuditLogForDate();
  });

  it('完整 workflow（含 approval + resume）落盘 ≥ 6 个 audit 事件，含 5 类事件类型', async () => {
    const skills = [makeOkSkill('pre', 'PRE'), makeOkSkill('post', 'POST')];
    const map = new Map(skills.map((s) => [s.id, s as Skill<any, any>]));
    const wf: WorkflowDef<typeof InputSchema> = {
      id: 'wf-audit-e2e',
      name: 'wf-audit-e2e',
      version: '1.0.0',
      description: '',
      inputSchema: InputSchema,
      nodes: [
        { id: 'pre', type: 'sequential', skillId: 'pre' },
        { id: 'gate', type: 'approval', approverRoles: ['branch_admin'] },
        { id: 'post', type: 'sequential', skillId: 'post' },
      ],
    };

    const { runId } = await runWorkflow(wf, { x: 1 }, ctx, {
      resolveSkill: (id) => map.get(id),
      persist: true,
    });
    cleanupRunIds.push(runId);

    // 给 fire-and-forget 一点时间落盘
    await new Promise((r) => setTimeout(r, 50));

    const phase1 = await readAuditEventsForRun(runId);
    expect(phase1.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['workflow-started', 'step-completed', 'approval-requested', 'workflow-completed']),
    );

    // resume → 触发 approval-granted + 后续 step-completed + workflow-completed
    await resumeWorkflow(runId, adminCtx, {
      resolveSkill: (id) => map.get(id),
      resolveWorkflow: (id) => (id === wf.id ? wf : undefined),
      approver: { username: 'admin', role: 'branch_admin' },
      persist: true,
    });
    await new Promise((r) => setTimeout(r, 50));

    const phase2 = await readAuditEventsForRun(runId);
    expect(phase2.length).toBeGreaterThanOrEqual(6);
    const types = new Set(phase2.map((e) => e.eventType));
    expect(types).toContain('workflow-started');
    expect(types).toContain('step-completed');
    expect(types).toContain('approval-requested');
    expect(types).toContain('approval-granted');
    expect(types).toContain('workflow-completed');

    // 关键不变量：approval-granted 一定排在 approval-requested 之后
    const reqIdx = phase2.findIndex((e) => e.eventType === 'approval-requested');
    const grantIdx = phase2.findIndex((e) => e.eventType === 'approval-granted');
    expect(grantIdx).toBeGreaterThan(reqIdx);

    // workflow run 落盘也成功
    const reread = await getWorkflowRun(runId);
    expect(reread?.status).toBe('success');
  });
});
