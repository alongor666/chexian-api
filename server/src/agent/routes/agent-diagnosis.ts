import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler, AppError } from '../../middleware/error.js';
import { buildWhereFromFilterParams } from '../../utils/filter-params.js';
import { isValidDateFormat } from '../../utils/sql-sanitizer.js';
import { createDomainMiddleware } from '../../routes/query/shared.js';
import {
  CostIndicatorDiagnosisRequestSchema,
  CostIndicatorDiagnosisResultSchema,
} from '../schemas/agent-diagnosis.schema.js';
import { SuccessResponseSchema } from '../schemas/agent-audit.schema.js';
import { runCostIndicatorDiagnosis } from '../services/agent-cost-indicator-diagnosis-service.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);
router.use(createDomainMiddleware('ClaimsAgg'));

router.post(
  '/cost-indicators',
  asyncHandler(async (req, res) => {
    const input = CostIndicatorDiagnosisRequestSchema.parse(req.body);
    if (!isValidDateFormat(input.cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${input.cutoffDate}. Expected YYYY-MM-DD`);
    }

    const whereClause = buildWhereFromFilterParams(input.filters, req.permissionFilter || '1=1');
    const diagnosis = await runCostIndicatorDiagnosis({
      cutoffDate: input.cutoffDate,
      dimension: input.dimension,
      whereClause,
      limit: input.limit,
      minPremium: input.minPremium,
    });

    const response = SuccessResponseSchema(CostIndicatorDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

export default router;
