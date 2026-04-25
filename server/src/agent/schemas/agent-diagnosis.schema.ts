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
