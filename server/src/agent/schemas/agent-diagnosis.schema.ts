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
