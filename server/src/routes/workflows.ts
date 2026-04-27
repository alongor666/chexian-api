/**
 * /api/workflows 路由 — 阶段 4 PR-B
 *
 * 端点：
 * - GET  /api/workflows                       列出所有可执行 workflow
 * - POST /api/workflows/:id/run               执行 workflow（同步，落盘）
 * - GET  /api/workflows/runs                  列出 workflow 运行记录
 * - GET  /api/workflows/runs/:runId           获取单条记录
 * - POST /api/workflows/runs/:runId/approve   审批通过 pending_approval 记录并 resume（PR-B）
 *
 * 鉴权：authMiddleware + permissionMiddleware（与 /api/skills 一致）
 * /approve 额外校验 approver 的 role ∈ approval.approverRoles（在 resumeWorkflow 内部执行）
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { getRequestContext } from '../utils/request-context.js';
import { getWorkflow, listWorkflows } from '../skills/workflows/index.js';
import {
  runWorkflow,
  resumeWorkflow,
  ApprovalError,
  getWorkflowRun,
  listWorkflowRuns,
  saveWorkflowRun,
  acquireRunLock,
  releaseRunLock,
  type WorkflowStatus,
  type WorkflowRunRecord,
} from '../skills/workflow-runner.js';
import { getSkill } from '../skills/registry.js';
import type { SkillContext } from '../skills/types.js';
import { appendAuditEvent, getAuditLogStats, readAuditEventsForRun } from '../skills/audit-log.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);

/**
 * GET /api/workflows
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: listWorkflows() });
  })
);

/**
 * GET /api/workflows/health/runs-summary — PR-E
 *
 * 运维视角：最近 24h 每个 workflowId 的状态计数与耗时分位。
 * 权限：branch_admin only。
 */
router.get(
  '/health/runs-summary',
  asyncHandler(async (req, res) => {
    if (req.user?.role !== 'branch_admin') {
      throw new AppError(403, 'Workflow health summary requires branch_admin');
    }

    const windowHours = 24;
    const generatedAt = new Date();
    const cutoffMs = generatedAt.getTime() - windowHours * 60 * 60 * 1000;
    const records = (await listWorkflowRuns()).filter((record) => {
      const startedMs = new Date(record.startedAt).getTime();
      return Number.isFinite(startedMs) && startedMs >= cutoffMs;
    });

    const statuses: WorkflowStatus[] = ['success', 'partial', 'failed', 'pending_approval'];
    const buckets = new Map<
      string,
      { workflowId: string; counts: Record<WorkflowStatus, number>; elapsedValues: number[] }
    >();

    for (const record of records) {
      const bucket =
        buckets.get(record.workflowId) ??
        {
          workflowId: record.workflowId,
          counts: { success: 0, partial: 0, failed: 0, pending_approval: 0 },
          elapsedValues: [],
        };
      bucket.counts[record.status] += 1;
      if (Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0) {
        bucket.elapsedValues.push(record.elapsedMs);
      }
      buckets.set(record.workflowId, bucket);
    }

    const percentile = (values: number[], p: number): number | null => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
      return sorted[idx];
    };

    const workflows = Array.from(buckets.values())
      .map((bucket) => ({
        workflowId: bucket.workflowId,
        total: statuses.reduce((sum, status) => sum + bucket.counts[status], 0),
        counts: bucket.counts,
        elapsedMs: {
          p50: percentile(bucket.elapsedValues, 0.5),
          p95: percentile(bucket.elapsedValues, 0.95),
        },
      }))
      .sort((a, b) => a.workflowId.localeCompare(b.workflowId));

    res.json({
      success: true,
      data: {
        windowHours,
        generatedAt: generatedAt.toISOString(),
        workflows,
        auditLog: await getAuditLogStats(),
      },
    });
  }),
);

/**
 * POST /api/workflows/:id/run
 * Body: { input: <WorkflowInput> }
 */
router.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    const workflowId = req.params.id;
    const workflow = getWorkflow(workflowId);
    if (!workflow) {
      throw new AppError(404, `Workflow not found: ${workflowId}`);
    }

    if (!req.user || !req.permissionFilter) {
      throw new AppError(401, 'Authentication context missing');
    }

    const reqCtx = getRequestContext();
    const ctx: SkillContext = {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role,
      organization: req.user.organization,
      permissionFilter: req.permissionFilter,
      requestId: reqCtx?.requestId ?? 'unknown',
      startedAt: Date.now(),
      now: new Date(),
    };

    const body = (req.body ?? {}) as { input?: unknown };
    const { runId, record } = await runWorkflow(workflow, body.input, ctx, {
      resolveSkill: getSkill,
    });

    res.json({
      success: true,
      data: {
        runId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: record.status,
        elapsedMs: record.elapsedMs,
        steps: record.steps,
        report: record.report,
      },
    });
  })
);

/**
 * GET /api/workflows/runs?workflowId=&status=&limit=
 */
router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;
    const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status: WorkflowStatus | undefined =
      statusParam && ['success', 'partial', 'failed', 'pending_approval'].includes(statusParam)
        ? (statusParam as WorkflowStatus)
        : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const username = req.user?.role === 'branch_admin' ? undefined : req.user?.username;
    const records = await listWorkflowRuns({ workflowId, status, username, limit });
    res.json({ success: true, data: records });
  })
);

/**
 * GET /api/workflows/runs/:runId
 */
router.get(
  '/runs/:runId',
  asyncHandler(async (req, res) => {
    const record = await getWorkflowRun(req.params.runId);
    if (!record) {
      throw new AppError(404, `Workflow run not found: ${req.params.runId}`);
    }
    if (req.user?.role !== 'branch_admin' && record.username !== req.user?.username) {
      throw new AppError(403, 'Cannot access run from another user');
    }
    res.json({ success: true, data: record });
  })
);

/**
 * POST /api/workflows/runs/:runId/approve
 *
 * 审批通过一个 pending_approval 状态的 workflow run，并从 approval 节点之后继续执行。
 *
 * 鉴权：approver 的 role 必须 ∈ workflow approval 节点声明的 approverRoles，
 * 否则 ApprovalError(403) 被 errorHandler 转为 403。
 */
router.post(
  '/runs/:runId/approve',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.permissionFilter) {
      throw new AppError(401, 'Authentication context missing');
    }

    const reqCtx = getRequestContext();
    const ctx: SkillContext = {
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role,
      organization: req.user.organization,
      permissionFilter: req.permissionFilter,
      requestId: reqCtx?.requestId ?? 'unknown',
      startedAt: Date.now(),
      now: new Date(),
    };

    try {
      const { record } = await resumeWorkflow(req.params.runId, ctx, {
        resolveSkill: getSkill,
        resolveWorkflow: getWorkflow,
        approver: { username: req.user.username, role: req.user.role },
      });
      res.json({ success: true, data: record });
    } catch (err) {
      if (err instanceof ApprovalError) {
        throw new AppError(err.statusCode, err.message);
      }
      throw err;
    }
  })
);

/**
 * POST /api/workflows/runs/:runId/reject — 阶段 4 PR-C（codex review P1：与 approve 共享 run-level 互斥锁）
 *
 * 拒绝审批：record.status = 'failed' + approval.rejectedBy / rejectedAt 写入。
 * 鉴权：role 必须 ∈ approval.approverRoles（与 /approve 一致）；不在其中 → 403。
 * 状态：record.status 必须是 'pending_approval'，否则 409。
 *
 * 与 /approve 区别：不调用 resumeWorkflow，下游 skill 永不执行；落盘 audit 事件 approval-denied。
 *
 * 并发安全：acquireRunLock 与 /approve 共享同一个锁文件（O_EXCL 原子互斥）。
 *   - approve + reject 并发 → 第二个请求 409
 *   - 两个 reject 并发 → 第二个 409，避免状态覆盖与 audit 双写
 *   - 锁内做 read-check-write，保证 status 检查与落盘原子可见
 */
router.post(
  '/runs/:runId/reject',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.permissionFilter) {
      throw new AppError(401, 'Authentication context missing');
    }
    const runId = req.params.runId;

    // 抢 run-level 锁（与 approve 共享）。失败 → 409
    let lockPath: string;
    try {
      lockPath = await acquireRunLock(runId, `reject:${req.user.username}`);
    } catch (err) {
      if (err instanceof ApprovalError) {
        throw new AppError(err.statusCode, err.message);
      }
      throw err;
    }

    try {
      const prior = await getWorkflowRun(runId);
      if (!prior) {
        throw new AppError(404, `Workflow run not found: ${runId}`);
      }
      if (prior.status !== 'pending_approval' || !prior.approval) {
        throw new AppError(409, `Workflow run is not pending approval (status=${prior.status})`);
      }
      if (!prior.approval.approverRoles.includes(req.user.role)) {
        throw new AppError(
          403,
          `Approver role '${req.user.role}' is not in approverRoles [${prior.approval.approverRoles.join(', ')}]`,
        );
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined;
      const rejectedAt = new Date().toISOString();
      const updatedSteps = prior.steps.map((s) =>
        s.nodeId === prior.approval!.pendingNodeId
          ? { ...s, status: 'failed' as const, error: reason ?? 'rejected by approver', finishedAt: rejectedAt }
          : s,
      );
      const updated: WorkflowRunRecord = {
        ...prior,
        status: 'failed',
        finishedAt: rejectedAt,
        elapsedMs: new Date(rejectedAt).getTime() - new Date(prior.startedAt).getTime(),
        steps: updatedSteps,
        approval: {
          ...prior.approval,
          rejectedBy: req.user.username,
          rejectedAt,
          rejectReason: reason,
        },
      };
      await saveWorkflowRun(updated);

      const reqCtx = getRequestContext();
      void appendAuditEvent({
        runId,
        workflowId: prior.workflowId,
        eventType: 'approval-denied',
        userId: req.user.userId,
        role: req.user.role,
        requestId: reqCtx?.requestId ?? 'unknown',
        payload: { nodeId: prior.approval.pendingNodeId, reason },
      });
      res.json({ success: true, data: updated });
    } finally {
      await releaseRunLock(lockPath);
    }
  }),
);

/**
 * GET /api/workflows/runs/:runId/audit — 阶段 4 PR-C
 *
 * 列出该 runId 的所有 audit 事件，按时间升序。
 * 权限：与 GET /runs/:runId 一致 — 自己的 run 或 branch_admin 可读。
 */
router.get(
  '/runs/:runId/audit',
  asyncHandler(async (req, res) => {
    const record = await getWorkflowRun(req.params.runId);
    if (!record) {
      throw new AppError(404, `Workflow run not found: ${req.params.runId}`);
    }
    if (req.user?.role !== 'branch_admin' && record.username !== req.user?.username) {
      throw new AppError(403, 'Cannot access run from another user');
    }
    const events = await readAuditEventsForRun(req.params.runId);
    res.json({ success: true, data: events });
  }),
);

export default router;
