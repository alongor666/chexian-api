/**
 * /api/workflows/runs/:runId/audit + /reject HTTP 集成测试 — 阶段 4 PR-C
 *
 * 验证：
 *  - GET /audit 未鉴权 → 401
 *  - GET /audit 跨用户访问 → 403
 *  - GET /audit 自己的 run → 200，事件序列含 workflow-started + step-completed + approval-requested
 *  - POST /reject 错误角色 → 403
 *  - POST /reject 正确 admin → 200，record.status='failed'，audit 含 approval-denied
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Server } from 'http';
import { z } from 'zod';
import os from 'node:os';

// ── 审计目录隔离（防跨文件竞态）─────────────────────────────────────────────
// 多个测试文件并行读/写/删共享的 server/data/runtime/audit-log/{今天}.jsonl 会互相
// 清空对方数据（_resetAuditLogForDate / fs.rm / GC）。给本文件指定独立临时审计目录，
// 使 appendAuditEvent（写）与 GET /audit（读）都落在隔离目录，彻底消除竞态。
const _prevAuditDir = process.env.AUDIT_LOG_DIR;
let _isolatedAuditDir = '';

beforeAll(async () => {
  _isolatedAuditDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chexian-audit-route-'));
  process.env.AUDIT_LOG_DIR = _isolatedAuditDir;
});

afterAll(async () => {
  if (_prevAuditDir === undefined) delete process.env.AUDIT_LOG_DIR;
  else process.env.AUDIT_LOG_DIR = _prevAuditDir;
  if (_isolatedAuditDir) await fs.rm(_isolatedAuditDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const InputSchema = z.object({ x: z.number().default(0) });
const ResultSchema = z.object({ ok: z.boolean(), tag: z.string().optional() });

const createdRunIds: string[] = [];

afterAll(async () => {
  const { getDataDir } = await import('../../server/src/config/paths.js');
  const runDir = path.resolve(getDataDir(), 'runtime/workflow-runs');
  for (const id of createdRunIds) {
    for (const ext of ['.json', '.lock']) {
      try {
        await fs.unlink(path.join(runDir, `${id}${ext}`));
      } catch {
        // ignore
      }
    }
  }
  // 不删 audit 文件 — 同日其他测试可能仍在用；audit-log.test.ts 的 _resetAuditLogForDate 会清
});

const TEST_WORKFLOW_ID = 'wf-audit-route-test';

async function buildTestApp() {
  vi.doMock('../../server/src/skills/workflows/index.js', async () => {
    const { z: zod } = await import('zod');
    const wf = {
      id: TEST_WORKFLOW_ID,
      name: 'wf-audit-route-test',
      version: '1.0.0',
      description: 'http audit route test',
      inputSchema: zod.object({ x: zod.number().default(0) }),
      nodes: [
        { id: 'pre', type: 'sequential', skillId: 'pre' },
        { id: 'gate', type: 'approval', approverRoles: ['branch_admin'] },
        { id: 'post', type: 'sequential', skillId: 'post' },
      ],
    };
    return {
      getWorkflow: (id: string) => (id === TEST_WORKFLOW_ID ? wf : undefined),
      listWorkflows: () => [
        {
          id: wf.id,
          name: wf.name,
          version: wf.version,
          description: wf.description,
          nodeCount: wf.nodes.length,
        },
      ],
      ALL_WORKFLOWS: [wf],
    };
  });

  vi.doMock('../../server/src/skills/registry.js', async () => {
    const { z: zod } = await import('zod');
    const okSkill = (id: string, tag: string) => ({
      id,
      name: id,
      version: '1.0.0',
      description: 'test',
      inputSchema: zod.object({ x: zod.number().default(0) }),
      outputResultSchema: zod.object({ ok: zod.boolean(), tag: zod.string().optional() }),
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
        };
      },
    });
    const skills = [okSkill('pre', 'PRE'), okSkill('post', 'POST')];
    const map = new Map(skills.map((s) => [s.id, s]));
    return {
      getSkill: (id: string) => map.get(id),
      listSkills: () =>
        skills.map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          description: s.description,
          deterministic: s.deterministic,
          requiresApproval: false,
        })),
      ALL_SKILLS: skills,
    };
  });

  vi.doMock('../../server/src/middleware/permission.js', () => ({
    permissionMiddleware: (req: any, _res: any, next: any) => {
      req.permissionFilter = '1=1';
      next();
    },
  }));

  const express = serverRequire('express');
  const jwt = serverRequire('jsonwebtoken');
  const [{ authConfig }, { errorHandler }, { default: workflowsRoutes }] = await Promise.all([
    import('../../server/src/config/auth.js'),
    import('../../server/src/middleware/error.js'),
    import('../../server/src/routes/workflows.js'),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRoutes);
  app.use(errorHandler);

  return { app, jwt, authConfig };
}

describe('GET /api/workflows/runs/:runId/audit + POST /reject', () => {
  let server: Server;
  let endpointBase: string;
  let jwt: any;
  let authConfig: any;

  beforeAll(async () => {
    const built = await buildTestApp();
    jwt = built.jwt;
    authConfig = built.authConfig;
    server = built.app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    endpointBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  async function createPendingRun(username = 'analyst1', role = 'analyst'): Promise<string> {
    const { runWorkflow } = await import('../../server/src/skills/workflow-runner.js');
    const { getWorkflow } = await import('../../server/src/skills/workflows/index.js');
    const { getSkill } = await import('../../server/src/skills/registry.js');

    const wf = getWorkflow(TEST_WORKFLOW_ID);
    if (!wf) throw new Error('test workflow not registered');

    const ctx = {
      userId: username,
      username,
      role,
      permissionFilter: '1=1',
      requestId: 'r-test',
      startedAt: Date.now(),
      now: new Date(),
    };

    const { runId, record } = await runWorkflow(wf, { x: 1 }, ctx, {
      resolveSkill: getSkill,
      persist: true,
    });
    expect(record.status).toBe('pending_approval');
    createdRunIds.push(runId);
    return runId;
  }

  it('GET /audit — 未鉴权 → 401', async () => {
    const runId = await createPendingRun();
    const r = await fetch(`${endpointBase}/api/workflows/runs/${runId}/audit`);
    expect(r.status).toBe(401);
  });

  it('GET /audit — 跨用户访问 → 403', async () => {
    const runId = await createPendingRun('analyst1', 'analyst');
    const otherToken = jwt.sign(
      { userId: 'analyst2', username: 'analyst2', role: 'analyst' },
      authConfig.jwtSecret,
    );
    const r = await fetch(`${endpointBase}/api/workflows/runs/${runId}/audit`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(r.status).toBe(403);
  });

  it('GET /audit — 自己的 run → 200，含 workflow-started + step-completed + approval-requested', async () => {
    const runId = await createPendingRun('analyst1', 'analyst');
    // 给 fire-and-forget 一点时间
    await new Promise((r) => setTimeout(r, 80));

    const token = jwt.sign(
      { userId: 'analyst1', username: 'analyst1', role: 'analyst' },
      authConfig.jwtSecret,
    );
    const r = await fetch(`${endpointBase}/api/workflows/runs/${runId}/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { success: boolean; data: Array<{ eventType: string }> };
    expect(body.success).toBe(true);
    const types = body.data.map((e) => e.eventType);
    expect(types).toEqual(
      expect.arrayContaining(['workflow-started', 'step-completed', 'approval-requested']),
    );
  });

  it('POST /reject — 错误角色 → 403，记录仍是 pending_approval', async () => {
    const runId = await createPendingRun('analyst1', 'analyst');
    const analystToken = jwt.sign(
      { userId: 'analyst1', username: 'analyst1', role: 'analyst' },
      authConfig.jwtSecret,
    );
    const r = await fetch(`${endpointBase}/api/workflows/runs/${runId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${analystToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'test' }),
    });
    expect(r.status).toBe(403);

    const { getWorkflowRun } = await import('../../server/src/skills/workflow-runner.js');
    const reread = await getWorkflowRun(runId);
    expect(reread?.status).toBe('pending_approval');
  });

  it('POST /reject — admin → 200，status=failed，approval.rejectedBy 写入', async () => {
    const runId = await createPendingRun('analyst1', 'analyst');
    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    const r = await fetch(`${endpointBase}/api/workflows/runs/${runId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '风险评估不足' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      success: boolean;
      data: { status: string; approval?: { rejectedBy?: string; rejectReason?: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('failed');
    expect(body.data.approval?.rejectedBy).toBe('admin');
    expect(body.data.approval?.rejectReason).toBe('风险评估不足');

    // audit log 应含 approval-denied 事件
    await new Promise((r) => setTimeout(r, 80));
    const auditR = await fetch(`${endpointBase}/api/workflows/runs/${runId}/audit`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(auditR.status).toBe(200);
    const audit = (await auditR.json()) as { data: Array<{ eventType: string }> };
    expect(audit.data.map((e) => e.eventType)).toContain('approval-denied');
  });

  it('POST /reject — approve 与 reject 并发 → 仅一个成功，另一个 409（codex P1 互斥锁）', async () => {
    const runId = await createPendingRun('analyst1', 'analyst');
    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    const headers = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

    // 并发发起 approve + reject
    const [a, r] = await Promise.all([
      fetch(`${endpointBase}/api/workflows/runs/${runId}/approve`, { method: 'POST', headers, body: '{}' }),
      fetch(`${endpointBase}/api/workflows/runs/${runId}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'concurrent test' }),
      }),
    ]);

    // 一个 200 一个 409（哪个先持锁取决于事件循环顺序）
    const statuses = [a.status, r.status].sort();
    expect(statuses).toEqual([200, 409]);

    // 终态确定（要么 success/failed，不可能两者都生效）
    const { getWorkflowRun } = await import('../../server/src/skills/workflow-runner.js');
    const final = await getWorkflowRun(runId);
    expect(['success', 'failed']).toContain(final?.status);
    // 互斥：approval 状态字段不会同时含 approvedBy 与 rejectedBy
    const approval = final?.approval;
    const hasApproved = !!approval?.approvedBy;
    const hasRejected = !!approval?.rejectedBy;
    expect(hasApproved && hasRejected).toBe(false);
    expect(hasApproved || hasRejected).toBe(true);
  });

  it('POST /reject — 已 failed 的 run 再次 reject → 409', async () => {
    const runId = await createPendingRun('analyst1', 'analyst');
    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    const first = await fetch(`${endpointBase}/api/workflows/runs/${runId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${endpointBase}/api/workflows/runs/${runId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(409);
  });
});

export { InputSchema, ResultSchema };
