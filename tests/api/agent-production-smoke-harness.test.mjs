import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildSmokePlan,
  evaluateSmokeReport,
  parseArgs,
  redactOptionsForReport,
} from '../../scripts/verify-agent-production-smoke.mjs';

describe('agent production smoke harness', () => {
  const baseOptions = {
    baseUrl: 'https://chexian.cretvalu.com/',
    token: 'secret-token',
    startDate: '2026-04-01',
    endDate: '2026-04-26',
    baselineStartDate: '2025-04-01',
    baselineEndDate: '2025-04-26',
    timeoutMs: 30000,
    outputDir: 'output/agent-smoke',
    expectLlmBlocked: true,
  };

  it('parses explicit production smoke options without exposing bearer token in report options', () => {
    const options = parseArgs(
      [
        '--base-url',
        'https://chexian.cretvalu.com/',
        '--token',
        'secret-token',
        '--start-date',
        '2026-04-01',
        '--end-date',
        '2026-04-26',
        '--baseline-start-date',
        '2025-04-01',
        '--baseline-end-date',
        '2025-04-26',
      ],
      {}
    );

    expect(options.baseUrl).toBe('https://chexian.cretvalu.com');
    expect(options.token).toBe('secret-token');
    expect(redactOptionsForReport(options)).not.toHaveProperty('token');
    expect(JSON.stringify(redactOptionsForReport(options))).not.toContain('secret-token');
  });

  it('builds a fixed Agent diagnosis and audit smoke plan with explicit date payloads', () => {
    const plan = buildSmokePlan(baseOptions);

    expect(plan.map((step) => `${step.method} ${step.path}`)).toEqual([
      'POST /api/agent/diagnosis/growth',
      'POST /api/agent/diagnosis/cost-indicators',
      'POST /api/agent/diagnosis/quote-conversion',
      'POST /api/agent/diagnosis/renewal-tracker',
      'POST /api/agent/diagnosis/claims-risk',
      'POST /api/agent/diagnosis/customer-flow',
      'POST /api/agent/diagnosis/business-patrol',
      'POST /api/agent/forecast/profit-scenario',
      'POST /api/agent/forecast/profit-segment',
      'POST /api/agent/explain/diagnosis',
      'GET /api/agent/audit/observability',
      'GET /api/agent/audit/readiness',
    ]);

    const segmentStep = plan.find((step) => step.name === 'forecast_operating_profit_segment');
    expect(segmentStep?.acceptableNonOkStatuses).toEqual([403]);

    const growth = plan.find((step) => step.capabilityId === 'growth_diagnosis');
    expect(growth?.body.currentPeriod).toEqual({ startDate: '2026-04-01', endDate: '2026-04-26' });
    expect(growth?.body.baselinePeriod).toEqual({ startDate: '2025-04-01', endDate: '2025-04-26' });

    const businessPatrol = plan.find((step) => step.capabilityId === 'business_patrol_diagnosis');
    expect(businessPatrol?.body.diagnostics.growth.currentPeriod.endDate).toBe('2026-04-26');

    const explanation = plan.find((step) => step.name === 'agent_diagnosis_explanation');
    expect(explanation?.kind).toBe('explain');
    expect(explanation?.body.sourceCapabilityId).toBe('cost_indicator_diagnosis');
    expect(explanation?.body.diagnosisResult.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('变动成本率')])
    );
    expect(explanation?.body.diagnosisResult.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
    expect(JSON.stringify(plan)).not.toContain('CURRENT_DATE');
  });

  it('keeps Stage 5 blocked while reporting diagnosis and caller display evidence separately', () => {
    const report = {
      steps: [
        {
          name: 'growth_diagnosis',
          kind: 'diagnosis',
          ok: true,
          status: 200,
          response: {
            success: true,
            data: {
              capabilityId: 'growth_diagnosis',
              warnings: ['sample warning'],
              forbiddenInterpretations: ['承保利润'],
            },
          },
        },
        {
          name: 'agent_diagnosis_explanation',
          kind: 'explain',
          ok: true,
          status: 200,
          response: {
            success: true,
            data: {
              capabilityId: 'cost_indicator_diagnosis',
              status: 'explained',
              warnings: ['sample warning'],
              forbiddenInterpretations: ['承保利润'],
            },
          },
        },
        {
          name: 'observability',
          kind: 'audit',
          ok: true,
          status: 200,
          response: {
            success: true,
            data: {
              auditLog: {
                status: 'partial_window_sample',
                productionEvidence: true,
                windowComplete: false,
              },
            },
          },
        },
        {
          name: 'readiness',
          kind: 'audit',
          ok: true,
          status: 200,
          response: {
            success: true,
            data: {
              readyForLlm: false,
              stage5Prerequisites: [
                { id: 'production_audit_log_observed', met: true },
                { id: 'thirty_day_error_rate_under_threshold', met: false },
                { id: 'warnings_and_forbidden_interpretations_displayed', met: true },
              ],
            },
          },
        },
      ],
    };

    const evaluation = evaluateSmokeReport(report, { expectLlmBlocked: true });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.summary.diagnosisOk).toBe(true);
    expect(evaluation.summary.callerDisplayContractVerified).toBe(true);
    expect(evaluation.summary.explanationContractVerified).toBe(true);
    expect(evaluation.summary.readyForLlm).toBe(false);
    expect(evaluation.summary.stage5Prerequisites.thirty_day_error_rate_under_threshold).toBe(false);
    expect(evaluation.summary.stage5Prerequisites.warnings_and_forbidden_interpretations_displayed).toBe(true);
  });

  it('does not add LLM, NL2SQL, raw SQL, or implicit current-date behavior', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'scripts/verify-agent-production-smoke.mjs'), 'utf-8');

    expect(source).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(source).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(source).not.toContain('CURRENT_DATE');
  });

  it('treats role-skipped 403 on profit-segment as OK and excludes it from display-contract verification', () => {
    // Simulates a smoke run with a non-admin token: profit-segment returns 403 by design.
    // Whole-report ok must remain true; the role-skipped step is recorded in summary
    // and excluded from the diagnosis caller-display contract aggregation.
    const report = {
      steps: [
        {
          name: 'cost_indicator_diagnosis',
          kind: 'diagnosis',
          ok: true,
          status: 200,
          response: {
            success: true,
            data: {
              capabilityId: 'cost_indicator_diagnosis',
              warnings: ['cost warning'],
              forbiddenInterpretations: ['承保利润'],
            },
          },
        },
        {
          name: 'forecast_operating_profit_segment',
          kind: 'diagnosis',
          ok: true,
          roleSkipped: true,
          status: 403,
          response: { success: false, error: { statusCode: 403, messagePresent: true } },
        },
        {
          name: 'agent_diagnosis_explanation',
          kind: 'explain',
          ok: true,
          status: 200,
          response: {
            success: true,
            data: {
              capabilityId: 'cost_indicator_diagnosis',
              status: 'explained',
              warnings: ['x'],
              forbiddenInterpretations: ['承保利润'],
            },
          },
        },
        {
          name: 'observability',
          kind: 'audit',
          ok: true,
          status: 200,
          response: { success: true, data: { auditLog: { status: 'observed', windowComplete: true } } },
        },
        {
          name: 'readiness',
          kind: 'audit',
          ok: true,
          status: 200,
          response: { success: true, data: { readyForLlm: false, stage5Prerequisites: [] } },
        },
      ],
    };

    const evaluation = evaluateSmokeReport(report, { expectLlmBlocked: true });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.summary.callerDisplayContractVerified).toBe(true);
    expect(evaluation.summary.roleSkippedStepNames).toContain('forecast_operating_profit_segment');
  });

  it('keeps the harness honest when an unexpected non-OK status hits a non-role-gated step', () => {
    // Sanity check: a 500 on a regular diagnosis step must still fail the report.
    const report = {
      steps: [
        {
          name: 'growth_diagnosis',
          kind: 'diagnosis',
          ok: false,
          status: 500,
          response: { success: false, error: { statusCode: 500, messagePresent: true } },
        },
      ],
    };

    const evaluation = evaluateSmokeReport(report, { expectLlmBlocked: true });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.failures.join('\n')).toContain('growth_diagnosis returned status 500');
  });
});
