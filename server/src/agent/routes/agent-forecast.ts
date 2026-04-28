import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware, UserRole } from '../../middleware/permission.js';
import { asyncHandler, AppError } from '../../middleware/error.js';
import {
  ProfitScenarioRequestSchema,
  ProfitScenarioResponseSchema,
  ProfitSegmentRequestSchema,
  ProfitSegmentResponseSchema,
} from '../schemas/agent-forecast.schema.js';
import {
  ForecastBaselineRequestSchema,
  ForecastBaselineResponseSchema,
} from '../schemas/agent-forecast-baseline.schema.js';
import {
  calculateProfitScenario,
  calculateProfitSegment,
} from '../services/agent-profit-forecast-service.js';
import { buildForecastBaseline } from '../services/agent-forecast-baseline-service.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);

router.post(
  '/profit-scenario',
  asyncHandler(async (req, res) => {
    const parsed = ProfitScenarioRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const response = ProfitScenarioResponseSchema.parse(calculateProfitScenario(parsed.data));
    res.json(response);
  })
);

router.post(
  '/baseline',
  asyncHandler(async (req, res) => {
    const parsed = ForecastBaselineRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const result = await buildForecastBaseline({
      request: parsed.data,
      permissionFilter: req.permissionFilter || '1=1',
    });
    const response = ForecastBaselineResponseSchema.parse(result);
    res.json(response);
  })
);

router.post(
  '/profit-segment',
  asyncHandler(async (req, res) => {
    if (!req.user || req.user.role !== UserRole.BRANCH_ADMIN) {
      throw new AppError(
        403,
        '分群预测仅向分公司管理员（branch_admin）开放，其他角色请使用单情景接口 POST /api/agent/forecast/profit-scenario。'
      );
    }

    const parsed = ProfitSegmentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const response = ProfitSegmentResponseSchema.parse(calculateProfitSegment(parsed.data));
    res.json(response);
  })
);

export default router;
