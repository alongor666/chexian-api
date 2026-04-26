import {
  BusinessPatrolDiagnosisResultSchema,
  type BusinessPatrolCapabilityId,
  type BusinessPatrolDiagnosisResult,
  type BusinessPatrolSeverity,
  type BusinessPatrolSubdiagnosisStatus,
} from '../schemas/agent-diagnosis.schema.js';

export const BUSINESS_PATROL_CAPABILITY_IDS = [
  'growth_diagnosis',
  'cost_indicator_diagnosis',
  'quote_conversion_diagnosis',
  'renewal_tracker_diagnosis',
  'claims_risk_diagnosis',
  'customer_flow_diagnosis',
] as const;

const BASE_FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损', '边际贡献'];

const CAPABILITY_METRICS: Record<BusinessPatrolCapabilityId, string[]> = {
  growth_diagnosis: ['signed_premium', 'policy_count', 'growth_rate'],
  cost_indicator_diagnosis: ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'],
  quote_conversion_diagnosis: ['quote_conversion_rate'],
  renewal_tracker_diagnosis: ['renewal_tracker_metrics'],
  claims_risk_diagnosis: ['reported_claims', 'claim_cases', 'avg_claim_amount', 'earned_loss_frequency'],
  customer_flow_diagnosis: ['customer_inflow', 'customer_outflow', 'customer_flow_trend'],
};

export interface BusinessPatrolTask {
  capabilityId: BusinessPatrolCapabilityId;
  run: () => Promise<unknown>;
}

export interface RunBusinessPatrolTasksOptions {
  timeoutMs: number;
  limit: number;
}

type CompletedSubdiagnosis = {
  capabilityId: BusinessPatrolCapabilityId;
  status: 'completed';
  durationMs: number;
  result: unknown;
};

type NonCompletedSubdiagnosis = {
  capabilityId: BusinessPatrolCapabilityId;
  status: Exclude<BusinessPatrolSubdiagnosisStatus, 'completed'>;
  durationMs: number;
  error: string;
};

type SubdiagnosisOutcome = CompletedSubdiagnosis | NonCompletedSubdiagnosis;

interface FindingDraft {
  capabilityId: BusinessPatrolCapabilityId;
  severity: BusinessPatrolSeverity;
  affectedMetrics: string[];
  message: string;
  recommendedDrilldown: string[];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeSeverity(value: unknown): BusinessPatrolSeverity {
  if (value === 'critical' || value === 'critical_decline') return 'critical';
  if (value === 'warning' || value === 'warning_decline') return 'warning';
  if (value === 'observe' || value === 'observe_decline' || value === 'high_growth') return 'observe';
  return 'normal';
}

function severityWeight(severity: BusinessPatrolSeverity): number {
  if (severity === 'critical') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'observe') return 1;
  return 0;
}

function messageForFinding(capabilityId: BusinessPatrolCapabilityId, row: Record<string, unknown>): string {
  const dimKey = getString(row.dimKey ?? row.dimName ?? row.accidentCause ?? row.period ?? row.month, '整体');
  switch (capabilityId) {
    case 'cost_indicator_diagnosis':
      return `${dimKey} 成本指标异常，建议下钻变动成本率、赔付率和费用率。`;
    case 'growth_diagnosis':
      return `${dimKey} 增长表现异常，建议下钻增长归因。`;
    case 'quote_conversion_diagnosis':
      return `${dimKey} 报价转化存在卡点或趋势异常。`;
    case 'renewal_tracker_diagnosis':
      return `${dimKey} 续保追踪弱项需要关注。`;
    case 'claims_risk_diagnosis':
      return `${dimKey} 赔案风险指标需要关注。`;
    case 'customer_flow_diagnosis':
      return getString(row.message, `${dimKey} 客户流向异常。`);
  }
}

function drilldownFor(capabilityId: BusinessPatrolCapabilityId, row: Record<string, unknown>, result: Record<string, unknown>): string[] {
  const rowSuggestions = getStringArray(row.drilldownSuggestions);
  if (rowSuggestions.length > 0) return rowSuggestions;
  const resultSuggestions = getStringArray(result.drilldownSuggestions);
  if (resultSuggestions.length > 0) return resultSuggestions;
  return [capabilityId];
}

function finding(capabilityId: BusinessPatrolCapabilityId, row: Record<string, unknown>, result: Record<string, unknown>): FindingDraft | null {
  const severity = normalizeSeverity(row.severity);
  if (severity === 'normal') return null;
  return {
    capabilityId,
    severity,
    affectedMetrics: CAPABILITY_METRICS[capabilityId],
    message: messageForFinding(capabilityId, row),
    recommendedDrilldown: drilldownFor(capabilityId, row, result),
  };
}

function extractFindings(outcome: CompletedSubdiagnosis): FindingDraft[] {
  const result = asRecord(outcome.result);
  switch (outcome.capabilityId) {
    case 'cost_indicator_diagnosis':
      return asArray(result.anomalies).map((row) => finding(outcome.capabilityId, row, result)).filter(Boolean) as FindingDraft[];
    case 'growth_diagnosis':
      return asArray(result.diagnostics).map((row) => finding(outcome.capabilityId, row, result)).filter(Boolean) as FindingDraft[];
    case 'quote_conversion_diagnosis':
      return [
        ...asArray(result.funnelBottlenecks),
        ...asArray(result.segmentDifferences),
        ...asArray(result.trendAnomalies),
      ].map((row) => finding(outcome.capabilityId, row, result)).filter(Boolean) as FindingDraft[];
    case 'renewal_tracker_diagnosis':
      return [
        ...asArray(result.segmentDiagnostics),
        ...asArray(result.dimensionDiagnostics),
      ].map((row) => finding(outcome.capabilityId, row, result)).filter(Boolean) as FindingDraft[];
    case 'claims_risk_diagnosis':
      return [
        asRecord(result.pendingRisk),
        ...asArray(result.causeDiagnostics),
        ...asArray(result.frequencyDiagnostics),
      ].map((row) => finding(outcome.capabilityId, row, result)).filter(Boolean) as FindingDraft[];
    case 'customer_flow_diagnosis':
      return asArray(result.diagnostics).map((row) => finding(outcome.capabilityId, row, result)).filter(Boolean) as FindingDraft[];
  }
}

function extractWarnings(outcome: SubdiagnosisOutcome): string[] {
  if (outcome.status !== 'completed') {
    return [formatSubdiagnosisFailure(outcome)];
  }
  return getStringArray(asRecord(outcome.result).warnings);
}

function formatSubdiagnosisFailure(outcome: NonCompletedSubdiagnosis): string {
  const label = outcome.status === 'timeout' ? '超时' : '失败';
  return `${outcome.capabilityId} 子诊断${label}，已降级为部分巡检结果。`;
}

function extractForbidden(outcome: SubdiagnosisOutcome): string[] {
  if (outcome.status !== 'completed') return [];
  return getStringArray(asRecord(outcome.result).forbiddenInterpretations);
}

async function runOneTask(task: BusinessPatrolTask, timeoutMs: number): Promise<SubdiagnosisOutcome> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      task.run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { capabilityId: task.capabilityId, status: 'completed', durationMs: Date.now() - started, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('timed out') ? 'timeout' : 'failed';
    return { capabilityId: task.capabilityId, status, durationMs: Date.now() - started, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBusinessPatrolTasks(
  tasks: BusinessPatrolTask[],
  options: RunBusinessPatrolTasksOptions
): Promise<BusinessPatrolDiagnosisResult> {
  const outcomes = await Promise.all(tasks.map((task) => runOneTask(task, options.timeoutMs)));
  const findings = outcomes
    .filter((outcome): outcome is CompletedSubdiagnosis => outcome.status === 'completed')
    .flatMap(extractFindings)
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
    .slice(0, options.limit)
    .map((item, index) => ({ rank: index + 1, ...item }));

  const failedCount = outcomes.filter((outcome) => outcome.status === 'failed').length;
  const timeoutCount = outcomes.filter((outcome) => outcome.status === 'timeout').length;
  const completedCount = outcomes.filter((outcome) => outcome.status === 'completed').length;
  const warnings = uniqueStrings(outcomes.flatMap(extractWarnings));
  const forbiddenInterpretations = uniqueStrings([
    ...BASE_FORBIDDEN_INTERPRETATIONS,
    ...outcomes.flatMap(extractForbidden),
  ]);

  return BusinessPatrolDiagnosisResultSchema.parse({
    capabilityId: 'business_patrol_diagnosis',
    status: failedCount > 0 || timeoutCount > 0 ? 'partial' : 'supported',
    requestedCapabilities: tasks.map((task) => task.capabilityId),
    timeoutMs: options.timeoutMs,
    summary: {
      totalCapabilities: outcomes.length,
      completedCount,
      failedCount,
      timeoutCount,
      prioritizedFindingCount: findings.length,
      criticalCount: findings.filter((item) => item.severity === 'critical').length,
      warningCount: findings.filter((item) => item.severity === 'warning').length,
      topPriorityCapability: findings[0]?.capabilityId ?? null,
    },
    capabilityStatuses: outcomes.map((outcome) => ({
      capabilityId: outcome.capabilityId,
      status: outcome.status,
      durationMs: outcome.durationMs,
      error: outcome.status === 'completed' ? undefined : formatSubdiagnosisFailure(outcome),
    })),
    prioritizedFindings: findings,
    warnings,
    forbiddenInterpretations,
    drilldownSuggestions: uniqueStrings(findings.flatMap((item) => item.recommendedDrilldown)),
  });
}
