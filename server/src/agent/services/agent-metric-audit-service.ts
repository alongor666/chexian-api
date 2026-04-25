import { agentMetricRegistry } from '../registry/agent-metric-registry.js';
import { AgentMetricAuditSchema, type AgentMetricAudit } from '../schemas/agent-audit.schema.js';
import type { AgentMetricSupportLevel } from '../schemas/agent-metric.schema.js';

function summarizeBySupportLevel<T extends { supportLevel: AgentMetricSupportLevel }>(
  items: readonly T[]
): AgentMetricAudit['summary'] {
  return {
    supported: items.filter((item) => item.supportLevel === 'supported').length,
    caution: items.filter((item) => item.supportLevel === 'caution').length,
    unsupported: items.filter((item) => item.supportLevel === 'unsupported').length,
    deprecated: items.filter((item) => item.supportLevel === 'deprecated').length,
  };
}

export function getAgentMetricAudit(): AgentMetricAudit {
  return AgentMetricAuditSchema.parse({
    summary: summarizeBySupportLevel(agentMetricRegistry),
    metrics: agentMetricRegistry,
  });
}
