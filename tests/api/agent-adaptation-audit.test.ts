import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getAgentCapabilityAudit, getAgentReadinessAudit } from '../../server/src/agent/services/agent-adaptation-audit-service';
import { routeAgentQuestion } from '../../server/src/agent/services/agent-question-router-service';

function writeValidSmokeReport(now = new Date()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-smoke-fixture-'));
  const reportPath = path.join(dir, `agent-production-smoke-${now.getTime()}.json`);
  const report = {
    phase: 'agent_production_smoke_harness',
    startedAt: now.toISOString(),
    options: {},
    steps: [],
    evaluation: {
      ok: true,
      summary: {
        diagnosisOk: true,
        auditOk: true,
        callerDisplayContractVerified: true,
        readyForLlm: false,
        observabilityStatus: 'observed',
        observabilityWindowComplete: true,
        stage5Prerequisites: [],
      },
      failures: [],
    },
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return dir;
}

describe('agent adaptation audit routing', () => {
  it('returns cost_indicator_diagnosis in capability audit', () => {
    const audit = getAgentCapabilityAudit();

    expect(audit.capabilities.map((item) => item.id)).toContain('cost_indicator_diagnosis');
    expect(audit.capabilities.find((item) => item.id === 'cost_indicator_diagnosis')?.supportLevel)
      .toBe('supported');
  });

  it('keeps comprehensive and fixed cost metrics in caution review capability only', () => {
    const audit = getAgentCapabilityAudit();
    const costDiagnosis = audit.capabilities.find((item) => item.id === 'cost_indicator_diagnosis');
    const comprehensiveReview = audit.capabilities.find((item) => item.id === 'comprehensive_cost_indicator_review');

    expect(comprehensiveReview?.supportLevel).toBe('caution');
    expect(comprehensiveReview?.coreMetrics).toEqual(
      expect.arrayContaining([
        'comprehensive_expense_ratio',
        'combined_cost_amount',
        'combined_cost_ratio',
        'fixed_cost_amount',
        'fixed_cost_ratio',
      ])
    );
    // 49e3fd：别名统一后旧 id 双档案已并入 comprehensive_expense_ratio，不得复活
    expect(comprehensiveReview?.coreMetrics).not.toContain('comprehensive_cost_ratio');
    expect(costDiagnosis?.coreMetrics).not.toEqual(
      expect.arrayContaining(['combined_cost_ratio', 'fixed_cost_ratio', 'comprehensive_expense_ratio'])
    );
  });

  it('keeps comprehensive_expense_ratio aligned across registry, mapping, and capability list', async () => {
    const audit = getAgentCapabilityAudit();
    const review = audit.capabilities.find((item) => item.id === 'comprehensive_cost_indicator_review');
    const { metricCapabilityMapping } = await import('../../server/src/agent/registry/metric-capability-mapping.js');
    const { agentMetricRegistry } = await import('../../server/src/agent/registry/agent-metric-registry.js');

    expect(review?.coreMetrics).toContain('comprehensive_expense_ratio');
    expect(metricCapabilityMapping.comprehensive_expense_ratio).toContain('comprehensive_cost_indicator_review');
    expect(agentMetricRegistry.some((m) => m.id === 'comprehensive_expense_ratio')).toBe(true);
    // 49e3fd：旧 id comprehensive_cost_ratio 双档案已合并，注册表/映射中不得复活
    expect(agentMetricRegistry.some((m) => m.id === 'comprehensive_cost_ratio')).toBe(false);
    expect(metricCapabilityMapping).not.toHaveProperty('comprehensive_cost_ratio');
  });

  it('routes variable cost questions to cost indicator diagnosis', () => {
    const result = routeAgentQuestion({ question: '变动成本率为什么升高？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('supported');
    expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
    expect(result.recommendedMetrics).toEqual(
      expect.arrayContaining(['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'])
    );
    expect(result.recommendedTools).toEqual(
      expect.arrayContaining(['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'])
    );
  });

  it('blocks underwriting profit questions', () => {
    const result = routeAgentQuestion({ question: '承保利润怎么样？' });

    expect(result.blocked).toBe(true);
    expect(result.status).toBe('unsupported');
    expect(result.reason).toContain('不支持承保利润');
  });

  it('blocks financial loss questions', () => {
    const result = routeAgentQuestion({ question: '哪个机构亏损？' });

    expect(result.blocked).toBe(true);
    expect(result.status).toBe('unsupported');
    expect(result.reason).toContain('财务盈亏');
  });

  it('blocks explicit profit amount and margin contribution questions', () => {
    for (const question of ['哪个机构实际亏损？', '哪个机构承保利润最低？']) {
      const result = routeAgentQuestion({ question });

      expect(result.blocked).toBe(true);
      expect(result.status).toBe('unsupported');
    }
  });

  it('routes margin contribution questions without treating them as financial profit', () => {
    for (const question of ['满期边际贡献额怎么看？', '预估边际贡献额下降原因？']) {
      const result = routeAgentQuestion({ question });

      expect(result.blocked).toBe(false);
      expect(result.status).toBe('supported');
      expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
      expect(result.warnings.join('')).toContain('边际贡献额仅扣变动成本');
    }
  });

  it('routes generic cost indicator anomaly questions without blocking variable cost ratio', () => {
    const result = routeAgentQuestion({ question: '哪个机构成本指标异常？' });

    expect(result.blocked).toBe(false);
    expect(result.matchedCapabilityId).toBe('cost_indicator_diagnosis');
    expect(result.recommendedMetrics).toEqual(
      expect.arrayContaining(['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'])
    );
  });

  it('returns caution for ambiguous comprehensive cost ratio questions', () => {
    const result = routeAgentQuestion({ question: '哪个机构综合成本率最高？' });

    expect(result.blocked).toBe(false);
    expect(result.status).toBe('caution');
    expect(result.warnings.join('')).toContain('不得解释为承保利润');
    expect(result.replacementSuggestions).toEqual(
      expect.arrayContaining(['改问变动成本率', '改问赔付率', '改问费用率'])
    );
  });

  it('routes common business questions to existing capabilities', () => {
    expect(routeAgentQuestion({ question: '本月保费增长来自哪里？' }).matchedCapabilityId)
      .toBe('growth_diagnosis');
    expect(routeAgentQuestion({ question: '报价转化卡在哪里？' }).matchedCapabilityId)
      .toBe('quote_conversion_diagnosis');
    expect(routeAgentQuestion({ question: '续保情况怎么样？' }).matchedCapabilityId)
      .toBe('renewal_tracker_diagnosis');
    expect(routeAgentQuestion({ question: '终极综合成本率怎么算？' }).matchedCapabilityId)
      .toBe('forecast_operating_profit_scenario');
  });

  it('reports Stage 1-4 deterministic readiness and keeps Stage 5 blocked by production evidence', async () => {
    const now = new Date('2026-04-27T00:00:00.000Z');
    const smokeReportDir = writeValidSmokeReport(now);
    const readiness = await getAgentReadinessAudit({
      observability: { now, smokeReportDir },
    });
    const displayEvidence = readiness.stage5Prerequisites.find(
      (item) => item.id === 'warnings_and_forbidden_interpretations_displayed'
    );

    expect(readiness.currentStage).toBe('stage_4_9_deterministic_profit_forecast');
    expect(readiness.readyForLlm).toBe(false);
    expect(readiness.deterministicDiagnosisCapabilityCount).toBe(7);
    expect(readiness.completedStages.map((stage) => stage.id)).toEqual(
      expect.arrayContaining([
        'stage_1_metric_adaptation_audit',
        'phase_0a_metric_registry_consistency',
        'stage_2_cost_indicator_diagnosis',
        'stage_3_deterministic_diagnoses',
        'stage_4_business_patrol',
        'stage_4_6_observability_readiness',
        'stage_4_8_caller_display_evidence',
        'stage_4_9_deterministic_profit_forecast',
      ])
    );
    expect(readiness.blockedStages.map((stage) => stage.id)).toContain('stage_5_llm_interpretation');
    expect(readiness.pendingStages.map((stage) => stage.id)).toContain('stage_6_operations_workbench');
    expect(readiness.llmReadinessBlockers).toEqual(
      expect.arrayContaining([
        '缺少生产 audit log 对 /api/agent/diagnosis/* 调用记录的验收证据。',
        '缺少最近 30 天 /api/agent/diagnosis/* error rate < 1% 的验收证据。',
      ])
    );
    expect(readiness.llmReadinessBlockers).not.toContain(
      '缺少前端或调用方已展示 warnings 与 forbiddenInterpretations 的验收证据。'
    );
    expect(displayEvidence?.met).toBe(true);
    expect(displayEvidence?.evidence).toEqual(
      expect.arrayContaining([
        'scripts/verify-agent-production-smoke.mjs',
        'tests/api/agent-production-smoke-harness.test.mjs',
      ])
    );
    expect(readiness.observabilityEvidence.displayContract.status).toBe('verified_by_caller_smoke_harness');
    expect(readiness.observabilityEvidence.phase).toBe('agent_observability_readiness');
  });

  it('lists every deterministic diagnosis endpoint with integration and route-contract evidence', async () => {
    const readiness = await getAgentReadinessAudit();
    const byCapability = new Map(readiness.deterministicDiagnosisCapabilities.map((item) => [item.capabilityId, item]));

    for (const capabilityId of [
      'cost_indicator_diagnosis',
      'growth_diagnosis',
      'quote_conversion_diagnosis',
      'renewal_tracker_diagnosis',
      'claims_risk_diagnosis',
      'customer_flow_diagnosis',
      'business_patrol_diagnosis',
    ]) {
      const item = byCapability.get(capabilityId);
      expect(item, capabilityId).toBeDefined();
      expect(item?.status).toBe('ready');
      expect(item?.endpoint).toMatch(/^\/api\/agent\/diagnosis\//);
      expect(item?.routeConstant).toMatch(/^AGENT_DIAGNOSIS_ROUTES\./);
      expect(item?.frontendRouteConstant).toMatch(/^AGENT_DIAGNOSIS_ROUTES\./);
      expect(item?.httpIntegrationTest).toMatch(/^tests\/api\/agent-.*\.test\.ts$/);
      expect(item?.routeContractTest).toMatch(/^tests\/api\/agent-.*\.route-contract\.test\.ts$/);
      expect(item?.requiredWarnings).toBe(true);
      expect(item?.requiredForbiddenInterpretations).toBe(true);
    }
  });
});
