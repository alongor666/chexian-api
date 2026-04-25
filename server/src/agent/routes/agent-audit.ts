import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler } from '../../middleware/error.js';
import {
  AgentCapabilityAuditSchema,
  AgentMetricAuditSchema,
  AgentReadinessAuditSchema,
  RouteQuestionInputSchema,
  RouteQuestionResultSchema,
  SuccessResponseSchema,
  UnsupportedMetricAuditSchema,
} from '../schemas/agent-audit.schema.js';
import { getAgentMetricAudit } from '../services/agent-metric-audit-service.js';
import {
  getAgentCapabilityAudit,
  getAgentReadinessAudit,
  getUnsupportedMetricAudit,
} from '../services/agent-adaptation-audit-service.js';
import { routeAgentQuestion } from '../services/agent-question-router-service.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);

router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const response = SuccessResponseSchema(AgentMetricAuditSchema).parse({
      success: true,
      data: getAgentMetricAudit(),
    });
    res.json(response);
  })
);

router.get(
  '/capabilities',
  asyncHandler(async (_req, res) => {
    const response = SuccessResponseSchema(AgentCapabilityAuditSchema).parse({
      success: true,
      data: getAgentCapabilityAudit(),
    });
    res.json(response);
  })
);

router.get(
  '/unsupported',
  asyncHandler(async (_req, res) => {
    const response = SuccessResponseSchema(UnsupportedMetricAuditSchema).parse({
      success: true,
      data: getUnsupportedMetricAudit(),
    });
    res.json(response);
  })
);

router.get(
  '/readiness',
  asyncHandler(async (_req, res) => {
    const response = SuccessResponseSchema(AgentReadinessAuditSchema).parse({
      success: true,
      data: getAgentReadinessAudit(),
    });
    res.json(response);
  })
);

router.post(
  '/route-question',
  asyncHandler(async (req, res) => {
    const input = RouteQuestionInputSchema.parse(req.body);
    const result = RouteQuestionResultSchema.parse(routeAgentQuestion(input));
    res.json(result);
  })
);

export default router;
