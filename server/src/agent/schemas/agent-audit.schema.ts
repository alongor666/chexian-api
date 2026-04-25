import { z } from 'zod';
import { AgentMetricDefinitionSchema } from './agent-metric.schema.js';
import { AgentCapabilityDefinitionSchema } from './agent-capability.schema.js';

export const UnsupportedMetricDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  blockedTerms: z.array(z.string()),
  reason: z.string().min(1),
  replacementSuggestion: z.string().min(1),
});

export const AgentMetricAuditSchema = z.object({
  summary: z.object({
    supported: z.number().int().nonnegative(),
    caution: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    deprecated: z.number().int().nonnegative(),
  }),
  metrics: z.array(AgentMetricDefinitionSchema),
});

export const AgentCapabilityAuditSchema = z.object({
  summary: z.object({
    supported: z.number().int().nonnegative(),
    caution: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    deprecated: z.number().int().nonnegative(),
  }),
  capabilities: z.array(AgentCapabilityDefinitionSchema),
});

export const UnsupportedMetricAuditSchema = z.object({
  metrics: z.array(UnsupportedMetricDefinitionSchema),
});

export const AgentReadinessAuditSchema = z.object({
  phase: z.literal('agent_metric_adaptation_audit'),
  readyForLlm: z.literal(false),
  readyForChatWindow: z.literal(false),
  deterministicRouting: z.literal(true),
  usesExistingApisOnly: z.literal(true),
  llmSqlGenerationAllowed: z.literal(false),
  supportedCapabilityCount: z.number().int().nonnegative(),
  cautionCapabilityCount: z.number().int().nonnegative(),
  unsupportedMetricCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});

export const RouteQuestionInputSchema = z.object({
  question: z.string().min(1).max(500),
});

export const RouteQuestionResultSchema = z.object({
  blocked: z.boolean(),
  status: z.enum(['supported', 'caution', 'unsupported', 'deprecated']),
  matchedCapabilityId: z.string().optional(),
  recommendedMetrics: z.array(z.string()).default([]),
  recommendedTools: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  reason: z.string().optional(),
  replacementSuggestions: z.array(z.string()).default([]),
});

export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export type UnsupportedMetricDefinition = z.infer<typeof UnsupportedMetricDefinitionSchema>;
export type AgentMetricAudit = z.infer<typeof AgentMetricAuditSchema>;
export type AgentCapabilityAudit = z.infer<typeof AgentCapabilityAuditSchema>;
export type UnsupportedMetricAudit = z.infer<typeof UnsupportedMetricAuditSchema>;
export type AgentReadinessAudit = z.infer<typeof AgentReadinessAuditSchema>;
export type RouteQuestionInput = z.infer<typeof RouteQuestionInputSchema>;
export type RouteQuestionResult = z.infer<typeof RouteQuestionResultSchema>;
