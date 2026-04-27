import { agentDataCapabilityRegistry } from '../registry/agent-data-capability-registry.js';
import { agentMetricRegistry } from '../registry/agent-metric-registry.js';
import { unsupportedMetricRegistry } from '../registry/unsupported-metric-registry.js';
import { routeAgentQuestion } from './agent-question-router-service.js';
import {
  AgentDiagnosisExplanationRequestSchema,
  AgentDiagnosisExplanationResultSchema,
  type AgentDiagnosisExplanationRequest,
  type AgentDiagnosisExplanationResult,
} from '../schemas/agent-explanation.schema.js';
import {
  blockedFallbackText,
  inspectForSql,
  type LLMAdapter,
} from '../../skills/adapters/llm/index.js';
import { AppError } from '../../middleware/error.js';

export { AgentDiagnosisExplanationRequestSchema } from '../schemas/agent-explanation.schema.js';

export const AGENT_DIAGNOSIS_EXPLANATION_SYSTEM_PROMPT = `你是车险经营诊断解释助手，只能解释确定性 Agent 诊断 API 已返回的数据。

硬性边界：
1. 不生成 SQL，不输出表名、字段名、查询计划或底层错误。
2. 不自创指标、公式、维度或口径；只能引用输入中的 metric id 或 Agent 指标注册表中的指标。
3. 必须保留并遵守 warnings 与 forbiddenInterpretations。
4. 不输出承保利润、利润率、边际贡献、财务盈利、财务亏损或机构盈亏判断。
5. 不把变动成本率解释为完整财务综合成本率。
6. 输出 1 段中文解释，不使用 markdown 标题。`;

export interface ExplainDiagnosisOptions {
  provider: LLMAdapter;
}

function findCapability(capabilityId: string) {
  const capability = agentDataCapabilityRegistry.find((item) => item.id === capabilityId);
  if (!capability) {
    throw new AppError(400, `Unknown Agent capability: ${capabilityId}`);
  }
  return capability;
}

function replacementSuggestionsForCapability(capabilityId: string): string[] {
  const capability = agentDataCapabilityRegistry.find((item) => item.id === capabilityId);
  return capability?.replacementSuggestions ?? ['请改用已支持的确定性 Agent 诊断能力。'];
}

function collectReferencedMetricIds(input: AgentDiagnosisExplanationRequest, routedMetrics: string[]): string[] {
  const knownMetricIds = new Set(agentMetricRegistry.map((metric) => metric.id));
  const resultText = JSON.stringify(input.diagnosisResult);
  const ids = new Set<string>();

  for (const metric of agentMetricRegistry) {
    if (resultText.includes(metric.id)) ids.add(metric.id);
  }
  for (const metricId of routedMetrics) {
    if (knownMetricIds.has(metricId)) ids.add(metricId);
  }
  return Array.from(ids);
}

function buildEvidence(metricIds: string[]) {
  return metricIds.map((metricId) => ({
    metricId,
    source: 'diagnosisResult',
    note: '只引用确定性诊断返回的数据或 Agent 指标注册表边界。',
  }));
}

function buildUserContent(input: AgentDiagnosisExplanationRequest, referencedMetricIds: string[]): string {
  const unsupportedBoundaries = unsupportedMetricRegistry.map((metric) => ({
    id: metric.id,
    blockedTerms: metric.blockedTerms,
    reason: metric.reason,
  }));
  return JSON.stringify({
    sourceCapabilityId: input.sourceCapabilityId,
    userQuestion: input.userQuestion,
    referencedMetricIds,
    warnings: input.diagnosisResult.warnings,
    forbiddenInterpretations: input.diagnosisResult.forbiddenInterpretations,
    unsupportedBoundaries,
    diagnosisResult: input.diagnosisResult,
  }).slice(0, 12000);
}

function buildRefusedResult(
  input: AgentDiagnosisExplanationRequest,
  reason: string,
  replacementSuggestions: string[],
  source: 'routeAgentQuestion' | 'unsupportedMetricRegistry' | 'agentDataCapabilityRegistry' = 'routeAgentQuestion'
): AgentDiagnosisExplanationResult {
  return AgentDiagnosisExplanationResultSchema.parse({
    capabilityId: input.sourceCapabilityId,
    status: 'refused',
    summary: reason,
    referencedMetricIds: [],
    evidence: [],
    warnings: input.diagnosisResult.warnings,
    forbiddenInterpretations: input.diagnosisResult.forbiddenInterpretations,
    unsupportedRefusals: [{
      source,
      reason,
      replacementSuggestions,
    }],
    narrativeMeta: {
      provider: 'not-called',
      blockedBySqlGuard: false,
    },
  });
}

export async function explainDiagnosisResult(
  rawInput: AgentDiagnosisExplanationRequest,
  options: ExplainDiagnosisOptions
): Promise<AgentDiagnosisExplanationResult> {
  const input = AgentDiagnosisExplanationRequestSchema.parse(rawInput);
  const capability = findCapability(input.sourceCapabilityId);
  if (capability.supportLevel !== 'supported') {
    return buildRefusedResult(
      input,
      `${capability.name} 当前不是 supported Agent 诊断能力，解释层不会调用 LLM。`,
      replacementSuggestionsForCapability(capability.id),
      'agentDataCapabilityRegistry'
    );
  }

  const routed = input.userQuestion ? routeAgentQuestion({ question: input.userQuestion }) : undefined;
  if (routed?.blocked) {
    return buildRefusedResult(
      input,
      routed.reason ?? '当前问题不在 Agent 支持的解释范围内。',
      routed.replacementSuggestions
    );
  }

  const warnings = [...input.diagnosisResult.warnings, ...(routed?.warnings ?? [])];
  const referencedMetricIds = collectReferencedMetricIds(input, routed?.recommendedMetrics ?? []);
  const userContent = buildUserContent(
    {
      ...input,
      diagnosisResult: {
        ...input.diagnosisResult,
        warnings,
      },
    },
    referencedMetricIds
  );

  const narrative = await options.provider.generateNarrative({
    systemPrompt: AGENT_DIAGNOSIS_EXPLANATION_SYSTEM_PROMPT,
    userContent,
    temperature: 0.2,
    maxTokens: 500,
  }).catch(() => undefined);
  if (!narrative) {
    return AgentDiagnosisExplanationResultSchema.parse({
      capabilityId: input.sourceCapabilityId,
      status: 'explained',
      summary: '解释生成暂不可用，请直接参考确定性诊断结果、warnings 和 forbiddenInterpretations。',
      referencedMetricIds,
      evidence: buildEvidence(referencedMetricIds),
      warnings,
      forbiddenInterpretations: input.diagnosisResult.forbiddenInterpretations,
      unsupportedRefusals: [],
      narrativeMeta: {
        provider: options.provider.provider,
        blockedBySqlGuard: false,
        error: 'provider_error',
      },
    });
  }
  const guard = inspectForSql(narrative.text);
  const blockedBySqlGuard = narrative.blockedBySqlGuard || guard.blocked;
  const summary = blockedBySqlGuard
    ? blockedFallbackText(guard.matchedKeyword ?? 'unknown')
    : narrative.text;

  return AgentDiagnosisExplanationResultSchema.parse({
    capabilityId: input.sourceCapabilityId,
    status: 'explained',
    summary,
    referencedMetricIds,
    evidence: buildEvidence(referencedMetricIds),
    warnings,
    forbiddenInterpretations: input.diagnosisResult.forbiddenInterpretations,
    unsupportedRefusals: [],
    narrativeMeta: {
      provider: options.provider.provider,
      model: narrative.model,
      blockedBySqlGuard,
      tokens: narrative.tokens,
    },
  });
}
