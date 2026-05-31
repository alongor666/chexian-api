import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { readonlyMiddleware } from '../../middleware/readonly.js';
import { permissionMiddleware } from '../../middleware/permission.js';
import { asyncHandler, AppError } from '../../middleware/error.js';
import { buildWhereFromFilterParams, buildWhereFromFilterParamsWithoutDate } from '../../utils/filter-params.js';
import { buildInCondition, isValidDateFormat, validateDateRange } from '../../utils/sql-sanitizer.js';
import { createDomainMiddleware } from '../../routes/query/shared.js';
import { getBootstrapper } from '../../services/bootstrapper-registry.js';
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
  BusinessPatrolDiagnosisRequestSchema,
  BusinessPatrolDiagnosisResultSchema,
  type BusinessPatrolDiagnosisRequest,
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
import { runBusinessPatrolTasks, type BusinessPatrolTask } from '../services/agent-business-patrol-diagnosis-service.js';

const router = Router();

router.use(authMiddleware);
router.use(readonlyMiddleware); // PAT 强制只读：非 GET 直接 403
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

function validateBusinessPatrolInput(input: BusinessPatrolDiagnosisRequest): void {
  if (!isValidDateFormat(input.diagnostics.costIndicators.cutoffDate)) {
    throw new AppError(400, `Invalid cutoffDate format: ${input.diagnostics.costIndicators.cutoffDate}. Expected YYYY-MM-DD`);
  }
  try {
    validateDateRange('growth.currentPeriod', input.diagnostics.growth.currentPeriod.startDate, input.diagnostics.growth.currentPeriod.endDate);
    validateDateRange('growth.baselinePeriod', input.diagnostics.growth.baselinePeriod.startDate, input.diagnostics.growth.baselinePeriod.endDate);
    validateDateRange('quoteConversion.filters.date', input.diagnostics.quoteConversion.filters.dateStart, input.diagnostics.quoteConversion.filters.dateEnd);
    validateDateRange('renewalTracker.range', input.diagnostics.renewalTracker.start, input.diagnostics.renewalTracker.end);
    validateDateRange('claimsRisk.filters.date', input.diagnostics.claimsRisk.filters.dateStart, input.diagnostics.claimsRisk.filters.dateEnd);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : String(err));
  }
  if (!isValidDateFormat(input.diagnostics.renewalTracker.cutoff)) {
    throw new AppError(400, `Invalid cutoff format: ${input.diagnostics.renewalTracker.cutoff}. Expected YYYY-MM-DD`);
  }
  const quoteFilters = input.diagnostics.quoteConversion.filters;
  if (quoteFilters.ncdMin !== undefined && quoteFilters.ncdMax !== undefined && quoteFilters.ncdMin > quoteFilters.ncdMax) {
    throw new AppError(400, 'ncdMin cannot be greater than ncdMax');
  }
}

function buildBusinessPatrolTasks(
  input: BusinessPatrolDiagnosisRequest,
  permissionFilter: string | undefined,
  user: AgentDiagnosisUserContext | undefined
): BusinessPatrolTask[] {
  const costWhereClause = buildWhereFromFilterParams(input.diagnostics.costIndicators.filters, permissionFilter || '1=1');
  const growthWhereClause = buildWhereFromFilterParamsWithoutDate(input.diagnostics.growth.filters, permissionFilter || '1=1');
  return [
    {
      capabilityId: 'growth_diagnosis',
      run: async () => {
        await ensureBusinessPatrolDomains();
        return runGrowthDiagnosis({
          currentPeriod: input.diagnostics.growth.currentPeriod,
          baselinePeriod: input.diagnostics.growth.baselinePeriod,
          comparisonMode: input.diagnostics.growth.comparisonMode,
          timeView: input.diagnostics.growth.timeView,
          perspective: input.diagnostics.growth.perspective,
          dimension: input.diagnostics.growth.dimension,
          whereClause: growthWhereClause,
          includeDailyContext: input.diagnostics.growth.includeDailyContext,
          limit: input.diagnostics.growth.limit,
          minCurrentValue: input.diagnostics.growth.minCurrentValue,
        });
      },
    },
    {
      capabilityId: 'cost_indicator_diagnosis',
      run: async () => {
        await ensureBusinessPatrolDomains('ClaimsAgg');
        return runCostIndicatorDiagnosis({
          cutoffDate: input.diagnostics.costIndicators.cutoffDate,
          dimension: input.diagnostics.costIndicators.dimension,
          whereClause: costWhereClause,
          limit: input.diagnostics.costIndicators.limit,
          minPremium: input.diagnostics.costIndicators.minPremium,
        });
      },
    },
    {
      capabilityId: 'quote_conversion_diagnosis',
      run: async () => {
        const filters = applyQuoteConversionPermissionFilters(input.diagnostics.quoteConversion.filters, user);
        await ensureBusinessPatrolDomains('QuoteConversion');
        return runQuoteConversionDiagnosis({
          filters,
          drilldownLevel: input.diagnostics.quoteConversion.drilldownLevel,
          trendGranularity: input.diagnostics.quoteConversion.trendGranularity,
          limit: input.diagnostics.quoteConversion.limit,
        });
      },
    },
    {
      capabilityId: 'renewal_tracker_diagnosis',
      run: async () => {
        const extraConditions = buildRenewalTrackerExtraConditions(input.diagnostics.renewalTracker.filters, permissionFilter, user);
        await ensureBusinessPatrolDomains('RenewalTracker');
        return runRenewalTrackerDiagnosis({
          start: input.diagnostics.renewalTracker.start,
          end: input.diagnostics.renewalTracker.end,
          cutoff: input.diagnostics.renewalTracker.cutoff,
          filters: input.diagnostics.renewalTracker.filters,
          extraConditions,
          limit: input.diagnostics.renewalTracker.limit,
        });
      },
    },
    {
      capabilityId: 'claims_risk_diagnosis',
      run: async () => {
        const filters = applyClaimsRiskPermissionFilters(input.diagnostics.claimsRisk.filters, user);
        await ensureBusinessPatrolDomains('ClaimsDetail', 'ClaimsAgg');
        return runClaimsRiskDiagnosis({
          filters,
          limit: input.diagnostics.claimsRisk.limit,
        });
      },
    },
    {
      capabilityId: 'customer_flow_diagnosis',
      run: async () => {
        ensureCustomerFlowDiagnosisAccess(user);
        await ensureBusinessPatrolDomains('CustomerFlow');
        const filters = input.diagnostics.customerFlow.year === undefined ? {} : { year: input.diagnostics.customerFlow.year };
        return runCustomerFlowDiagnosis({
          filters,
          limit: input.diagnostics.customerFlow.limit,
        });
      },
    },
  ];
}

async function ensureBusinessPatrolDomains(...domains: string[]): Promise<void> {
  const bootstrapper = getBootstrapper();
  if (!bootstrapper) return;
  for (const domain of domains) {
    await bootstrapper.ensureDomainLoaded(domain);
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

router.post(
  '/business-patrol',
  asyncHandler(async (req, res) => {
    const input = BusinessPatrolDiagnosisRequestSchema.parse(req.body);
    validateBusinessPatrolInput(input);
    const diagnosis = await runBusinessPatrolTasks(
      buildBusinessPatrolTasks(input, req.permissionFilter, req.user),
      { timeoutMs: input.timeoutMs, limit: input.limit }
    );

    const response = SuccessResponseSchema(BusinessPatrolDiagnosisResultSchema).parse({
      success: true,
      data: diagnosis,
    });
    res.json(response);
  })
);

export default router;
