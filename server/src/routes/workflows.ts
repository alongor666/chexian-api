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
  type WorkflowStatus,
} from '../skills/workflow-runner.js';
import { getSkill } from '../skills/registry.js';
import type { SkillContext } from '../skills/types.js';

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

export default router;
