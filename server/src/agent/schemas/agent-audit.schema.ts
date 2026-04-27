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

export const AgentReadinessStageStatusSchema = z.enum(['completed', 'blocked', 'pending']);
export const AgentReadinessStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: AgentReadinessStageStatusSchema,
  evidence: z.array(z.string()),
  blockers: z.array(z.string()).default([]),
});

export const AgentDiagnosisCapabilityReadinessSchema = z.object({
  capabilityId: z.string().min(1),
  endpoint: z.string().min(1),
  routeConstant: z.string().min(1),
  frontendRouteConstant: z.string().min(1),
  status: z.enum(['ready', 'caution', 'blocked']),
  httpIntegrationTest: z.string().min(1),
  routeContractTest: z.string().min(1),
  requiredWarnings: z.boolean(),
  requiredForbiddenInterpretations: z.boolean(),
});

export const AgentReadinessPrerequisiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  met: z.boolean(),
  evidence: z.array(z.string()),
  blocker: z.string().optional(),
});

export const AgentObservabilityAuditLogStatusSchema = z.enum([
  'observed',
  'missing_log',
  'no_recent_agent_calls',
  'not_production_evidence',
  'partial_window_sample',
  'error_rate_above_threshold',
]);

export const AgentObservabilityAuditLogSchema = z.object({
  status: AgentObservabilityAuditLogStatusSchema,
  auditLogConfigured: z.boolean(),
  exists: z.boolean(),
  productionEvidence: z.boolean(),
  windowComplete: z.boolean(),
  windowDays: z.number().int().positive(),
  logReadBytes: z.number().int().nonnegative(),
  logFileBytes: z.number().int().nonnegative(),
  logTruncated: z.boolean(),
  totalAgentDiagnosisCalls: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errorRate: z.number().nonnegative(),
  lastObservedAt: z.string().optional(),
  auditedPathPrefixes: z.array(z.string()),
});

export const AgentObservabilityEndpointCoverageSchema = z.object({
  capabilityId: z.string().min(1),
  endpoint: z.string().min(1),
  observedCallCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errorRate: z.number().nonnegative(),
  lastObservedAt: z.string().optional(),
  status: z.enum(['observed', 'missing_recent_call']),
});

export const AgentDisplayContractSchema = z.object({
  status: z.enum(['pending_caller_display_evidence', 'verified_by_caller_smoke_harness']),
  requiredFields: z.array(z.enum(['warnings', 'forbiddenInterpretations'])),
  verifiedByTests: z.array(z.string()),
  evidence: z.array(z.string()).default([]),
  blocker: z.string().optional(),
});

export const AgentObservabilityAuditSchema = z.object({
  phase: z.literal('agent_observability_readiness'),
  auditLog: AgentObservabilityAuditLogSchema,
  endpointCoverage: z.array(AgentObservabilityEndpointCoverageSchema),
  stage5Evidence: z.array(AgentReadinessPrerequisiteSchema),
  displayContract: AgentDisplayContractSchema,
  notes: z.array(z.string()),
});

export const AgentReadinessAuditSchema = z.object({
  phase: z.literal('agent_metric_adaptation_audit'),
  currentStage: z.enum(['stage_4_6_observability_ready', 'stage_4_8_display_contract_ready']),
  readyForLlm: z.literal(false),
  readyForChatWindow: z.literal(false),
  deterministicRouting: z.literal(true),
  usesExistingApisOnly: z.literal(true),
  llmSqlGenerationAllowed: z.literal(false),
  supportedCapabilityCount: z.number().int().nonnegative(),
  cautionCapabilityCount: z.number().int().nonnegative(),
  unsupportedMetricCount: z.number().int().nonnegative(),
  deterministicDiagnosisCapabilityCount: z.number().int().nonnegative(),
  completedStages: z.array(AgentReadinessStageSchema),
  blockedStages: z.array(AgentReadinessStageSchema),
  pendingStages: z.array(AgentReadinessStageSchema),
  deterministicDiagnosisCapabilities: z.array(AgentDiagnosisCapabilityReadinessSchema),
  stage5Prerequisites: z.array(AgentReadinessPrerequisiteSchema),
  llmReadinessBlockers: z.array(z.string()),
  observabilityEvidence: AgentObservabilityAuditSchema,
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
export type AgentReadinessStage = z.infer<typeof AgentReadinessStageSchema>;
export type AgentDiagnosisCapabilityReadiness = z.infer<typeof AgentDiagnosisCapabilityReadinessSchema>;
export type AgentReadinessPrerequisite = z.infer<typeof AgentReadinessPrerequisiteSchema>;
export type AgentObservabilityAudit = z.infer<typeof AgentObservabilityAuditSchema>;
export type AgentReadinessAudit = z.infer<typeof AgentReadinessAuditSchema>;
export type RouteQuestionInput = z.infer<typeof RouteQuestionInputSchema>;
export type RouteQuestionResult = z.infer<typeof RouteQuestionResultSchema>;
