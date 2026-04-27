/**
 * /api/workflows/health/runs-summary — PR-E
 *
 * 验证：
 *  - branch_admin 可读最近 24h workflow run 状态汇总
 *  - 非 branch_admin 禁止访问
 *  - 24h 窗口外记录不参与计数与分位耗时
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { WorkflowRunRecord, WorkflowStatus } from '../../server/src/skills/workflow-runner.js';

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

const createdRunIds: string[] = [];

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function makeRunId(workflowId: string, suffix: string): string {
  return `wr_20260427000000_${workflowId}_${suffix.padEnd(8, '0').slice(0, 8)}`;
}

async function saveRun(input: {
  workflowId: string;
  suffix: string;
  status: WorkflowStatus;
  startedAt: string;
  elapsedMs: number;
}): Promise<void> {
  const { saveWorkflowRun } = await import('../../server/src/skills/workflow-runner.js');
  const finishedAt = new Date(new Date(input.startedAt).getTime() + input.elapsedMs).toISOString();
  const record: WorkflowRunRecord = {
    runId: makeRunId(input.workflowId, input.suffix),
    workflowId: input.workflowId,
    workflowVersion: '1.0.0',
    status: input.status,
    userId: 'u1',
    username: 'analyst1',
    requestId: `req-${input.suffix}`,
    startedAt: input.startedAt,
    finishedAt,
    elapsedMs: input.elapsedMs,
    input: {},
    steps: [],
  };
  await saveWorkflowRun(record);
  createdRunIds.push(record.runId);
}

async function buildTestApp() {
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

describe('GET /api/workflows/health/runs-summary', () => {
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
    const { getDataDir } = await import('../../server/src/config/paths.js');
    const runDir = path.resolve(getDataDir(), 'runtime/workflow-runs');
    for (const id of createdRunIds) {
      try {
        await fs.unlink(path.join(runDir, `${id}.json`));
      } catch {
        // ignore
      }
    }
  });

  it('branch_admin 200，按 workflowId 返回最近 24h 状态计数与 p50/p95', async () => {
    const now = Date.now();
    await saveRun({
      workflowId: 'wf-health-a',
      suffix: 'a1',
      status: 'success',
      startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      elapsedMs: 100,
    });
    await saveRun({
      workflowId: 'wf-health-a',
      suffix: 'a2',
      status: 'failed',
      startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      elapsedMs: 300,
    });
    await saveRun({
      workflowId: 'wf-health-a',
      suffix: '0d',
      status: 'success',
      startedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
      elapsedMs: 900,
    });
    await saveRun({
      workflowId: 'wf-health-b',
      suffix: 'b1',
      status: 'pending_approval',
      startedAt: new Date(now - 30 * 60 * 1000).toISOString(),
      elapsedMs: 50,
    });

    const token = jwt.sign(
      { userId: 'admin', username: 'admin', role: 'branch_admin' },
      authConfig.jwtSecret,
    );
    const r = await fetch(`${endpointBase}/api/workflows/health/runs-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      success: boolean;
      data: {
        workflows: Array<{
          workflowId: string;
          counts: Record<WorkflowStatus, number>;
          elapsedMs: { p50: number | null; p95: number | null };
        }>;
      };
    };
    expect(body.success).toBe(true);

    const wfA = body.data.workflows.find((w) => w.workflowId === 'wf-health-a');
    expect(wfA?.counts).toMatchObject({
      success: 1,
      partial: 0,
      failed: 1,
      pending_approval: 0,
    });
    expect(wfA?.elapsedMs).toEqual({ p50: 100, p95: 300 });

    const wfB = body.data.workflows.find((w) => w.workflowId === 'wf-health-b');
    expect(wfB?.counts.pending_approval).toBe(1);
  });

  it('非 branch_admin 403', async () => {
    const token = jwt.sign(
      { userId: 'u1', username: 'analyst1', role: 'analyst' },
      authConfig.jwtSecret,
    );
    const r = await fetch(`${endpointBase}/api/workflows/health/runs-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(403);
  });
});
