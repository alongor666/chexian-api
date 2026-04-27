import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler } from '../../middleware/error.js';
import { getDefaultLlmProvider } from '../../skills/adapters/llm/index.js';
import { SuccessResponseSchema } from '../schemas/agent-audit.schema.js';
import {
  AgentDiagnosisExplanationRequestSchema,
  AgentDiagnosisExplanationResultSchema,
} from '../schemas/agent-explanation.schema.js';
import { explainDiagnosisResult } from '../services/agent-diagnosis-explanation-service.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);

router.post(
  '/diagnosis',
  asyncHandler(async (req, res) => {
    const input = AgentDiagnosisExplanationRequestSchema.parse(req.body);
    const explanation = await explainDiagnosisResult(input, {
      provider: getDefaultLlmProvider(),
    });
    const response = SuccessResponseSchema(AgentDiagnosisExplanationResultSchema).parse({
      success: true,
      data: explanation,
    });
    res.json(response);
  })
);

export default router;
