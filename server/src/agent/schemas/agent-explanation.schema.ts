import { z } from 'zod';

export const AgentDiagnosisExplanationStatusSchema = z.enum(['explained', 'refused']);

export const AgentDiagnosisExplanationInputResultSchema = z.object({
  capabilityId: z.string().min(1),
  status: z.string().min(1),
  requestedTools: z.array(z.string()).default([]),
  summary: z.unknown(),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
}).passthrough();

export const AgentDiagnosisExplanationRequestSchema = z.object({
  sourceCapabilityId: z.string().min(1),
  userQuestion: z.string().min(1).max(500).optional(),
  diagnosisResult: AgentDiagnosisExplanationInputResultSchema,
});

export const AgentDiagnosisExplanationEvidenceSchema = z.object({
  metricId: z.string().min(1),
  source: z.string().min(1),
  note: z.string().min(1),
});

export const AgentDiagnosisExplanationRefusalSchema = z.object({
  source: z.enum(['routeAgentQuestion', 'unsupportedMetricRegistry']),
  reason: z.string().min(1),
  replacementSuggestions: z.array(z.string()).default([]),
});

export const AgentDiagnosisExplanationMetaSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  blockedBySqlGuard: z.boolean(),
  tokens: z.object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).optional(),
  error: z.string().optional(),
});

export const AgentDiagnosisExplanationResultSchema = z.object({
  capabilityId: z.string().min(1),
  status: AgentDiagnosisExplanationStatusSchema,
  summary: z.string(),
  referencedMetricIds: z.array(z.string()),
  evidence: z.array(AgentDiagnosisExplanationEvidenceSchema),
  warnings: z.array(z.string()),
  forbiddenInterpretations: z.array(z.string()),
  unsupportedRefusals: z.array(AgentDiagnosisExplanationRefusalSchema),
  narrativeMeta: AgentDiagnosisExplanationMetaSchema,
});

export type AgentDiagnosisExplanationRequest = z.infer<typeof AgentDiagnosisExplanationRequestSchema>;
export type AgentDiagnosisExplanationResult = z.infer<typeof AgentDiagnosisExplanationResultSchema>;
