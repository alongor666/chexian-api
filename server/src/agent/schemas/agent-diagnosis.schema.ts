import { z } from 'zod';
import { commonFilterSchema } from '../../utils/filter-params.js';

export const CostIndicatorDimensionSchema = z.enum([
  'customer_category',
  'org_level_3',
  'coverage_combination',
  'org_customer',
  'org_coverage',
]);

export const CostIndicatorDiagnosisRequestSchema = z.object({
  cutoffDate: z.string().min(1),
  dimension: CostIndicatorDimensionSchema.default('org_level_3'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  minPremium: z.coerce.number().min(0).default(0),
  filters: commonFilterSchema.optional().default({}),
});

export const CostIndicatorSeveritySchema = z.enum(['normal', 'observe', 'warning', 'critical']);
export const CostIndicatorDriverSchema = z.enum(['claim', 'expense', 'balanced', 'unknown']);
export const CostIndicatorToolIdSchema = z.enum(['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio']);

export const CostIndicatorAnomalySchema = z.object({
  rank: z.number().int().positive(),
  dimKey: z.string(),
  severity: CostIndicatorSeveritySchema,
  primaryDriver: CostIndicatorDriverSchema,
  metrics: z.object({
    policyCount: z.number().nullable(),
    totalPremium: z.number().nullable(),
    earnedPremium: z.number().nullable(),
    reportedClaims: z.number().nullable(),
    claimCases: z.number().nullable(),
    totalFee: z.number().nullable(),
    variableCostRatio: z.number().nullable(),
    earnedClaimRatio: z.number().nullable(),
    expenseRatio: z.number().nullable(),
    avgClaimAmount: z.number().nullable(),
    earnedLossFrequency: z.number().nullable(),
  }),
  contribution: z.object({
    claimRatio: z.number().nullable(),
    expenseRatio: z.number().nullable(),
    claimShareOfVariableCost: z.number().nullable(),
    expenseShareOfVariableCost: z.number().nullable(),
  }),
  drilldownSuggestions: z.array(z.string()),
});

export const CostIndicatorDiagnosisResultSchema = z.object({
  capabilityId: z.literal('cost_indicator_diagnosis'),
  status: z.literal('supported'),
  cutoffDate: z.string(),
  dimension: CostIndicatorDimensionSchema,
  requestedTools: z.array(CostIndicatorToolIdSchema),
  summary: z.object({
    rowCount: z.number().int().nonnegative(),
    diagnosedCount: z.number().int().nonnegative(),
    highRiskCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    topDriver: CostIndicatorDriverSchema,
  }),
  anomalies: z.array(CostIndicatorAnomalySchema),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
});

export type CostIndicatorDimension = z.infer<typeof CostIndicatorDimensionSchema>;
export type CostIndicatorDiagnosisRequest = z.infer<typeof CostIndicatorDiagnosisRequestSchema>;
export type CostIndicatorAnomaly = z.infer<typeof CostIndicatorAnomalySchema>;
export type CostIndicatorDiagnosisResult = z.infer<typeof CostIndicatorDiagnosisResultSchema>;

export const GrowthDiagnosisDimensionSchema = z.enum([
  'org_level_3',
  'customer_category',
  'coverage_combination',
  'salesman_name',
]);

export const GrowthDiagnosisComparisonModeSchema = z.enum(['yoy', 'mom', 'custom']);
export const GrowthDiagnosisTimeViewSchema = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
export const GrowthDiagnosisPerspectiveSchema = z.enum(['premium', 'policy_count']);
export const GrowthDiagnosisToolIdSchema = z.enum(['growth.query', 'growth.daily_context']);
export const GrowthDiagnosisSeveritySchema = z.enum([
  'critical_decline',
  'warning_decline',
  'observe_decline',
  'normal',
  'high_growth',
]);

const GrowthDiagnosisPeriodSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export const GrowthDiagnosisRequestSchema = z.object({
  currentPeriod: GrowthDiagnosisPeriodSchema,
  baselinePeriod: GrowthDiagnosisPeriodSchema,
  comparisonMode: GrowthDiagnosisComparisonModeSchema.default('custom'),
  timeView: GrowthDiagnosisTimeViewSchema.default('monthly'),
  perspective: GrowthDiagnosisPerspectiveSchema.default('premium'),
  dimension: GrowthDiagnosisDimensionSchema.default('org_level_3'),
  includeDailyContext: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  minCurrentValue: z.coerce.number().min(0).default(0),
  filters: commonFilterSchema.optional().default({}),
});

export const GrowthDiagnosisItemSchema = z.object({
  rank: z.number().int().positive(),
  dimKey: z.string(),
  severity: GrowthDiagnosisSeveritySchema,
  currentValue: z.number().nullable(),
  baselineValue: z.number().nullable(),
  growthRate: z.number().nullable(),
  contributionAmount: z.number().nullable(),
  contributionShare: z.number().nullable(),
  direction: z.enum(['increase', 'decline', 'flat', 'unknown']),
});

export const GrowthDailyContextSchema = z.object({
  timePeriod: z.string(),
  currentValue: z.number().nullable(),
  baselineValue: z.number().nullable(),
  growthRate: z.number().nullable(),
  periodGrowthRate: z.number().nullable(),
  ytdGrowthRate: z.number().nullable(),
});

export const GrowthDiagnosisResultSchema = z.object({
  capabilityId: z.literal('growth_diagnosis'),
  status: z.literal('supported'),
  comparisonMode: GrowthDiagnosisComparisonModeSchema,
  timeView: GrowthDiagnosisTimeViewSchema,
  perspective: GrowthDiagnosisPerspectiveSchema,
  dimension: GrowthDiagnosisDimensionSchema,
  currentPeriod: GrowthDiagnosisPeriodSchema,
  baselinePeriod: GrowthDiagnosisPeriodSchema,
  requestedTools: z.array(GrowthDiagnosisToolIdSchema),
  summary: z.object({
    rowCount: z.number().int().nonnegative(),
    diagnosedCount: z.number().int().nonnegative(),
    declineCount: z.number().int().nonnegative(),
    highGrowthCount: z.number().int().nonnegative(),
    totalCurrentValue: z.number().nullable(),
    totalBaselineValue: z.number().nullable(),
    overallGrowthRate: z.number().nullable(),
    topPositiveContributor: z.string().nullable(),
    topNegativeContributor: z.string().nullable(),
  }),
  diagnostics: z.array(GrowthDiagnosisItemSchema),
  dailyContext: z.array(GrowthDailyContextSchema).default([]),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  drilldownSuggestions: z.array(z.string()),
});

export type GrowthDiagnosisDimension = z.infer<typeof GrowthDiagnosisDimensionSchema>;
export type GrowthDiagnosisComparisonMode = z.infer<typeof GrowthDiagnosisComparisonModeSchema>;
export type GrowthDiagnosisTimeView = z.infer<typeof GrowthDiagnosisTimeViewSchema>;
export type GrowthDiagnosisPerspective = z.infer<typeof GrowthDiagnosisPerspectiveSchema>;
export type GrowthDiagnosisRequest = z.infer<typeof GrowthDiagnosisRequestSchema>;
export type GrowthDiagnosisResult = z.infer<typeof GrowthDiagnosisResultSchema>;

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

const QuoteOptionalTextSchema = z.preprocess(blankToUndefined, z.string().optional());
const QuoteOptionalEnumSchema = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional());

export const QuoteConversionDiagnosisFilterSchema = z.object({
  dateStart: QuoteOptionalTextSchema,
  dateEnd: QuoteOptionalTextSchema,
  renewalType: QuoteOptionalEnumSchema(['续保', '转保']),
  orgName: QuoteOptionalTextSchema,
  teamName: QuoteOptionalTextSchema,
  salesmanNo: QuoteOptionalTextSchema,
  customerCategory: QuoteOptionalTextSchema,
  insuranceCombo: QuoteOptionalEnumSchema(['主全', '交三']),
  isTelemarketing: QuoteOptionalEnumSchema(['电销', '非电销']),
  isNewEnergy: QuoteOptionalEnumSchema(['是', '否']),
  isTransferred: QuoteOptionalEnumSchema(['是', '否']),
  riskGrade: QuoteOptionalEnumSchema(['A', 'B', 'C', 'D']),
  ncdMin: z.preprocess(blankToUndefined, z.coerce.number().optional()),
  ncdMax: z.preprocess(blankToUndefined, z.coerce.number().optional()),
});

export const QuoteConversionDrilldownLevelSchema = z.enum(['org', 'team', 'salesman']);
export const QuoteConversionTrendGranularitySchema = z.enum(['day', 'week', 'month']);
export const QuoteConversionToolIdSchema = z.enum([
  'quote_conversion.kpi',
  'quote_conversion.funnel',
  'quote_conversion.drilldown',
  'quote_conversion.trend',
]);
export const QuoteConversionSeveritySchema = z.enum(['normal', 'observe', 'warning', 'critical']);

export const QuoteConversionDiagnosisRequestSchema = z.object({
  filters: QuoteConversionDiagnosisFilterSchema.default({}),
  drilldownLevel: QuoteConversionDrilldownLevelSchema.default('org'),
  trendGranularity: QuoteConversionTrendGranularitySchema.default('week'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const QuoteFunnelBottleneckSchema = z.object({
  renewalType: z.string(),
  stage: z.enum(['total_to_valid', 'valid_to_quality', 'quality_to_insured']),
  fromCount: z.number().nullable(),
  toCount: z.number().nullable(),
  dropRate: z.number().nullable(),
  severity: QuoteConversionSeveritySchema,
});

export const QuoteSegmentDifferenceSchema = z.object({
  dimKey: z.string(),
  dimName: z.string(),
  totalQuotes: z.number().nullable(),
  totalInsured: z.number().nullable(),
  underwritingRate: z.number().nullable(),
  renewalRate: z.number().nullable(),
  switchRate: z.number().nullable(),
  gapFromOverall: z.number().nullable(),
  severity: QuoteConversionSeveritySchema,
});

export const QuoteTrendAnomalySchema = z.object({
  timeBucket: z.string(),
  renewalType: z.string(),
  underwritingRate: z.number().nullable(),
  previousRate: z.number().nullable(),
  rateChange: z.number().nullable(),
  severity: QuoteConversionSeveritySchema,
});

export const QuoteConversionDiagnosisResultSchema = z.object({
  capabilityId: z.literal('quote_conversion_diagnosis'),
  status: z.literal('supported'),
  requestedTools: z.array(QuoteConversionToolIdSchema),
  filters: QuoteConversionDiagnosisFilterSchema,
  drilldownLevel: QuoteConversionDrilldownLevelSchema,
  trendGranularity: QuoteConversionTrendGranularitySchema,
  summary: z.object({
    totalQuotes: z.number().nullable(),
    totalInsured: z.number().nullable(),
    underwritingRate: z.number().nullable(),
    avgDiscountRate: z.number().nullable(),
    renewalUnderwritingRate: z.number().nullable(),
    switchUnderwritingRate: z.number().nullable(),
    worstSegment: z.string().nullable(),
    trendDropCount: z.number().int().nonnegative(),
  }),
  funnelBottlenecks: z.array(QuoteFunnelBottleneckSchema),
  segmentDifferences: z.array(QuoteSegmentDifferenceSchema),
  trendAnomalies: z.array(QuoteTrendAnomalySchema),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  drilldownSuggestions: z.array(z.string()),
});

export type QuoteConversionDiagnosisFilters = z.infer<typeof QuoteConversionDiagnosisFilterSchema>;
export type QuoteConversionDrilldownLevel = z.infer<typeof QuoteConversionDrilldownLevelSchema>;
export type QuoteConversionTrendGranularity = z.infer<typeof QuoteConversionTrendGranularitySchema>;
export type QuoteConversionDiagnosisRequest = z.infer<typeof QuoteConversionDiagnosisRequestSchema>;
export type QuoteConversionDiagnosisResult = z.infer<typeof QuoteConversionDiagnosisResultSchema>;

const RenewalTrackerOptionalStringArraySchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return value;
  },
  z.array(z.string()).default([])
);

const RenewalTrackerOptionalBooleanSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value;
}, z.boolean().optional());

export const RenewalTrackerDiagnosisFilterSchema = z.object({
  orgNames: RenewalTrackerOptionalStringArraySchema,
  salesmanNames: RenewalTrackerOptionalStringArraySchema,
  customerCategories: RenewalTrackerOptionalStringArraySchema,
  coverageCombinations: RenewalTrackerOptionalStringArraySchema,
  fuelCategories: RenewalTrackerOptionalStringArraySchema,
  usedTransferTypes: RenewalTrackerOptionalStringArraySchema,
  renewalTypes: RenewalTrackerOptionalStringArraySchema,
  isNev: RenewalTrackerOptionalBooleanSchema,
  isNewCar: RenewalTrackerOptionalBooleanSchema,
  isTransfer: RenewalTrackerOptionalBooleanSchema,
  isRenewal: RenewalTrackerOptionalBooleanSchema,
});

const RenewalTrackerDiagnosisDefaultFilters = {
  orgNames: [],
  salesmanNames: [],
  customerCategories: [],
  coverageCombinations: [],
  fuelCategories: [],
  usedTransferTypes: [],
  renewalTypes: [],
};

export const RenewalTrackerToolIdSchema = z.enum(['renewal_tracker.query']);
export const RenewalTrackerSeveritySchema = z.enum(['normal', 'observe', 'warning', 'critical']);
export const RenewalTrackerDiagnosisLevelSchema = z.enum(['org', 'team', 'salesman']);
export const RenewalTrackerDimensionSchema = z.enum([
  'customer_category',
  'coverage_combination',
  'fuel_category',
  'used_transfer_type',
  'renewal_type',
]);

export const RenewalTrackerDiagnosisRequestSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  cutoff: z.string().min(1),
  filters: RenewalTrackerDiagnosisFilterSchema.default(RenewalTrackerDiagnosisDefaultFilters),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const RenewalTrackerMetricSetSchema = z.object({
  expectedRenewalCount: z.number().nullable(),
  quotedCount: z.number().nullable(),
  renewedCount: z.number().nullable(),
  quoteRate: z.number().nullable(),
  renewalRate: z.number().nullable(),
  quoteToRenewalRate: z.number().nullable(),
  quoteGap: z.number().nullable(),
  renewalGap: z.number().nullable(),
});

export const RenewalTrackerSegmentDiagnosisSchema = RenewalTrackerMetricSetSchema.extend({
  level: RenewalTrackerDiagnosisLevelSchema,
  dimKey: z.string(),
  orgName: z.string().nullable(),
  teamName: z.string().nullable(),
  salesmanName: z.string().nullable(),
  severity: RenewalTrackerSeveritySchema,
});

export const RenewalTrackerDimensionDiagnosisSchema = RenewalTrackerMetricSetSchema.extend({
  dimension: RenewalTrackerDimensionSchema,
  dimKey: z.string(),
  severity: RenewalTrackerSeveritySchema,
});

export const RenewalTrackerDiagnosisResultSchema = z.object({
  capabilityId: z.literal('renewal_tracker_diagnosis'),
  status: z.literal('supported'),
  requestedTools: z.array(RenewalTrackerToolIdSchema),
  start: z.string(),
  end: z.string(),
  cutoff: z.string(),
  filters: RenewalTrackerDiagnosisFilterSchema,
  summary: RenewalTrackerMetricSetSchema.extend({
    exposureRowCount: z.number().nullable(),
    distinctVehicleCount: z.number().nullable(),
    distinctSourcePolicyCount: z.number().nullable(),
    latestDataDate: z.string().nullable(),
    weakSegmentCount: z.number().int().nonnegative(),
  }),
  segmentDiagnostics: z.array(RenewalTrackerSegmentDiagnosisSchema),
  dimensionDiagnostics: z.array(RenewalTrackerDimensionDiagnosisSchema),
  cutoffExplanation: z.string(),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  drilldownSuggestions: z.array(z.string()),
});

export type RenewalTrackerDiagnosisFilters = z.infer<typeof RenewalTrackerDiagnosisFilterSchema>;
export type RenewalTrackerDiagnosisRequest = z.infer<typeof RenewalTrackerDiagnosisRequestSchema>;
export type RenewalTrackerDiagnosisResult = z.infer<typeof RenewalTrackerDiagnosisResultSchema>;

const ClaimsRiskOptionalTextSchema = z.preprocess(blankToUndefined, z.string().optional());
const ClaimsRiskOptionalEnumSchema = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional());

export const ClaimsRiskDiagnosisFilterSchema = z.object({
  dateStart: ClaimsRiskOptionalTextSchema,
  dateEnd: ClaimsRiskOptionalTextSchema,
  orgName: ClaimsRiskOptionalTextSchema,
  claimStatus: ClaimsRiskOptionalTextSchema,
  isBodilyInjury: ClaimsRiskOptionalEnumSchema(['true', 'false']),
  accidentCause: ClaimsRiskOptionalTextSchema,
  accidentCity: ClaimsRiskOptionalTextSchema,
  customerCategory: ClaimsRiskOptionalTextSchema,
  isNev: ClaimsRiskOptionalEnumSchema(['1', '0', 'true', 'false']),
  coverageCombination: ClaimsRiskOptionalTextSchema,
  isTransfer: ClaimsRiskOptionalEnumSchema(['true', 'false']),
  vehicleQuickFilter: ClaimsRiskOptionalTextSchema,
  businessNature: ClaimsRiskOptionalEnumSchema(['commercial', 'non_commercial']),
  isNewCar: ClaimsRiskOptionalEnumSchema(['true', 'false']),
  isRenewal: ClaimsRiskOptionalEnumSchema(['true', 'false']),
});

export const ClaimsRiskToolIdSchema = z.enum([
  'claims_detail.pending_overview',
  'claims_detail.cause_analysis',
  'claims_detail.frequency_yoy',
]);
export const ClaimsRiskSeveritySchema = z.enum(['normal', 'observe', 'warning', 'critical']);

export const ClaimsRiskDiagnosisRequestSchema = z.object({
  filters: ClaimsRiskDiagnosisFilterSchema.default({}),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const ClaimsRiskPendingRiskSchema = z.object({
  pendingCases: z.number().nullable(),
  pendingReserveWan: z.number().nullable(),
  avgReserve: z.number().nullable(),
  injuryCases: z.number().nullable(),
  injuryReserveWan: z.number().nullable(),
  pendingCaseShare: z.number().nullable(),
  severity: ClaimsRiskSeveritySchema,
});

export const ClaimsRiskCauseDiagnosticSchema = z.object({
  accidentCause: z.string(),
  cases: z.number().nullable(),
  reserveWan: z.number().nullable(),
  avgReserve: z.number().nullable(),
  injuryCases: z.number().nullable(),
  injuryPct: z.number().nullable(),
  severity: ClaimsRiskSeveritySchema,
});

export const ClaimsRiskFrequencyDiagnosticSchema = z.object({
  period: z.string(),
  year: z.number().int(),
  quarter: z.number().int(),
  claimCount: z.number().nullable(),
  policyCount: z.number().nullable(),
  reserveWan: z.number().nullable(),
  freqPer1000: z.number().nullable(),
  injuryPct: z.number().nullable(),
  previousFreqPer1000: z.number().nullable(),
  yoyChange: z.number().nullable(),
  severity: ClaimsRiskSeveritySchema,
});

export const ClaimsRiskDiagnosisResultSchema = z.object({
  capabilityId: z.literal('claims_risk_diagnosis'),
  status: z.literal('supported'),
  requestedTools: z.array(ClaimsRiskToolIdSchema),
  filters: ClaimsRiskDiagnosisFilterSchema,
  summary: z.object({
    totalCases: z.number().nullable(),
    pendingCases: z.number().nullable(),
    pendingReserveWan: z.number().nullable(),
    pendingCaseShare: z.number().nullable(),
    topCause: z.string().nullable(),
    latestFrequencyPer1000: z.number().nullable(),
    latestFrequencyYoyChange: z.number().nullable(),
  }),
  pendingRisk: ClaimsRiskPendingRiskSchema,
  causeDiagnostics: z.array(ClaimsRiskCauseDiagnosticSchema),
  frequencyDiagnostics: z.array(ClaimsRiskFrequencyDiagnosticSchema),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  drilldownSuggestions: z.array(z.string()),
});

export type ClaimsRiskDiagnosisFilters = z.infer<typeof ClaimsRiskDiagnosisFilterSchema>;
export type ClaimsRiskDiagnosisRequest = z.infer<typeof ClaimsRiskDiagnosisRequestSchema>;
export type ClaimsRiskDiagnosisResult = z.infer<typeof ClaimsRiskDiagnosisResultSchema>;

export const CustomerFlowToolIdSchema = z.enum([
  'customer_flow.summary',
  'customer_flow.inflow',
  'customer_flow.outflow',
  'customer_flow.trend',
  'customer_flow.metadata',
]);
export const CustomerFlowSeveritySchema = z.enum(['normal', 'observe', 'warning', 'critical']);

export const CustomerFlowDiagnosisFilterSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030).optional(),
});

export const CustomerFlowDiagnosisRequestSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const CustomerFlowInsurerDiagnosticSchema = z.object({
  insurer: z.string(),
  policyCount: z.number().nullable(),
  sharePct: z.number().nullable(),
});

export const CustomerFlowTrendDiagnosticSchema = z.object({
  month: z.string(),
  totalPolicies: z.number().nullable(),
  inflowCount: z.number().nullable(),
  outflowCount: z.number().nullable(),
  netFlow: z.number(),
  direction: z.enum(['net_inflow', 'net_outflow', 'balanced']),
});

export const CustomerFlowDiagnosisItemSchema = z.object({
  kind: z.literal('flow_balance'),
  severity: CustomerFlowSeveritySchema,
  message: z.string(),
  value: z.number().nullable(),
});

export const CustomerFlowDiagnosisResultSchema = z.object({
  capabilityId: z.literal('customer_flow_diagnosis'),
  status: z.literal('supported'),
  requestedTools: z.array(CustomerFlowToolIdSchema),
  filters: CustomerFlowDiagnosisFilterSchema,
  summary: z.object({
    totalPolicies: z.number().nullable(),
    hasPrevious: z.number().nullable(),
    hasNext: z.number().nullable(),
    inflowCount: z.number().nullable(),
    outflowCount: z.number().nullable(),
    netFlow: z.number(),
    inflowRate: z.number().nullable(),
    outflowRate: z.number().nullable(),
    selfRenewalCount: z.number().nullable(),
    topInflowInsurer: z.string().nullable(),
    topOutflowInsurer: z.string().nullable(),
    latestMonth: z.string().nullable(),
    latestNetFlow: z.number().nullable(),
  }),
  diagnostics: z.array(CustomerFlowDiagnosisItemSchema),
  inflowDiagnostics: z.array(CustomerFlowInsurerDiagnosticSchema),
  outflowDiagnostics: z.array(CustomerFlowInsurerDiagnosticSchema),
  trendDiagnostics: z.array(CustomerFlowTrendDiagnosticSchema),
  dataReadiness: z.object({
    minDate: z.string(),
    maxDate: z.string(),
    years: z.array(z.number()),
    totalRows: z.number().nullable(),
    status: z.enum(['ready', 'empty']),
  }),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  drilldownSuggestions: z.array(z.string()),
});

export type CustomerFlowDiagnosisFilters = z.infer<typeof CustomerFlowDiagnosisFilterSchema>;
export type CustomerFlowDiagnosisRequest = z.infer<typeof CustomerFlowDiagnosisRequestSchema>;
export type CustomerFlowDiagnosisResult = z.infer<typeof CustomerFlowDiagnosisResultSchema>;

export const BusinessPatrolCapabilityIdSchema = z.enum([
  'growth_diagnosis',
  'cost_indicator_diagnosis',
  'quote_conversion_diagnosis',
  'renewal_tracker_diagnosis',
  'claims_risk_diagnosis',
  'customer_flow_diagnosis',
]);
export const BusinessPatrolSeveritySchema = z.enum(['normal', 'observe', 'warning', 'critical']);
export const BusinessPatrolSubdiagnosisStatusSchema = z.enum(['completed', 'failed', 'timeout']);

export const BusinessPatrolDiagnosisRequestSchema = z.object({
  timeoutMs: z.coerce.number().int().min(100).max(5000).default(5000),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  diagnostics: z.object({
    growth: GrowthDiagnosisRequestSchema,
    costIndicators: CostIndicatorDiagnosisRequestSchema,
    quoteConversion: QuoteConversionDiagnosisRequestSchema.default({
      filters: {},
      drilldownLevel: 'org',
      trendGranularity: 'week',
      limit: 10,
    }),
    renewalTracker: RenewalTrackerDiagnosisRequestSchema,
    claimsRisk: ClaimsRiskDiagnosisRequestSchema.default({ filters: {}, limit: 10 }),
    customerFlow: CustomerFlowDiagnosisRequestSchema.default({ limit: 10 }),
  }),
});

export const BusinessPatrolCapabilityStatusSchema = z.object({
  capabilityId: BusinessPatrolCapabilityIdSchema,
  status: BusinessPatrolSubdiagnosisStatusSchema,
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});

export const BusinessPatrolFindingSchema = z.object({
  rank: z.number().int().positive(),
  capabilityId: BusinessPatrolCapabilityIdSchema,
  severity: BusinessPatrolSeveritySchema,
  affectedMetrics: z.array(z.string()),
  message: z.string(),
  recommendedDrilldown: z.array(z.string()),
});

export const BusinessPatrolDiagnosisResultSchema = z.object({
  capabilityId: z.literal('business_patrol_diagnosis'),
  status: z.enum(['supported', 'partial']),
  requestedCapabilities: z.array(BusinessPatrolCapabilityIdSchema),
  timeoutMs: z.number().int().positive(),
  summary: z.object({
    totalCapabilities: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    timeoutCount: z.number().int().nonnegative(),
    prioritizedFindingCount: z.number().int().nonnegative(),
    criticalCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    topPriorityCapability: BusinessPatrolCapabilityIdSchema.nullable(),
  }),
  capabilityStatuses: z.array(BusinessPatrolCapabilityStatusSchema),
  prioritizedFindings: z.array(BusinessPatrolFindingSchema),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  drilldownSuggestions: z.array(z.string()),
});

export type BusinessPatrolCapabilityId = z.infer<typeof BusinessPatrolCapabilityIdSchema>;
export type BusinessPatrolSeverity = z.infer<typeof BusinessPatrolSeveritySchema>;
export type BusinessPatrolSubdiagnosisStatus = z.infer<typeof BusinessPatrolSubdiagnosisStatusSchema>;
export type BusinessPatrolDiagnosisRequest = z.infer<typeof BusinessPatrolDiagnosisRequestSchema>;
export type BusinessPatrolDiagnosisResult = z.infer<typeof BusinessPatrolDiagnosisResultSchema>;
