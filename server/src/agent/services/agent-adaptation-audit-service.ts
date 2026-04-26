import { agentDataCapabilityRegistry } from '../registry/agent-data-capability-registry.js';
import { unsupportedMetricRegistry } from '../registry/unsupported-metric-registry.js';
import {
  AgentCapabilityAuditSchema,
  AgentReadinessAuditSchema,
  UnsupportedMetricAuditSchema,
  type AgentCapabilityAudit,
  type AgentDiagnosisCapabilityReadiness,
  type AgentReadinessAudit,
  type AgentReadinessPrerequisite,
  type AgentReadinessStage,
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

const deterministicDiagnosisCapabilities: AgentDiagnosisCapabilityReadiness[] = [
  {
    capabilityId: 'cost_indicator_diagnosis',
    endpoint: '/api/agent/diagnosis/cost-indicators',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.COST_INDICATORS',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.COST_INDICATORS',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-cost-indicator-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-cost-indicator-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
  {
    capabilityId: 'growth_diagnosis',
    endpoint: '/api/agent/diagnosis/growth',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.GROWTH',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.GROWTH',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-growth-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-growth-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
  {
    capabilityId: 'quote_conversion_diagnosis',
    endpoint: '/api/agent/diagnosis/quote-conversion',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.QUOTE_CONVERSION',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.QUOTE_CONVERSION',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-quote-conversion-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-quote-conversion-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
  {
    capabilityId: 'renewal_tracker_diagnosis',
    endpoint: '/api/agent/diagnosis/renewal-tracker',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.RENEWAL_TRACKER',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.RENEWAL_TRACKER',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-renewal-tracker-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-renewal-tracker-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
  {
    capabilityId: 'claims_risk_diagnosis',
    endpoint: '/api/agent/diagnosis/claims-risk',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.CLAIMS_RISK',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.CLAIMS_RISK',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-claims-risk-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-claims-risk-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
  {
    capabilityId: 'customer_flow_diagnosis',
    endpoint: '/api/agent/diagnosis/customer-flow',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.CUSTOMER_FLOW',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.CUSTOMER_FLOW',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-customer-flow-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-customer-flow-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
  {
    capabilityId: 'business_patrol_diagnosis',
    endpoint: '/api/agent/diagnosis/business-patrol',
    routeConstant: 'AGENT_DIAGNOSIS_ROUTES.BUSINESS_PATROL',
    frontendRouteConstant: 'AGENT_DIAGNOSIS_ROUTES.BUSINESS_PATROL',
    status: 'ready',
    httpIntegrationTest: 'tests/api/agent-business-patrol-diagnosis.test.ts',
    routeContractTest: 'tests/api/agent-business-patrol-diagnosis.route-contract.test.ts',
    requiredWarnings: true,
    requiredForbiddenInterpretations: true,
  },
];

const stageReadiness: AgentReadinessStage[] = [
  {
    id: 'stage_1_metric_adaptation_audit',
    name: 'Agent 指标体系适配审计',
    status: 'completed',
    evidence: [
      '/api/agent/audit/metrics',
      '/api/agent/audit/capabilities',
      '/api/agent/audit/unsupported',
      '/api/agent/audit/readiness',
      '/api/agent/audit/route-question',
    ],
    blockers: [],
  },
  {
    id: 'phase_0a_metric_registry_consistency',
    name: '指标注册表一致性修复',
    status: 'completed',
    evidence: [
      '利润/边际类指标在 Agent 层为 unsupported。',
      '综合/固定成本类指标在 Agent 层为 caution。',
      '变动成本率保持 supported。',
    ],
    blockers: [],
  },
  {
    id: 'stage_2_cost_indicator_diagnosis',
    name: '成本指标确定性诊断',
    status: 'completed',
    evidence: ['/api/agent/diagnosis/cost-indicators'],
    blockers: [],
  },
  {
    id: 'stage_3_deterministic_diagnoses',
    name: '五类确定性经营诊断',
    status: 'completed',
    evidence: [
      '/api/agent/diagnosis/growth',
      '/api/agent/diagnosis/quote-conversion',
      '/api/agent/diagnosis/renewal-tracker',
      '/api/agent/diagnosis/claims-risk',
      '/api/agent/diagnosis/customer-flow',
    ],
    blockers: [],
  },
  {
    id: 'stage_4_business_patrol',
    name: '经营巡检聚合能力',
    status: 'completed',
    evidence: ['/api/agent/diagnosis/business-patrol'],
    blockers: [],
  },
  {
    id: 'stage_5_llm_interpretation',
    name: 'LLM 解释层',
    status: 'blocked',
    evidence: ['必须等待确定性接口生产运行证据。'],
    blockers: [
      '缺少生产 audit log 对 /api/agent/diagnosis/* 调用记录的验收证据。',
      '缺少最近 30 天 /api/agent/diagnosis/* error rate < 1% 的验收证据。',
      '缺少前端或调用方已展示 warnings 与 forbiddenInterpretations 的验收证据。',
    ],
  },
  {
    id: 'stage_6_operations_workbench',
    name: '经营工作台与反馈复盘',
    status: 'pending',
    evidence: ['应在 Stage 5 前置条件明确后再进入前端工作台。'],
    blockers: [],
  },
];

const stage5Prerequisites: AgentReadinessPrerequisite[] = [
  {
    id: 'deterministic_apis_merged',
    name: 'Stage 1-4 确定性 API 已合并',
    met: true,
    evidence: deterministicDiagnosisCapabilities.map((item) => item.endpoint),
  },
  {
    id: 'http_and_contract_tests',
    name: '每个诊断 API 均有 HTTP 集成测试和 route contract 测试',
    met: true,
    evidence: deterministicDiagnosisCapabilities.flatMap((item) => [item.httpIntegrationTest, item.routeContractTest]),
  },
  {
    id: 'production_audit_log_observed',
    name: '生产 audit log 能看到 /api/agent/diagnosis/* 调用记录',
    met: false,
    evidence: [],
    blocker: '缺少生产 audit log 对 /api/agent/diagnosis/* 调用记录的验收证据。',
  },
  {
    id: 'thirty_day_error_rate_under_threshold',
    name: '最近 30 天 /api/agent/diagnosis/* error rate < 1%',
    met: false,
    evidence: [],
    blocker: '缺少最近 30 天 /api/agent/diagnosis/* error rate < 1% 的验收证据。',
  },
  {
    id: 'warnings_and_forbidden_interpretations_displayed',
    name: '前端或调用方展示 warnings 与 forbiddenInterpretations',
    met: false,
    evidence: [],
    blocker: '缺少前端或调用方已展示 warnings 与 forbiddenInterpretations 的验收证据。',
  },
];

export function getAgentReadinessAudit(): AgentReadinessAudit {
  const capabilitySummary = summarizeBySupportLevel(agentDataCapabilityRegistry);
  const completedStages = stageReadiness.filter((stage) => stage.status === 'completed');
  const blockedStages = stageReadiness.filter((stage) => stage.status === 'blocked');
  const pendingStages = stageReadiness.filter((stage) => stage.status === 'pending');
  const llmReadinessBlockers = stage5Prerequisites
    .filter((item) => !item.met && item.blocker)
    .map((item) => item.blocker!);

  return AgentReadinessAuditSchema.parse({
    phase: 'agent_metric_adaptation_audit',
    currentStage: 'stage_4_business_patrol_ready',
    readyForLlm: false,
    readyForChatWindow: false,
    deterministicRouting: true,
    usesExistingApisOnly: true,
    llmSqlGenerationAllowed: false,
    supportedCapabilityCount: capabilitySummary.supported,
    cautionCapabilityCount: capabilitySummary.caution,
    unsupportedMetricCount: unsupportedMetricRegistry.length,
    deterministicDiagnosisCapabilityCount: deterministicDiagnosisCapabilities.length,
    completedStages,
    blockedStages,
    pendingStages,
    deterministicDiagnosisCapabilities,
    stage5Prerequisites,
    llmReadinessBlockers,
    notes: [
      'Stage 1-4 已完成：指标审计、注册表一致性、成本指标诊断、五类确定性诊断和经营巡检聚合。',
      'Agent 层复用现有指标注册表、查询路由和 SQL 生成器，不新增自由查询能力。',
      '承保利润、利润率、边际贡献、财务盈亏、财务综合成本率保持 unsupported。',
      'Stage 5 LLM 解释层仍被生产 audit log、30 天错误率和 warnings/forbiddenInterpretations 展示证据阻塞。',
    ],
  });
}
