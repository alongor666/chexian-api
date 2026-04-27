import { agentDataCapabilityRegistry } from '../registry/agent-data-capability-registry.js';
import { unsupportedMetricRegistry } from '../registry/unsupported-metric-registry.js';
import {
  AgentCapabilityAuditSchema,
  AgentObservabilityAuditSchema,
  AgentReadinessAuditSchema,
  UnsupportedMetricAuditSchema,
  type AgentCapabilityAudit,
  type AgentDiagnosisCapabilityReadiness,
  type AgentObservabilityAudit,
  type AgentReadinessAudit,
  type AgentReadinessPrerequisite,
  type AgentReadinessStage,
  type UnsupportedMetricAudit,
} from '../schemas/agent-audit.schema.js';
import type { AgentMetricSupportLevel } from '../schemas/agent-metric.schema.js';
import { AUDITED_PATHS, getAuditLogPath } from '../../middleware/audit.js';
import { open, readdir, readFile, stat } from 'fs/promises';
import path from 'path';

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
    id: 'stage_4_6_observability_readiness',
    name: '生产观测与验收证据闭环',
    status: 'completed',
    evidence: [
      '/api/agent/audit/observability',
      '审计日志可统计 /api/agent/diagnosis/* 最近 30 天调用与错误率。',
      'readiness 暴露 Stage 5 前置证据状态。',
    ],
    blockers: [],
  },
  // stage_4_8_caller_display_evidence 由 buildStageReadiness() 动态注入：
  // 必须由真实 smoke 报告派生，不能像 PR 之前那样硬编码 status='completed'。
  {
    id: 'stage_5_llm_interpretation',
    name: 'LLM 解释层',
    status: 'blocked',
    evidence: ['必须等待确定性接口生产运行证据，并由单独 Stage 5 PR 显式启动。'],
    blockers: [
      '缺少生产 audit log 对 /api/agent/diagnosis/* 调用记录的验收证据。',
      '缺少最近 30 天 /api/agent/diagnosis/* error rate < 1% 的验收证据。',
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

const displayContractTests = [
  'tests/api/agent-cost-indicator-diagnosis.test.ts',
  'tests/api/agent-growth-diagnosis.test.ts',
  'tests/api/agent-quote-conversion-diagnosis.test.ts',
  'tests/api/agent-renewal-tracker-diagnosis.test.ts',
  'tests/api/agent-claims-risk-diagnosis.test.ts',
  'tests/api/agent-customer-flow-diagnosis.test.ts',
  'tests/api/agent-business-patrol-diagnosis.test.ts',
];

const callerDisplayEvidence = [
  'scripts/verify-agent-production-smoke.mjs',
  'tests/api/agent-production-smoke-harness.test.mjs',
];

export interface AgentObservabilityAuditOptions {
  auditLogPath?: string;
  now?: Date;
  nodeEnv?: string;
  windowDays?: number;
  maxReadBytes?: number;
  /** 调用方 smoke harness 报告目录（默认 output/agent-smoke）。测试可注入临时目录。 */
  smokeReportDir?: string;
  /** smoke 报告最大有效期（天，默认 30）。超期视为缺失证据。 */
  smokeReportMaxAgeDays?: number;
  /** smoke 报告单文件最大读取字节数（默认 1MB），防御异常大的 JSON */
  smokeReportMaxBytes?: number;
}

const DEFAULT_AUDIT_LOG_MAX_READ_BYTES = 5 * 1024 * 1024;
const DEFAULT_SMOKE_REPORT_DIR = 'output/agent-smoke';
const DEFAULT_SMOKE_REPORT_MAX_AGE_DAYS = 30;
const DEFAULT_SMOKE_REPORT_MAX_BYTES = 1 * 1024 * 1024;

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseAuditLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizePath(value: unknown): string {
  return typeof value === 'string' ? value.split('?')[0] : '';
}

function statusToNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundRate(value: number): number {
  return Number(value.toFixed(6));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

// ─────────────────────────────────────────────────────────────────────
// Caller display smoke report evidence
//
// 实现原则（codex P1 修复）：displayContract.status 必须从真实 smoke
// 报告派生，而不是硬编码。getAgentObservabilityAudit 在每次调用时扫描
// output/agent-smoke/ 目录中最新的报告，校验 evaluation.ok === true 且
// summary.callerDisplayContractVerified === true 且 startedAt 落在窗口内，
// 才允许将 status 标记为 verified_by_caller_smoke_harness。
// ─────────────────────────────────────────────────────────────────────

interface SmokeReportEvidence {
  reportPath: string;
  startedAt: string;
  ageMs: number;
  ok: boolean;
  callerDisplayContractVerified: boolean;
  /** 当 ok 或 callerDisplayContractVerified 为 false 时的具体原因 */
  failureReason?: string;
}

interface SmokeReportLookupResult {
  /** 最新的有效证据；不存在或过期则为 null */
  latest: SmokeReportEvidence | null;
  /** 扫描过的合法 JSON 报告数（含失败、过期） */
  reportsScanned: number;
  /** 扫描过的最新的「不合格」报告（用于诊断 blocker） */
  latestStaleOrFailed: SmokeReportEvidence | null;
}

async function readLatestSmokeReport(
  smokeReportDir: string,
  now: Date,
  maxAgeDays: number,
  maxBytes: number,
): Promise<SmokeReportLookupResult> {
  const empty: SmokeReportLookupResult = { latest: null, reportsScanned: 0, latestStaleOrFailed: null };
  const maxAgeMs = Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await readdir(smokeReportDir);
  } catch (error) {
    if (isMissingFileError(error)) return empty;
    throw error;
  }

  const candidates = entries.filter((f) => f.endsWith('.json'));
  if (candidates.length === 0) return empty;

  let latestValid: SmokeReportEvidence | null = null;
  let latestStaleOrFailed: SmokeReportEvidence | null = null;
  let scanned = 0;

  for (const file of candidates) {
    const fullPath = path.resolve(smokeReportDir, file);

    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch (err) {
      if (isMissingFileError(err)) continue;
      throw err;
    }
    if (!fileStat.isFile()) continue;
    if (fileStat.size > maxBytes) continue;

    let raw: string;
    try {
      raw = await readFile(fullPath, 'utf-8');
    } catch (err) {
      if (isMissingFileError(err)) continue;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const report = parsed as Record<string, unknown>;
    if (report.phase !== 'agent_production_smoke_harness') continue;

    const startedAt = parseTimestamp(report.startedAt);
    if (!startedAt) continue;

    const evaluation = report.evaluation && typeof report.evaluation === 'object' && !Array.isArray(report.evaluation)
      ? (report.evaluation as Record<string, unknown>)
      : null;
    if (!evaluation) continue;

    const summary = evaluation.summary && typeof evaluation.summary === 'object' && !Array.isArray(evaluation.summary)
      ? (evaluation.summary as Record<string, unknown>)
      : null;

    const ok = evaluation.ok === true;
    const callerDisplayContractVerified = summary?.callerDisplayContractVerified === true;
    const ageMs = now.getTime() - startedAt.getTime();
    const expired = ageMs > maxAgeMs;

    let failureReason: string | undefined;
    if (!ok) failureReason = 'evaluation.ok=false';
    else if (!callerDisplayContractVerified) failureReason = 'summary.callerDisplayContractVerified=false';
    else if (expired) failureReason = `report age ${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d > ${maxAgeDays}d`;

    const evidence: SmokeReportEvidence = {
      reportPath: fullPath,
      startedAt: startedAt.toISOString(),
      ageMs,
      ok,
      callerDisplayContractVerified,
      failureReason,
    };
    scanned += 1;

    if (failureReason === undefined) {
      if (!latestValid || startedAt.getTime() > new Date(latestValid.startedAt).getTime()) {
        latestValid = evidence;
      }
    } else {
      if (!latestStaleOrFailed || startedAt.getTime() > new Date(latestStaleOrFailed.startedAt).getTime()) {
        latestStaleOrFailed = evidence;
      }
    }
  }

  return { latest: latestValid, reportsScanned: scanned, latestStaleOrFailed };
}

interface AuditLogTailReadResult {
  exists: boolean;
  lines: string[];
  truncated: boolean;
  bytesRead: number;
  fileSizeBytes: number;
}

async function readAuditLogTail(auditLogPath: string, maxReadBytes: number): Promise<AuditLogTailReadResult> {
  const boundedMaxReadBytes = Math.max(1, Math.floor(maxReadBytes));

  try {
    const fileStat = await stat(auditLogPath);
    const fileSizeBytes = fileStat.size;
    if (fileSizeBytes === 0) {
      return { exists: true, lines: [], truncated: false, bytesRead: 0, fileSizeBytes };
    }

    if (fileSizeBytes <= boundedMaxReadBytes) {
      const content = await readFile(auditLogPath, 'utf-8');
      return {
        exists: true,
        lines: content.split('\n').filter(Boolean),
        truncated: false,
        bytesRead: Buffer.byteLength(content),
        fileSizeBytes,
      };
    }

    const bytesToRead = boundedMaxReadBytes;
    const start = fileSizeBytes - bytesToRead;
    const buffer = Buffer.alloc(bytesToRead);
    const fileHandle = await open(auditLogPath, 'r');

    try {
      const result = await fileHandle.read(buffer, 0, bytesToRead, start);
      const content = buffer.subarray(0, result.bytesRead).toString('utf-8');
      const lines = content.split('\n');
      const completeLines = start > 0 ? lines.slice(1) : lines;

      return {
        exists: true,
        lines: completeLines.filter(Boolean),
        truncated: start > 0,
        bytesRead: result.bytesRead,
        fileSizeBytes,
      };
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { exists: false, lines: [], truncated: false, bytesRead: 0, fileSizeBytes: 0 };
    }

    throw error;
  }
}

function buildDisplayContract(
  smokeLookup: SmokeReportLookupResult,
  smokeReportDir: string,
  smokeReportMaxAgeDays: number,
): {
  status: 'pending_caller_display_evidence' | 'verified_by_caller_smoke_harness';
  requiredFields: ['warnings', 'forbiddenInterpretations'];
  verifiedByTests: string[];
  evidence: string[];
  blocker?: string;
} {
  if (smokeLookup.latest) {
    return {
      status: 'verified_by_caller_smoke_harness',
      requiredFields: ['warnings', 'forbiddenInterpretations'],
      verifiedByTests: [...displayContractTests],
      evidence: [
        ...callerDisplayEvidence,
        `latest smoke report: ${smokeLookup.latest.reportPath}`,
        `startedAt=${smokeLookup.latest.startedAt}`,
        `evaluation.ok=true`,
        `summary.callerDisplayContractVerified=true`,
      ],
    };
  }

  let blocker: string;
  if (smokeLookup.latestStaleOrFailed) {
    const failed = smokeLookup.latestStaleOrFailed;
    blocker =
      `最近一份 smoke 报告未通过校验：${failed.reportPath}（${failed.failureReason ?? 'unknown'}）。` +
      `请重新运行 scripts/verify-agent-production-smoke.mjs 并产出新报告。`;
  } else if (smokeLookup.reportsScanned > 0) {
    blocker =
      `${smokeReportDir} 中存在 ${smokeLookup.reportsScanned} 份报告但均不合规（缺失 phase 或 evaluation 字段）。`;
  } else {
    blocker =
      `缺少前端或调用方已展示 warnings 与 forbiddenInterpretations 的验收证据；` +
      `${smokeReportDir} 中未发现 ${smokeReportMaxAgeDays} 天内的有效 smoke 报告。` +
      `请运行 scripts/verify-agent-production-smoke.mjs --token <jwt> 生成。`;
  }

  return {
    status: 'pending_caller_display_evidence',
    requiredFields: ['warnings', 'forbiddenInterpretations'],
    verifiedByTests: [...displayContractTests],
    evidence: [...callerDisplayEvidence],
    blocker,
  };
}

function buildStage4_8Stage(observability: AgentObservabilityAudit): AgentReadinessStage {
  const verified = observability.displayContract.status === 'verified_by_caller_smoke_harness';
  return {
    id: 'stage_4_8_caller_display_evidence',
    name: '调用方展示证据闭环',
    status: verified ? 'completed' : 'blocked',
    evidence: verified
      ? [
          'scripts/verify-agent-production-smoke.mjs',
          'tests/api/agent-production-smoke-harness.test.mjs',
          ...observability.displayContract.evidence.filter((e) => e.startsWith('latest smoke report:') || e.startsWith('startedAt=')),
          '调用方 smoke harness 校验每个诊断响应都包含 warnings 与 forbiddenInterpretations。',
        ]
      : [
          'scripts/verify-agent-production-smoke.mjs',
          'tests/api/agent-production-smoke-harness.test.mjs',
        ],
    blockers: verified
      ? []
      : [observability.displayContract.blocker ?? '缺少前端或调用方已展示 warnings 与 forbiddenInterpretations 的验收证据。'],
  };
}

function buildStage5Evidence(observability: AgentObservabilityAudit): AgentReadinessPrerequisite[] {
  const productionAuditObserved = observability.auditLog.productionEvidence;
  const errorRateUnderThreshold =
    productionAuditObserved &&
    observability.auditLog.windowComplete &&
    observability.auditLog.totalAgentDiagnosisCalls > 0 &&
    observability.auditLog.errorRate < 0.01;
  const callerDisplayVerified = observability.displayContract.status === 'verified_by_caller_smoke_harness';

  return [
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
      met: productionAuditObserved,
      evidence: productionAuditObserved
        ? [
            `auditLogConfigured=${observability.auditLog.auditLogConfigured}`,
            `totalAgentDiagnosisCalls=${observability.auditLog.totalAgentDiagnosisCalls}`,
            `lastObservedAt=${observability.auditLog.lastObservedAt ?? 'unknown'}`,
          ]
        : [],
      blocker: '缺少生产 audit log 对 /api/agent/diagnosis/* 调用记录的验收证据。',
    },
    {
      id: 'thirty_day_error_rate_under_threshold',
      name: '最近 30 天 /api/agent/diagnosis/* error rate < 1%',
      met: errorRateUnderThreshold,
      evidence: errorRateUnderThreshold
        ? [
            `windowDays=${observability.auditLog.windowDays}`,
            `windowComplete=${observability.auditLog.windowComplete}`,
            `errorRate=${observability.auditLog.errorRate}`,
            `errorCount=${observability.auditLog.errorCount}`,
          ]
        : [],
      blocker: '缺少最近 30 天 /api/agent/diagnosis/* error rate < 1% 的验收证据。',
    },
    {
      id: 'warnings_and_forbidden_interpretations_displayed',
      name: '前端或调用方展示 warnings 与 forbiddenInterpretations',
      met: callerDisplayVerified,
      evidence: [
        ...observability.displayContract.verifiedByTests,
        ...observability.displayContract.evidence,
      ],
      blocker: callerDisplayVerified
        ? undefined
        : observability.displayContract.blocker
          ?? '缺少前端或调用方已展示 warnings 与 forbiddenInterpretations 的验收证据。',
    },
  ];
}

export async function getAgentObservabilityAudit(options: AgentObservabilityAuditOptions = {}): Promise<AgentObservabilityAudit> {
  const auditLogPath = options.auditLogPath ?? getAuditLogPath();
  const now = options.now ?? new Date();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const windowDays = options.windowDays ?? 30;
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_AUDIT_LOG_MAX_READ_BYTES;
  const smokeReportDir = options.smokeReportDir ?? DEFAULT_SMOKE_REPORT_DIR;
  const smokeReportMaxAgeDays = options.smokeReportMaxAgeDays ?? DEFAULT_SMOKE_REPORT_MAX_AGE_DAYS;
  const smokeReportMaxBytes = options.smokeReportMaxBytes ?? DEFAULT_SMOKE_REPORT_MAX_BYTES;
  const sinceMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const [auditLogTail, smokeLookup] = await Promise.all([
    readAuditLogTail(auditLogPath, maxReadBytes),
    readLatestSmokeReport(smokeReportDir, now, smokeReportMaxAgeDays, smokeReportMaxBytes),
  ]);
  const exists = auditLogTail.exists;

  const coverage = deterministicDiagnosisCapabilities.map((item) => ({
    capabilityId: item.capabilityId,
    endpoint: item.endpoint,
    observedCallCount: 0,
    errorCount: 0,
    lastObservedAt: undefined as string | undefined,
  }));

  const byEndpoint = new Map(coverage.map((item) => [item.endpoint, item]));
  let totalAgentDiagnosisCalls = 0;
  let errorCount = 0;
  let lastObservedAt: string | undefined;
  let earliestObservedAt: string | undefined;

  if (exists) {
    for (const line of auditLogTail.lines) {
      const entry = parseAuditLine(line);
      if (!entry) continue;

      const timestamp = parseTimestamp(entry.timestamp);
      if (!timestamp || timestamp.getTime() < sinceMs || timestamp.getTime() > now.getTime()) continue;

      const requestPath = normalizePath(entry.path);
      if (!requestPath.startsWith('/api/agent/diagnosis/')) continue;

      totalAgentDiagnosisCalls += 1;
      const isError = statusToNumber(entry.status) >= 500;
      if (isError) errorCount += 1;
      if (!lastObservedAt || timestamp.toISOString() > lastObservedAt) {
        lastObservedAt = timestamp.toISOString();
      }
      if (!earliestObservedAt || timestamp.toISOString() < earliestObservedAt) {
        earliestObservedAt = timestamp.toISOString();
      }

      const endpoint = byEndpoint.get(requestPath);
      if (endpoint) {
        endpoint.observedCallCount += 1;
        if (isError) endpoint.errorCount += 1;
        if (!endpoint.lastObservedAt || timestamp.toISOString() > endpoint.lastObservedAt) {
          endpoint.lastObservedAt = timestamp.toISOString();
        }
      }
    }
  }

  const errorRate = totalAgentDiagnosisCalls === 0 ? 0 : roundRate(errorCount / totalAgentDiagnosisCalls);
  const productionEvidence = nodeEnv === 'production' && exists && totalAgentDiagnosisCalls > 0;
  const windowComplete =
    exists &&
    (!auditLogTail.truncated ||
      (earliestObservedAt ? new Date(earliestObservedAt).getTime() <= sinceMs : false));
  const status = (() => {
    if (!exists) return 'missing_log' as const;
    if (totalAgentDiagnosisCalls === 0) return 'no_recent_agent_calls' as const;
    if (!productionEvidence) return 'not_production_evidence' as const;
    if (!windowComplete) return 'partial_window_sample' as const;
    if (errorRate >= 0.01) return 'error_rate_above_threshold' as const;
    return 'observed' as const;
  })();

  const audit = AgentObservabilityAuditSchema.parse({
    phase: 'agent_observability_readiness',
    auditLog: {
      status,
      auditLogConfigured: auditLogPath.length > 0,
      exists,
      productionEvidence,
      windowComplete,
      windowDays,
      logReadBytes: auditLogTail.bytesRead,
      logFileBytes: auditLogTail.fileSizeBytes,
      logTruncated: auditLogTail.truncated,
      totalAgentDiagnosisCalls,
      errorCount,
      errorRate,
      lastObservedAt,
      auditedPathPrefixes: [...AUDITED_PATHS],
    },
    endpointCoverage: coverage.map((item) => ({
      ...item,
      errorRate: item.observedCallCount === 0 ? 0 : roundRate(item.errorCount / item.observedCallCount),
      status: item.observedCallCount > 0 ? 'observed' : 'missing_recent_call',
    })),
    stage5Evidence: [],
    displayContract: buildDisplayContract(smokeLookup, smokeReportDir, smokeReportMaxAgeDays),
    notes: [
      '本审计只读取既有 audit log，不新增 SQL，不调用 LLM。',
      '请求路径只异步读取审计日志尾部的限量样本；只有样本覆盖完整 30 天窗口时，才允许采信 30 天错误率达标证据。',
      '只有 NODE_ENV=production 且最近 30 天存在 /api/agent/diagnosis/* 调用时，才视为生产审计证据。',
      `warnings 与 forbiddenInterpretations 展示契约通过扫描 ${smokeReportDir} 中最新 smoke harness 报告派生：` +
        '只有 evaluation.ok=true 且 summary.callerDisplayContractVerified=true 且 startedAt 落在窗口内才视为已验证。',
    ],
  });

  return AgentObservabilityAuditSchema.parse({
    ...audit,
    stage5Evidence: buildStage5Evidence(audit),
  });
}

export interface AgentReadinessAuditOptions {
  observability?: AgentObservabilityAuditOptions;
}

export async function getAgentReadinessAudit(options: AgentReadinessAuditOptions = {}): Promise<AgentReadinessAudit> {
  const capabilitySummary = summarizeBySupportLevel(agentDataCapabilityRegistry);
  const observabilityEvidence = await getAgentObservabilityAudit(options.observability);
  const stage4_8 = buildStage4_8Stage(observabilityEvidence);
  // 在 stage_5_llm_interpretation 之前插入 stage_4_8（保持原有顺序）
  const stages: AgentReadinessStage[] = [];
  for (const stage of stageReadiness) {
    if (stage.id === 'stage_5_llm_interpretation') stages.push(stage4_8);
    stages.push(stage);
  }
  const completedStages = stages.filter((stage) => stage.status === 'completed');
  const blockedStages = stages.filter((stage) => stage.status === 'blocked');
  const pendingStages = stages.filter((stage) => stage.status === 'pending');
  const stage5Prerequisites = observabilityEvidence.stage5Evidence;
  const llmReadinessBlockers = stage5Prerequisites
    .filter((item) => !item.met && item.blocker)
    .map((item) => item.blocker!);
  const stage4_8Verified = stage4_8.status === 'completed';

  return AgentReadinessAuditSchema.parse({
    phase: 'agent_metric_adaptation_audit',
    currentStage: stage4_8Verified
      ? 'stage_4_8_display_contract_ready'
      : 'stage_4_6_observability_ready',
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
    observabilityEvidence,
    notes: [
      'Stage 1-4.6 已完成：指标审计、注册表一致性、确定性诊断、经营巡检聚合和观测证据闭环。',
      stage4_8Verified
        ? 'Stage 4.8 已完成：调用方 smoke harness 校验 warnings 与 forbiddenInterpretations 展示契约。'
        : 'Stage 4.8 仍被阻塞：缺少有效的调用方 smoke harness 报告（见 stage_4_8_caller_display_evidence.blockers）。',
      'Agent 层复用现有指标注册表、查询路由和 SQL 生成器，不新增自由查询能力。',
      '承保利润、利润率、边际贡献、财务盈亏、财务综合成本率保持 unsupported。',
      'Stage 5 LLM 解释层仍保持关闭；即使前置证据齐备，也必须通过单独 PR 显式启动。',
    ],
  });
}
