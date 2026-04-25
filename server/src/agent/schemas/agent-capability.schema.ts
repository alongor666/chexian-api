import { z } from 'zod';
import { AgentMetricSupportLevelSchema } from './agent-metric.schema.js';

export const AgentCapabilityDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  supportLevel: AgentMetricSupportLevelSchema,
  description: z.string().min(1),
  coreMetrics: z.array(z.string()),
  sourceEndpoints: z.array(z.string()),
  sourceTools: z.array(z.string()),
  allowedUseCases: z.array(z.string()),
  cautionNotes: z.array(z.string()),
  forbiddenOutputs: z.array(z.string()),
  replacementSuggestions: z.array(z.string()).optional(),
});

export type AgentCapabilityDefinition = z.infer<typeof AgentCapabilityDefinitionSchema>;
