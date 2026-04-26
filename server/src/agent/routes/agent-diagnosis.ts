import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler, AppError } from '../../middleware/error.js';
import { buildWhereFromFilterParams, buildWhereFromFilterParamsWithoutDate } from '../../utils/filter-params.js';
import { buildInCondition, isValidDateFormat, validateDateRange } from '../../utils/sql-sanitizer.js';
import { createDomainMiddleware } from '../../routes/query/shared.js';
import {
  CostIndicatorDiagnosisRequestSchema,
  CostIndicatorDiagnosisResultSchema,
  GrowthDiagnosisRequestSchema,
  GrowthDiagnosisResultSchema,
  QuoteConversionDiagnosisRequestSchema,
  QuoteConversionDiagnosisResultSchema,
  ClaimsRiskDiagnosisRequestSchema,
  ClaimsRiskDiagnosisResultSchema,
  CustomerFlowDiagnosisRequestSchema,
  CustomerFlowDiagnosisResultSchema,
  type ClaimsRiskDiagnosisFilters,
  RenewalTrackerDiagnosisRequestSchema,
  RenewalTrackerDiagnosisResultSchema,
  type RenewalTrackerDiagnosisFilters,
  type QuoteConversionDiagnosisFilters,
} from '../schemas/agent-diagnosis.schema.js';
import { SuccessResponseSchema } from '../schemas/agent-audit.schema.js';
import { runCostIndicatorDiagnosis } from '../services/agent-cost-indicator-diagnosis-service.js';
import { runGrowthDiagnosis } from '../services/agent-growth-diagnosis-service.js';
import { runQuoteConversionDiagnosis } from '../services/agent-quote-conversion-diagnosis-service.js';
import { runRenewalTrackerDiagnosis } from '../services/agent-renewal-tracker-diagnosis-service.js';
import { runClaimsRiskDiagnosis } from '../services/agent-claims-risk-diagnosis-service.js';
import { runCustomerFlowDiagnosis } from '../services/agent-customer-flow-diagnosis-service.js';

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
    if (!user.organization) {
      throw new AppError(403, 'Organization not specified for org_user role');
    }
    return { ...filters, orgName: user.organization };
  }
  if (user.role === 'telemarketing_user') {
    return { ...filters, isTelemarketing: '电销' };
  }
  return filters;
}

function addInCondition(conditions: string[], column: string, values: string[]): void {
  if (values.length > 0) {
    conditions.push(buildInCondition(column, values));
  }
}

function addBooleanCondition(conditions: string[], column: string, value: boolean | undefined): void {
  if (value !== undefined) {
    conditions.push(`${column} = ${value ? 'true' : 'false'}`);
  }
}

function buildRenewalTrackerExtraConditions(
  filters: RenewalTrackerDiagnosisFilters,
  permissionFilter: string | undefined,
  user: AgentDiagnosisUserContext | undefined
): string[] {
  const conditions: string[] = [];
  addInCondition(conditions, 'org_level_3', filters.orgNames);
  addInCondition(conditions, 'salesman_name', filters.salesmanNames);
  addInCondition(conditions, 'customer_category', filters.customerCategories);
  addInCondition(conditions, 'coverage_combination', filters.coverageCombinations);
  addInCondition(conditions, 'fuel_category', filters.fuelCategories);
  addInCondition(conditions, 'used_transfer_type', filters.usedTransferTypes);
  addInCondition(conditions, 'renewal_type', filters.renewalTypes);
  addBooleanCondition(conditions, 'is_nev', filters.isNev);
  addBooleanCondition(conditions, 'is_new_car', filters.isNewCar);
  addBooleanCondition(conditions, 'is_transfer', filters.isTransfer);
  addBooleanCondition(conditions, 'is_renewal', filters.isRenewal);
  if (user?.role === 'telemarketing_user') {
    throw new AppError(403, 'telemarketing_user is not supported for renewal tracker diagnosis');
  }
  if (permissionFilter && permissionFilter !== '1=1') {
    conditions.push(`(${permissionFilter})`);
  }
  return conditions;
}

function applyClaimsRiskPermissionFilters(
  filters: ClaimsRiskDiagnosisFilters,
  user: AgentDiagnosisUserContext | undefined
): ClaimsRiskDiagnosisFilters {
  if (!user) return filters;
  if (user.role === 'org_user') {
    if (!user.organization) {
      throw new AppError(403, 'Organization not specified for org_user role');
    }
    return { ...filters, orgName: user.organization };
  }
  if (user.role === 'telemarketing_user') {
    throw new AppError(403, 'telemarketing_user is not supported for claims risk diagnosis');
  }
  return filters;
}

function ensureCustomerFlowDiagnosisAccess(user: AgentDiagnosisUserContext | undefined): void {
  if (!user) return;
  if (user.role === 'org_user' || user.role === 'telemarketing_user') {
    throw new AppError(403, 'customer flow diagnosis requires branch-wide permission');
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
    try {
      validateDateRange('currentPeriod', input.currentPeriod.startDate, input.currentPeriod.endDate);
      validateDateRange('baselinePeriod', input.baselinePeriod.startDate, input.baselinePeriod.endDate);
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : String(err));
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
    try {
      validateDateRange('filters.date', input.filters.dateStart, input.filters.dateEnd);
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : String(err));
    }
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

router.post(
  '/renewal-tracker',
  createDomainMiddleware('RenewalTracker'),
  asyncHandler(async (req, res) => {
    const input = RenewalTrackerDiagnosisRequestSchema.parse(req.body);
    try {
      validateDateRange('range', input.start, input.end);
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : String(err));
    }
    if (!isValidDateFormat(input.cutoff)) {
      throw new AppError(400, `Invalid cutoff format: ${input.cutoff}. Expected YYYY-MM-DD`);
    }

    const diagnosis = await runRenewalTrackerDiagnosis({
      start: input.start,
      end: input.end,
      cutoff: input.cutoff,
      filters: input.filters,
      extraConditions: buildRenewalTrackerExtraConditions(input.filters, req.permissionFilter, req.user),
      limit: input.limit,
    });

    const response = SuccessResponseSchema(RenewalTrackerDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

router.post(
  '/claims-risk',
  createDomainMiddleware('ClaimsDetail', 'ClaimsAgg'),
  asyncHandler(async (req, res) => {
    const input = ClaimsRiskDiagnosisRequestSchema.parse(req.body);
    try {
      validateDateRange('filters.date', input.filters.dateStart, input.filters.dateEnd);
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : String(err));
    }

    const diagnosis = await runClaimsRiskDiagnosis({
      filters: applyClaimsRiskPermissionFilters(input.filters, req.user),
      limit: input.limit,
    });

    const response = SuccessResponseSchema(ClaimsRiskDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

router.post(
  '/customer-flow',
  createDomainMiddleware('CustomerFlow'),
  asyncHandler(async (req, res) => {
    ensureCustomerFlowDiagnosisAccess(req.user);
    const input = CustomerFlowDiagnosisRequestSchema.parse(req.body);
    const filters = input.year === undefined ? {} : { year: input.year };

    const diagnosis = await runCustomerFlowDiagnosis({
      filters,
      limit: input.limit,
    });

    const response = SuccessResponseSchema(CustomerFlowDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

export default router;
