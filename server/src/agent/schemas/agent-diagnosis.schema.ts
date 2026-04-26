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
