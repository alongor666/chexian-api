import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler, AppError } from '../../middleware/error.js';
import {
  ProfitScenarioRequestSchema,
  ProfitScenarioResponseSchema,
} from '../schemas/agent-forecast.schema.js';
import { calculateProfitScenario } from '../services/agent-profit-forecast-service.js';

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

export default router;
