import { agentMetricRegistry, agentMetricRegistryMeta } from '../registry/agent-metric-registry.js';
import {
  agentForecastOutputRegistry,
  agentForecastOutputRegistryMeta,
} from '../registry/agent-forecast-output-registry.js';
import { AgentMetricAuditSchema, type AgentMetricAudit } from '../schemas/agent-audit.schema.js';
import { toRegistryVersion } from '../schemas/agent-registry-meta.schema.js';
import type { AgentMetricDefinition, AgentMetricSupportLevel } from '../schemas/agent-metric.schema.js';

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
  const observed = withAuditDefaults(agentMetricRegistry);
  const forecastOutputs = withAuditDefaults(agentForecastOutputRegistry);
  return AgentMetricAuditSchema.parse({
    summary: summarizeBySupportLevel(observed),
    metrics: observed,
    observed,
    forecastOutputs,
    registryVersions: [
      toRegistryVersion(agentMetricRegistryMeta, agentMetricRegistry.length),
      toRegistryVersion(agentForecastOutputRegistryMeta, agentForecastOutputRegistry.length),
    ],
  });
}

function withAuditDefaults(metrics: readonly AgentMetricDefinition[]): AgentMetricDefinition[] {
  return metrics.map((metric) => ({
    metricKind: 'observed',
    metricNature: 'observed',
    forecastRole: 'none',
    requiresAssumptions: false,
    actualFinancialInterpretation: 'forbidden',
    ...metric,
  }));
}
