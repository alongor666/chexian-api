import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler, AppError } from '../../middleware/error.js';
import { buildWhereFromFilterParams, buildWhereFromFilterParamsWithoutDate } from '../../utils/filter-params.js';
import { isValidDateFormat } from '../../utils/sql-sanitizer.js';
import { createDomainMiddleware } from '../../routes/query/shared.js';
import {
  CostIndicatorDiagnosisRequestSchema,
  CostIndicatorDiagnosisResultSchema,
  GrowthDiagnosisRequestSchema,
  GrowthDiagnosisResultSchema,
  QuoteConversionDiagnosisRequestSchema,
  QuoteConversionDiagnosisResultSchema,
  type QuoteConversionDiagnosisFilters,
} from '../schemas/agent-diagnosis.schema.js';
import { SuccessResponseSchema } from '../schemas/agent-audit.schema.js';
import { runCostIndicatorDiagnosis } from '../services/agent-cost-indicator-diagnosis-service.js';
import { runGrowthDiagnosis } from '../services/agent-growth-diagnosis-service.js';
import { runQuoteConversionDiagnosis } from '../services/agent-quote-conversion-diagnosis-service.js';

const router = Router();

router.use(authMiddleware);
router.use(permissionMiddleware);

interface AgentDiagnosisUserContext {
  role?: string;
  organization?: string;
}

function applyQuoteConversionPermissionFilters(
  filters: QuoteConversionDiagnosisFilters,
  user: AgentDiagnosisUserContext | undefined
): QuoteConversionDiagnosisFilters {
  if (!user) return filters;
  if (user.role === 'org_user') {
    return { ...filters, orgName: user.organization };
  }
  if (user.role === 'telemarketing_user') {
    return { ...filters, isTelemarketing: '电销' };
  }
  return filters;
}

function validateOptionalDate(label: string, value: string | undefined): void {
  if (value && !isValidDateFormat(value)) {
    throw new AppError(400, `Invalid ${label} format: ${value}. Expected YYYY-MM-DD`);
  }
}

router.post(
  '/cost-indicators',
  createDomainMiddleware('ClaimsAgg'),
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

router.post(
  '/growth',
  createDomainMiddleware('PolicyFact'),
  asyncHandler(async (req, res) => {
    const input = GrowthDiagnosisRequestSchema.parse(req.body);
    for (const [label, value] of [
      ['currentPeriod.startDate', input.currentPeriod.startDate],
      ['currentPeriod.endDate', input.currentPeriod.endDate],
      ['baselinePeriod.startDate', input.baselinePeriod.startDate],
      ['baselinePeriod.endDate', input.baselinePeriod.endDate],
    ] as const) {
      if (!isValidDateFormat(value)) {
        throw new AppError(400, `Invalid ${label} format: ${value}. Expected YYYY-MM-DD`);
      }
    }

    const whereClause = buildWhereFromFilterParamsWithoutDate(input.filters, req.permissionFilter || '1=1');
    const diagnosis = await runGrowthDiagnosis({
      currentPeriod: input.currentPeriod,
      baselinePeriod: input.baselinePeriod,
      comparisonMode: input.comparisonMode,
      timeView: input.timeView,
      perspective: input.perspective,
      dimension: input.dimension,
      whereClause,
      includeDailyContext: input.includeDailyContext,
      limit: input.limit,
      minCurrentValue: input.minCurrentValue,
    });

    const response = SuccessResponseSchema(GrowthDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

router.post(
  '/quote-conversion',
  createDomainMiddleware('QuoteConversion'),
  asyncHandler(async (req, res) => {
    const input = QuoteConversionDiagnosisRequestSchema.parse(req.body);
    validateOptionalDate('filters.dateStart', input.filters.dateStart);
    validateOptionalDate('filters.dateEnd', input.filters.dateEnd);
    if (input.filters.ncdMin !== undefined && input.filters.ncdMax !== undefined && input.filters.ncdMin > input.filters.ncdMax) {
      throw new AppError(400, 'ncdMin cannot be greater than ncdMax');
    }

    const diagnosis = await runQuoteConversionDiagnosis({
      filters: applyQuoteConversionPermissionFilters(input.filters, req.user),
      drilldownLevel: input.drilldownLevel,
      trendGranularity: input.trendGranularity,
      limit: input.limit,
    });

    const response = SuccessResponseSchema(QuoteConversionDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

export default router;
