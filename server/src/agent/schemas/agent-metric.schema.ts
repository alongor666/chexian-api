import { z } from 'zod';

export const AgentMetricSupportLevelSchema = z.enum([
  'supported',
  'caution',
  'unsupported',
  'deprecated',
]);

export const AgentMetricKindSchema = z.enum(['observed', 'forecast_output']);
export const AgentMetricNatureSchema = z.enum([
  'observed',
  'assumption',
  'scenario_derived',
  'forecast_output',
  'financial_actual',
]);
export const AgentMetricForecastRoleSchema = z.enum(['none', 'input', 'assumption', 'derived', 'output']);
export const AgentMetricFinancialInterpretationSchema = z.enum(['allowed', 'caution', 'forbidden']);

export const AgentMetricCategorySchema = z.enum([
  'premium',
  'growth',
  'claim',
  'expense',
  'cost',
  'renewal',
  'quote',
  'customer_flow',
  'repair',
  'plan',
  'performance',
  'risk',
  'sales_team',
]);

export const AgentMetricDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  category: AgentMetricCategorySchema,
  supportLevel: AgentMetricSupportLevelSchema,
  businessDefinition: z.string().min(1),
  formula: z.string().optional(),
  sourceMetrics: z.array(z.string()).optional(),
  sourceEndpoints: z.array(z.string()),
  sourceRoutes: z.array(z.string()),
  sourceSqlGenerators: z.array(z.string()).optional(),
  requiredParams: z.array(z.string()),
  supportedDimensions: z.array(z.string()),
  supportedUseCases: z.array(z.string()),
  cautionNotes: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  replacementSuggestions: z.array(z.string()).optional(),
  metricKind: AgentMetricKindSchema.optional(),
  metricNature: AgentMetricNatureSchema.optional(),
  forecastRole: AgentMetricForecastRoleSchema.optional(),
  requiresAssumptions: z.boolean().optional(),
  actualFinancialInterpretation: AgentMetricFinancialInterpretationSchema.optional(),
});

export type AgentMetricSupportLevel = z.infer<typeof AgentMetricSupportLevelSchema>;
export type AgentMetricKind = z.infer<typeof AgentMetricKindSchema>;
export type AgentMetricNature = z.infer<typeof AgentMetricNatureSchema>;
export type AgentMetricForecastRole = z.infer<typeof AgentMetricForecastRoleSchema>;
export type AgentMetricFinancialInterpretation = z.infer<typeof AgentMetricFinancialInterpretationSchema>;
export type AgentMetricCategory = z.infer<typeof AgentMetricCategorySchema>;
export type AgentMetricDefinition = z.infer<typeof AgentMetricDefinitionSchema>;
