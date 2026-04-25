import { agentDataCapabilityRegistry } from '../registry/agent-data-capability-registry.js';
import { unsupportedMetricRegistry } from '../registry/unsupported-metric-registry.js';
import {
  AgentCapabilityAuditSchema,
  AgentReadinessAuditSchema,
  UnsupportedMetricAuditSchema,
  type AgentCapabilityAudit,
  type AgentReadinessAudit,
  type UnsupportedMetricAudit,
} from '../schemas/agent-audit.schema.js';
import type { AgentMetricSupportLevel } from '../schemas/agent-metric.schema.js';

function summarizeBySupportLevel<T extends { supportLevel: AgentMetricSupportLevel }>(
  items: readonly T[]
): AgentCapabilityAudit['summary'] {
  return {
    supported: items.filter((item) => item.supportLevel === 'supported').length,
    caution: items.filter((item) => item.supportLevel === 'caution').length,
    unsupported: items.filter((item) => item.supportLevel === 'unsupported').length,
    deprecated: items.filter((item) => item.supportLevel === 'deprecated').length,
  };
}

export function getAgentCapabilityAudit(): AgentCapabilityAudit {
  return AgentCapabilityAuditSchema.parse({
    summary: summarizeBySupportLevel(agentDataCapabilityRegistry),
    capabilities: agentDataCapabilityRegistry,
  });
}

export function getUnsupportedMetricAudit(): UnsupportedMetricAudit {
  return UnsupportedMetricAuditSchema.parse({
    metrics: unsupportedMetricRegistry,
  });
}

export function getAgentReadinessAudit(): AgentReadinessAudit {
  const capabilitySummary = summarizeBySupportLevel(agentDataCapabilityRegistry);
  return AgentReadinessAuditSchema.parse({
    phase: 'agent_metric_adaptation_audit',
    readyForLlm: false,
    readyForChatWindow: false,
    deterministicRouting: true,
    usesExistingApisOnly: true,
    llmSqlGenerationAllowed: false,
    supportedCapabilityCount: capabilitySummary.supported,
    cautionCapabilityCount: capabilitySummary.caution,
    unsupportedMetricCount: unsupportedMetricRegistry.length,
    notes: [
      '第一阶段只做指标体系适配审计和确定性路由。',
      'Agent 层复用现有指标注册表、查询路由和 SQL 生成器，不新增自由查询能力。',
      '承保利润、利润率、边际贡献、财务盈亏、财务综合成本率保持 unsupported。',
    ],
  });
}
