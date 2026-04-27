/**
 * /api/skills 路由 — 阶段 1
 *
 * 端点：
 * - GET  /api/skills              列出所有可执行 Skill
 * - POST /api/skills/:id/run      执行单个 Skill
 * - GET  /api/skills/runs         列出运行记录
 * - GET  /api/skills/runs/:runId  获取单条运行记录
 *
 * 鉴权：authMiddleware + permissionMiddleware（与 /api/query/* 一致，遵守 .claude/rules/api-routes.md）
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { getSkill, listSkills } from '../skills/registry.js';
import { runSkill } from '../skills/runner.js';
import { getRun, listRuns } from '../skills/run-store.js';
import type { SkillContext } from '../skills/types.js';
import { getRequestContext } from '../utils/request-context.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);

/**
 * GET /api/skills
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: listSkills() });
  })
);

/**
 * POST /api/skills/:id/run
 * Body: { input: <SkillInput> }
 */
router.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    const skillId = req.params.id;
    const skill = getSkill(skillId);
    if (!skill) {
      throw new AppError(404, `Skill not found: ${skillId}`);
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
    const { runId, result } = await runSkill(skill, body.input, ctx);

    res.json({
      success: true,
      data: {
        runId,
        skillId: skill.id,
        skillVersion: skill.version,
        ...result,
      },
    });
  })
);

/**
 * GET /api/skills/runs?skillId=&limit=
 */
router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const skillId = typeof req.query.skillId === 'string' ? req.query.skillId : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const username = req.user?.role === 'branch_admin' ? undefined : req.user?.username;
    const records = await listRuns({ skillId, username, limit });
    res.json({ success: true, data: records });
  })
);

/**
 * GET /api/skills/runs/:runId
 */
router.get(
  '/runs/:runId',
  asyncHandler(async (req, res) => {
    const record = await getRun(req.params.runId);
    if (!record) {
      throw new AppError(404, `Run not found: ${req.params.runId}`);
    }
    // 非管理员只能看自己的 run
    if (req.user?.role !== 'branch_admin' && record.username !== req.user?.username) {
      throw new AppError(403, 'Cannot access run from another user');
    }
    res.json({ success: true, data: record });
  })
);

export default router;
