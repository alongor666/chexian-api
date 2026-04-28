import { z } from 'zod';

export const ProfitScenarioAssumptionSourceSchema = z.enum([
  'caller_provided',
  'pricing_redline_default',
  'derived_from_metric_registry',
]);

export const EarningScheduleItemSchema = z.object({
  period: z.string().min(1),
  earnedRatio: z.number().min(0).max(100),
});

export const ProfitScenarioRequestSchema = z.object({
  premium: z.number().positive(),
  ultimateVariableCostRatio: z.number().min(0).max(150),
  ultimateFixedCostRatio: z.number().min(0).max(150),
  earningSchedule: z.array(EarningScheduleItemSchema).min(1).refine(
    (items) => Math.abs(items.reduce((sum, item) => sum + item.earnedRatio, 0) - 100) < 0.01,
    { message: 'earningSchedule sum must equal 100' }
  ),
  scenarioName: z.string().min(1),
  assumptionSource: ProfitScenarioAssumptionSourceSchema,
});

export const ProfitScenarioResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    scenarioName: z.string(),
    ultimateCombinedCostRatio: z.number(),
    forecastOperatingProfitMargin: z.number(),
    perPeriodForecast: z.array(z.object({
      period: z.string(),
      earnedRatio: z.number(),
      forecastOperatingProfit: z.number(),
    })),
    fullCycleForecastOperatingProfit: z.number(),
    onePctSensitivity: z.array(z.object({
      period: z.string(),
      sensitivity: z.number(),
    })),
    warnings: z.array(z.string()),
    forbiddenInterpretations: z.array(z.string()),
    assumptionSource: ProfitScenarioAssumptionSourceSchema,
  }),
});

export type ProfitScenarioRequest = z.infer<typeof ProfitScenarioRequestSchema>;
export type ProfitScenarioResponse = z.infer<typeof ProfitScenarioResponseSchema>;

export const SegmentDimensionSchema = z.enum([
  'org_level_3',
  'customer_category',
  'coverage_combination',
  'salesman_name',
]);

export const ProfitSegmentScenarioSchema = z.object({
  dimensionLabel: z.string().min(1).max(200),
  premium: z.number().positive(),
  ultimateVariableCostRatio: z.number().min(0).max(150),
  ultimateFixedCostRatio: z.number().min(0).max(150),
  earningSchedule: z.array(EarningScheduleItemSchema).min(1).refine(
    (items) => Math.abs(items.reduce((sum, item) => sum + item.earnedRatio, 0) - 100) < 0.01,
    { message: 'earningSchedule sum must equal 100' }
  ),
  assumptionSource: ProfitScenarioAssumptionSourceSchema,
});

export const ProfitSegmentRequestSchema = z.object({
  scenarioName: z.string().min(1),
  dimension: SegmentDimensionSchema,
  segments: z.array(ProfitSegmentScenarioSchema).min(1).max(50),
});

export const ProfitSegmentResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    scenarioName: z.string(),
    dimension: SegmentDimensionSchema,
    segments: z.array(z.object({
      dimensionLabel: z.string(),
      ultimateCombinedCostRatio: z.number(),
      forecastOperatingProfitMargin: z.number(),
      perPeriodForecast: z.array(z.object({
        period: z.string(),
        earnedRatio: z.number(),
        forecastOperatingProfit: z.number(),
      })),
      fullCycleForecastOperatingProfit: z.number(),
      onePctSensitivity: z.array(z.object({
        period: z.string(),
        sensitivity: z.number(),
      })),
      assumptionSource: ProfitScenarioAssumptionSourceSchema,
    })),
    aggregate: z.object({
      totalPremium: z.number(),
      totalFullCycleForecastOperatingProfit: z.number(),
      weightedUltimateCombinedCostRatio: z.number(),
    }),
    warnings: z.array(z.string()),
    forbiddenInterpretations: z.array(z.string()),
  }),
});

export type SegmentDimension = z.infer<typeof SegmentDimensionSchema>;
export type ProfitSegmentScenario = z.infer<typeof ProfitSegmentScenarioSchema>;
export type ProfitSegmentRequest = z.infer<typeof ProfitSegmentRequestSchema>;
export type ProfitSegmentResponse = z.infer<typeof ProfitSegmentResponseSchema>;
