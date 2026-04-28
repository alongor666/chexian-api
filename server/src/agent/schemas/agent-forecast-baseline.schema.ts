/**
 * Agent forecast baseline schema
 *
 * 已发生（系统精确给出）+ 4 个变量的历史分位数 + 默认建模假设。
 *
 * Variable taxonomy (matches docs/AGENT_FORECAST_BC_HANDOFF.md §three):
 *  - V1 (historicalLossRatio):     历史保单剩余敞口的终极赔付率
 *  - V2 (newSigningPremiumGrowth): 未来新签保费增速 (YoY)
 *  - V3 (newSigningLossRatio):     新签业务终极赔付率（默认与 V1 同源历史分布）
 *  - V4 (newSigningExpenseRatio):  新签业务费用率（最近 N 月均值）
 */

import { z } from 'zod';

export const ForecastBaselineDimensionSchema = z.enum([
  'org_level_3',
  'customer_category',
  'coverage_combination',
  'salesman_name',
]);

export const ForecastBaselineFiltersSchema = z.object({
  orgLevel3: z.array(z.string().min(1).max(120)).max(50).optional(),
  customerCategory: z.array(z.string().min(1).max(120)).max(50).optional(),
  coverageCombination: z.array(z.string().min(1).max(120)).max(50).optional(),
});

export const ForecastBaselineRequestSchema = z.object({
  cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'cutoffDate must use YYYY-MM-DD'),
  filters: ForecastBaselineFiltersSchema.default({}),
  /** History window in years for V1/V2/V3 percentile sampling. */
  historyWindowYears: z.number().int().min(1).max(10).default(3),
  /** Trailing months window for V4 (recent expense ratio). */
  recentExpenseMonths: z.number().int().min(1).max(24).default(6),
});

export const PercentileDistributionSchema = z.object({
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
});

export const HistoricalCohortSchema = z.object({
  year: z.number().int(),
  premium: z.number(),
  claims: z.number(),
  lossRatioPct: z.number(),
});

export const YoYGrowthSampleSchema = z.object({
  year: z.number().int(),
  premium: z.number(),
  prevYearPremium: z.number().nullable(),
  yoyGrowthPct: z.number().nullable(),
});

export const ForecastBaselineActualSchema = z.object({
  signedPremium: z.number(),
  earnedPremium: z.number(),
  earnedRatioPct: z.number(),
  cumulativeReportedClaims: z.number(),
  earnedClaimRatioPct: z.number(),
  cumulativeFee: z.number(),
  feeRatioPct: z.number(),
  remainingExposure: z.number(),
  policyCount: z.number().int(),
});

export const ForecastVariableHistoricalLossRatioSchema = z.object({
  windowYears: z.number().int(),
  cohorts: z.array(HistoricalCohortSchema),
  percentiles: PercentileDistributionSchema,
  cohortCount: z.number().int(),
});

export const ForecastVariablePremiumGrowthSchema = z.object({
  windowYears: z.number().int(),
  samples: z.array(YoYGrowthSampleSchema),
  percentiles: PercentileDistributionSchema,
  sampleCount: z.number().int(),
});

export const ForecastVariableExpenseRatioSchema = z.object({
  windowMonths: z.number().int(),
  recentSignedPremium: z.number(),
  recentFee: z.number(),
  meanExpenseRatioPct: z.number(),
  policyCount: z.number().int(),
});

export const ForecastBaselineDefaultsSchema = z.object({
  /** All four variables default to "中观 / 中位数" mode. */
  v1HistoricalLossRatio: PercentileDistributionSchema,
  v2NewSigningPremiumGrowth: PercentileDistributionSchema,
  v3NewSigningLossRatio: PercentileDistributionSchema,
  v4NewSigningExpenseRatio: z.number(),
});

export const ForecastBaselineResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    cutoffDate: z.string(),
    filters: ForecastBaselineFiltersSchema,
    historyWindowYears: z.number().int(),
    recentExpenseMonths: z.number().int(),
    actual: ForecastBaselineActualSchema,
    variables: z.object({
      historicalLossRatio: ForecastVariableHistoricalLossRatioSchema,
      newSigningPremiumGrowth: ForecastVariablePremiumGrowthSchema,
      newSigningLossRatio: ForecastVariableHistoricalLossRatioSchema,
      newSigningExpenseRatio: ForecastVariableExpenseRatioSchema,
    }),
    defaults: ForecastBaselineDefaultsSchema,
    warnings: z.array(z.string()),
    forbiddenInterpretations: z.array(z.string()),
  }),
});

export type ForecastBaselineRequest = z.infer<typeof ForecastBaselineRequestSchema>;
export type ForecastBaselineResponse = z.infer<typeof ForecastBaselineResponseSchema>;
export type ForecastBaselineActual = z.infer<typeof ForecastBaselineActualSchema>;
export type PercentileDistribution = z.infer<typeof PercentileDistributionSchema>;
export type HistoricalCohort = z.infer<typeof HistoricalCohortSchema>;
export type YoYGrowthSample = z.infer<typeof YoYGrowthSampleSchema>;
