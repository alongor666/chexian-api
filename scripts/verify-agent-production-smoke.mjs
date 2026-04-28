#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DIAGNOSIS_BASE = '/api/agent/diagnosis';
const AUDIT_BASE = '/api/agent/audit';
const FORECAST_BASE = '/api/agent/forecast';
const EXPLAIN_BASE = '/api/agent/explain';

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function assertDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`${name} is required and must use YYYY-MM-DD`);
  }
}

function toPositiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    baseUrl: stripTrailingSlash(env.AGENT_SMOKE_BASE_URL || 'http://127.0.0.1:3000'),
    token: env.AGENT_SMOKE_TOKEN || env.AUTH_TOKEN || '',
    startDate: env.AGENT_SMOKE_START_DATE || '',
    endDate: env.AGENT_SMOKE_END_DATE || '',
    baselineStartDate: env.AGENT_SMOKE_BASELINE_START_DATE || '',
    baselineEndDate: env.AGENT_SMOKE_BASELINE_END_DATE || '',
    timeoutMs: toPositiveInt(env.AGENT_SMOKE_TIMEOUT_MS || '30000', 'AGENT_SMOKE_TIMEOUT_MS'),
    outputDir: env.AGENT_SMOKE_OUTPUT_DIR || 'output/agent-smoke',
    expectLlmBlocked: true,
    printPlan: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--allow-llm-ready') {
      options.expectLlmBlocked = false;
      continue;
    }
    if (arg === '--print-plan') {
      options.printPlan = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--base-url') options.baseUrl = stripTrailingSlash(next);
    else if (arg === '--token') options.token = next;
    else if (arg === '--start-date') options.startDate = next;
    else if (arg === '--end-date') options.endDate = next;
    else if (arg === '--baseline-start-date') options.baselineStartDate = next;
    else if (arg === '--baseline-end-date') options.baselineEndDate = next;
    else if (arg === '--timeout-ms') options.timeoutMs = toPositiveInt(next, '--timeout-ms');
    else if (arg === '--output-dir') options.outputDir = next;
    else throw new Error(`Unknown argument: ${arg}`);
    i += 1;
  }

  if (options.help) return options;

  assertDate(options.startDate, '--start-date');
  assertDate(options.endDate, '--end-date');
  assertDate(options.baselineStartDate, '--baseline-start-date');
  assertDate(options.baselineEndDate, '--baseline-end-date');
  if (!options.token) {
    throw new Error('Bearer token is required. Set AGENT_SMOKE_TOKEN or pass --token.');
  }

  return options;
}

export function redactOptionsForReport(options) {
  const { token: _token, ...safe } = options;
  return { ...safe, tokenProvided: Boolean(options.token) };
}

function buildDateFilters(options) {
  return {
    startDate: options.startDate,
    endDate: options.endDate,
    dateField: 'policy_date',
  };
}

function buildQuoteDateFilters(options) {
  return {
    dateStart: options.startDate,
    dateEnd: options.endDate,
  };
}

function buildClaimsDateFilters(options) {
  return {
    dateStart: options.startDate,
    dateEnd: options.endDate,
  };
}

function buildCustomerFlowYear(options) {
  return Number(options.endDate.slice(0, 4));
}

function buildDiagnosisInputs(options) {
  const costIndicators = {
    cutoffDate: options.endDate,
    dimension: 'org_level_3',
    limit: 10,
    minPremium: 0,
    filters: buildDateFilters(options),
  };
  const growth = {
    currentPeriod: { startDate: options.startDate, endDate: options.endDate },
    baselinePeriod: { startDate: options.baselineStartDate, endDate: options.baselineEndDate },
    comparisonMode: 'custom',
    timeView: 'monthly',
    perspective: 'premium',
    dimension: 'org_level_3',
    includeDailyContext: false,
    limit: 10,
    minCurrentValue: 0,
    filters: {},
  };
  const quoteConversion = {
    filters: buildQuoteDateFilters(options),
    drilldownLevel: 'org',
    trendGranularity: 'week',
    limit: 10,
  };
  const renewalTracker = {
    start: options.startDate,
    end: options.endDate,
    cutoff: options.endDate,
    filters: {},
    limit: 10,
  };
  const claimsRisk = {
    filters: buildClaimsDateFilters(options),
    limit: 10,
  };
  const customerFlow = {
    year: buildCustomerFlowYear(options),
    limit: 10,
  };

  return { growth, costIndicators, quoteConversion, renewalTracker, claimsRisk, customerFlow };
}

function buildExplanationInput() {
  return {
    sourceCapabilityId: 'cost_indicator_diagnosis',
    userQuestion: '变动成本率为什么升高？',
    diagnosisResult: {
      capabilityId: 'cost_indicator_diagnosis',
      status: 'supported',
      requestedTools: ['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'],
      summary: {
        smoke: true,
        primaryMetricId: 'variable_cost_ratio',
      },
      diagnostics: [
        {
          metricId: 'variable_cost_ratio',
          severity: 'warning',
          note: 'Agent production smoke fixture for explanation contract verification.',
        },
        {
          metricId: 'earned_claim_ratio',
          severity: 'info',
          note: 'Agent production smoke fixture for claim ratio context.',
        },
        {
          metricId: 'expense_ratio',
          severity: 'info',
          note: 'Agent production smoke fixture for expense ratio context.',
        },
      ],
      warnings: ['变动成本率为项目内经营分析口径，不代表完整财务承保利润。'],
      forbiddenInterpretations: ['承保利润', '利润率', '财务盈利', '财务亏损'],
    },
  };
}

export function buildSmokePlan(options) {
  const diagnostics = buildDiagnosisInputs(options);

  return [
    {
      name: 'growth_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'growth_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/growth`,
      body: diagnostics.growth,
    },
    {
      name: 'cost_indicator_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'cost_indicator_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/cost-indicators`,
      body: diagnostics.costIndicators,
    },
    {
      name: 'quote_conversion_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'quote_conversion_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/quote-conversion`,
      body: diagnostics.quoteConversion,
    },
    {
      name: 'renewal_tracker_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'renewal_tracker_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/renewal-tracker`,
      body: diagnostics.renewalTracker,
    },
    {
      name: 'claims_risk_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'claims_risk_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/claims-risk`,
      body: diagnostics.claimsRisk,
    },
    {
      name: 'customer_flow_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'customer_flow_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/customer-flow`,
      body: diagnostics.customerFlow,
    },
    {
      name: 'business_patrol_diagnosis',
      kind: 'diagnosis',
      capabilityId: 'business_patrol_diagnosis',
      method: 'POST',
      path: `${DIAGNOSIS_BASE}/business-patrol`,
      body: {
        timeoutMs: 5000,
        limit: 10,
        diagnostics,
      },
    },
    {
      name: 'forecast_operating_profit_scenario',
      kind: 'diagnosis',
      capabilityId: 'forecast_operating_profit_scenario',
      method: 'POST',
      path: `${FORECAST_BASE}/profit-scenario`,
      body: {
        premium: 20000000,
        ultimateVariableCostRatio: 85,
        ultimateFixedCostRatio: 9,
        earningSchedule: [
          { period: options.endDate.slice(0, 4), earnedRatio: 52 },
          { period: String(Number(options.endDate.slice(0, 4)) + 1), earnedRatio: 48 },
        ],
        scenarioName: 'agent-smoke-profit-scenario',
        assumptionSource: 'caller_provided',
      },
    },
    {
      name: 'agent_diagnosis_explanation',
      kind: 'explain',
      capabilityId: 'cost_indicator_diagnosis',
      method: 'POST',
      path: `${EXPLAIN_BASE}/diagnosis`,
      body: buildExplanationInput(),
    },
    {
      name: 'observability',
      kind: 'audit',
      method: 'GET',
      path: `${AUDIT_BASE}/observability`,
    },
    {
      name: 'readiness',
      kind: 'audit',
      method: 'GET',
      path: `${AUDIT_BASE}/readiness`,
    },
  ];
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { parseError: 'response_is_not_json', textSample: text.slice(0, 200) };
  }
}

function summarizeResponse(response) {
  const data = response?.data;
  return {
    success: response?.success,
    capabilityId: data?.capabilityId,
    status: data?.status,
    auditLogStatus: data?.auditLog?.status ?? data?.observabilityEvidence?.auditLog?.status,
    readyForLlm: data?.readyForLlm,
    warningsCount: Array.isArray(data?.warnings) ? data.warnings.length : undefined,
    forbiddenInterpretationsCount: Array.isArray(data?.forbiddenInterpretations)
      ? data.forbiddenInterpretations.length
      : undefined,
  };
}

function sanitizeResponseForReport(response) {
  if (response?.success === false) {
    return {
      success: false,
      error: {
        statusCode: response.error?.statusCode,
        messagePresent: typeof response.error?.message === 'string' && response.error.message.length > 0,
      },
    };
  }
  return response;
}

async function runStep(step, options) {
  const startedAt = Date.now();
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/json',
  };
  if (step.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetchWithTimeout(
      `${options.baseUrl}${step.path}`,
      {
        method: step.method,
        headers,
        body: step.method === 'POST' ? JSON.stringify(step.body) : undefined,
      },
      options.timeoutMs
    );
    const body = await readJsonResponse(response);

    return {
      name: step.name,
      kind: step.kind,
      capabilityId: step.capabilityId,
      method: step.method,
      path: step.path,
      status: response.status,
      ok: response.ok && body?.success !== false,
      durationMs: Date.now() - startedAt,
      responseSummary: summarizeResponse(body),
      response: sanitizeResponseForReport(body),
    };
  } catch (error) {
    return {
      name: step.name,
      kind: step.kind,
      capabilityId: step.capabilityId,
      method: step.method,
      path: step.path,
      status: 0,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function hasDisplayContract(step) {
  const data = step.response?.data;
  return Array.isArray(data?.warnings) && Array.isArray(data?.forbiddenInterpretations);
}

function hasExplanationContract(step) {
  const data = step.response?.data;
  return hasDisplayContract(step) && (data?.status === 'explained' || data?.status === 'refused');
}

function mapStage5Prerequisites(readinessStep) {
  const prerequisites = readinessStep?.response?.data?.stage5Prerequisites;
  if (!Array.isArray(prerequisites)) return {};
  return Object.fromEntries(prerequisites.map((item) => [item.id, Boolean(item.met)]));
}

export function evaluateSmokeReport(report, options = {}) {
  const diagnosisSteps = report.steps.filter((step) => step.kind === 'diagnosis');
  const explainSteps = report.steps.filter((step) => step.kind === 'explain');
  const auditSteps = report.steps.filter((step) => step.kind === 'audit');
  const readinessStep = report.steps.find((step) => step.name === 'readiness');
  const observabilityStep = report.steps.find((step) => step.name === 'observability');
  const stage5Prerequisites = mapStage5Prerequisites(readinessStep);
  const readyForLlm = readinessStep?.response?.data?.readyForLlm === true;
  const callerDisplayContractVerified =
    diagnosisSteps.length > 0 && diagnosisSteps.every((step) => step.ok && hasDisplayContract(step));
  const explanationContractVerified =
    explainSteps.length > 0 && explainSteps.every((step) => step.ok && hasExplanationContract(step));
  const failures = [];

  for (const step of report.steps) {
    if (!step.ok) {
      failures.push(`${step.name} returned status ${step.status}${step.error ? `: ${step.error}` : ''}`);
    }
  }
  if (!callerDisplayContractVerified) {
    failures.push('caller_display_contract_missing: diagnosis responses must include warnings and forbiddenInterpretations arrays');
  }
  if (!explanationContractVerified) {
    failures.push('agent_explanation_contract_missing: explanation response must include status, warnings and forbiddenInterpretations arrays');
  }
  if (options.expectLlmBlocked !== false && readyForLlm) {
    failures.push('readyForLlm unexpectedly became true; Stage 5 must remain blocked until explicitly released');
  }

  const summary = {
    diagnosisOk: diagnosisSteps.every((step) => step.ok),
    explanationOk: explainSteps.every((step) => step.ok),
    auditOk: auditSteps.every((step) => step.ok),
    callerDisplayContractVerified,
    explanationContractVerified,
    readyForLlm,
    observabilityStatus: observabilityStep?.response?.data?.auditLog?.status,
    observabilityWindowComplete: observabilityStep?.response?.data?.auditLog?.windowComplete,
    stage5Prerequisites,
  };

  return {
    ok: failures.length === 0,
    summary,
    failures,
  };
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function printHelp() {
  console.log([
    'Usage:',
    '  bun scripts/verify-agent-production-smoke.mjs --token <jwt> --start-date YYYY-MM-DD --end-date YYYY-MM-DD --baseline-start-date YYYY-MM-DD --baseline-end-date YYYY-MM-DD [options]',
    '',
    'Options:',
    '  --base-url <url>              Target API base URL (default: AGENT_SMOKE_BASE_URL or http://127.0.0.1:3000)',
    '  --token <jwt>                 Bearer token (default: AGENT_SMOKE_TOKEN or AUTH_TOKEN)',
    '  --start-date <date>           Diagnosis current period start date',
    '  --end-date <date>             Diagnosis current period end date and cutoff',
    '  --baseline-start-date <date>  Growth baseline period start date',
    '  --baseline-end-date <date>    Growth baseline period end date',
    '  --timeout-ms <ms>             Per-request timeout (default: 30000)',
    '  --output-dir <dir>            Report output directory (default: output/agent-smoke)',
    '  --allow-llm-ready             Do not fail if readiness reports readyForLlm=true',
    '  --print-plan                  Print planned requests and exit without calling the API',
    '  -h, --help                    Show help',
  ].join('\n'));
}

export async function runSmoke(options) {
  const plan = buildSmokePlan(options);
  if (options.printPlan) {
    return {
      phase: 'agent_production_smoke_harness',
      startedAt: new Date().toISOString(),
      options: redactOptionsForReport(options),
      plan,
      steps: [],
      evaluation: { ok: true, summary: {}, failures: [] },
    };
  }

  const steps = [];
  for (const step of plan) {
    steps.push(await runStep(step, options));
  }

  const report = {
    phase: 'agent_production_smoke_harness',
    startedAt: new Date().toISOString(),
    options: redactOptionsForReport(options),
    steps,
  };
  return {
    ...report,
    evaluation: evaluateSmokeReport(report, { expectLlmBlocked: options.expectLlmBlocked }),
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const report = await runSmoke(options);
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `agent-production-smoke-${formatTimestamp()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(JSON.stringify({
    ok: report.evaluation.ok,
    reportPath,
    summary: report.evaluation.summary,
    failures: report.evaluation.failures,
  }, null, 2));

  if (!report.evaluation.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
