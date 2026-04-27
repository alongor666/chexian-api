/**
 * /api/workflows/runs/:runId/approve HTTP 集成测试 — 阶段 4 PR-B
 *
 * 用真实 express + JWT 启动一个最小 server，验证：
 *   - 未鉴权 → 401
 *   - 角色不在 approverRoles → 403
 *   - 正确 admin 角色 → 200，下游 skill 被调用，最终 status='success'
 *   - 不存在的 runId → 404
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Server } from 'http';
import { z } from 'zod';

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
  const dir = path.resolve(getDataDir(), 'runtime/workflow-runs');
  for (const id of createdRunIds) {
    for (const ext of ['.json', '.lock']) {
      try {
        await fs.unlink(path.join(dir, `${id}${ext}`));
      } catch {
        // ignore
      }
    }
  }
});

/**
 * 在 SkillRegistry / WorkflowRegistry 内部注入一个最小的 mock workflow，
 * 不触碰真实 skill 域（避免冷启动 DuckDB）。
 *
 * 策略：mock 整个 'workflows/index' 与 'registry'，只暴露我们的测试 workflow + skill。
 */
const TEST_WORKFLOW_ID = 'wf-approve-route-test';

async function buildTestApp() {
  // 关键：vi.doMock 必须在动态 import 之前
  vi.doMock('../../server/src/skills/workflows/index.js', async () => {
    const { z: zod } = await import('zod');
    const wf = {
      id: TEST_WORKFLOW_ID,
      name: 'wf-approve-route-test',
      version: '1.0.0',
      description: 'http approve route test',
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

  // permission middleware 也需要 mock 成放行（不依赖真实 access-control / parquet）
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

describe('POST /api/workflows/runs/:runId/approve', () => {
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

  async function createPendingRun(): Promise<string> {
    // 直接调 runWorkflow 把 mock workflow 跑到 pending_approval，不走 HTTP
    const { runWorkflow } = await import('../../server/src/skills/workflow-runner.js');
    const { getWorkflow } = await import('../../server/src/skills/workflows/index.js');
    const { getSkill } = await import('../../server/src/skills/registry.js');

    const wf = getWorkflow(TEST_WORKFLOW_ID);
    if (!wf) throw new Error('test workflow not registered');

    const ctx = {
      userId: 'analyst1',
      username: 'analyst1',
      role: 'analyst',
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

  it('未鉴权 → 401', async () => {
    const runId = await createPendingRun();
    const response = await fetch(`${endpointBase}/api/workflows/runs/${runId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('错误角色（非 branch_admin）→ 403，下游不被调用，记录仍 pending_approval', async () => {
    const runId = await createPendingRun();

    const analystToken = jwt.sign(
      { userId: 'analyst1', username: 'analyst1', role: 'analyst' },
      authConfig.jwtSecret,
    );
    const response = await fetch(`${endpointBase}/api/workflows/runs/${runId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${analystToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);

    // 记录仍是 pending_approval
    const { getWorkflowRun } = await import('../../server/src/skills/workflow-runner.js');
    const reread = await getWorkflowRun(runId);
    expect(reread?.status).toBe('pending_approval');
  });

  it('正确 admin 角色 → 200，状态变为 success，audit 字段写入', async () => {
    const runId = await createPendingRun();

    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    const response = await fetch(`${endpointBase}/api/workflows/runs/${runId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: { status: string; approval?: { approvedBy?: string }; steps: Array<{ nodeId: string; status: string }> };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('success');
    expect(payload.data.approval?.approvedBy).toBe('admin');
    // post 步骤实际执行
    const postStep = payload.data.steps.find((s) => s.nodeId === 'post');
    expect(postStep?.status).toBe('success');
  });

  it('不存在的 runId → 404', async () => {
    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    const response = await fetch(
      `${endpointBase}/api/workflows/runs/wr_20260101000000_unknown_deadbeef/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(404);
  });

  it('已 success 的 run 再次 approve → 409', async () => {
    const runId = await createPendingRun();
    const adminToken = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    // 第一次 approve → 200
    const first = await fetch(`${endpointBase}/api/workflows/runs/${runId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(200);
    // 第二次 → 409 conflict
    const second = await fetch(`${endpointBase}/api/workflows/runs/${runId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(409);
  });
});

// 让 vitest 知道这个测试不依赖运行时环境（避免 transformer 把 InputSchema 标为 dead code）
export { InputSchema, ResultSchema };
