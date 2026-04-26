import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import {
  runBusinessPatrolTasks,
  type BusinessPatrolTask,
} from '../../server/src/agent/services/agent-business-patrol-diagnosis-service';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

function makeTask(
  capabilityId: BusinessPatrolTask['capabilityId'],
  result: unknown,
  delayMs = 0
): BusinessPatrolTask {
  return {
    capabilityId,
    run: async () => {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return result;
    },
  };
}

const costResult = {
  capabilityId: 'cost_indicator_diagnosis',
  status: 'supported',
  requestedTools: ['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'],
  summary: { highRiskCount: 1, warningCount: 0, topDriver: 'claim' },
  anomalies: [
    {
      dimKey: 'A机构',
      severity: 'critical',
      primaryDriver: 'claim',
      metrics: { variableCostRatio: 126.5, earnedClaimRatio: 92.1, expenseRatio: 34.4 },
      drilldownSuggestions: ['cost.variable_cost', 'cost.claim_ratio'],
    },
  ],
  warnings: ['成本指标为项目内经营成本口径。'],
  forbiddenInterpretations: ['承保利润', '利润率'],
};

const growthResult = {
  capabilityId: 'growth_diagnosis',
  status: 'supported',
  requestedTools: ['growth.query'],
  summary: { declineCount: 1, highGrowthCount: 0 },
  diagnostics: [
    {
      dimKey: 'B机构',
      severity: 'warning_decline',
      growthRate: -18.2,
      direction: 'decline',
    },
  ],
  warnings: ['增长不是利润。'],
  forbiddenInterpretations: ['财务盈利', '财务亏损'],
  drilldownSuggestions: ['growth.query'],
};

const quietResult = (capabilityId: string) => ({
  capabilityId,
  status: 'supported',
  requestedTools: [],
  summary: {},
  diagnostics: [],
  warnings: [],
  forbiddenInterpretations: ['承保利润'],
  drilldownSuggestions: [],
});

describe('agent business patrol diagnosis workflow', () => {
  it('aggregates completed deterministic diagnoses into prioritized findings', async () => {
    const result = await runBusinessPatrolTasks(
      [
        makeTask('growth_diagnosis', growthResult),
        makeTask('cost_indicator_diagnosis', costResult),
        makeTask('quote_conversion_diagnosis', quietResult('quote_conversion_diagnosis')),
        makeTask('renewal_tracker_diagnosis', quietResult('renewal_tracker_diagnosis')),
        makeTask('claims_risk_diagnosis', quietResult('claims_risk_diagnosis')),
        makeTask('customer_flow_diagnosis', quietResult('customer_flow_diagnosis')),
      ],
      { timeoutMs: 1000, limit: 10 }
    );

    expect(result.capabilityId).toBe('business_patrol_diagnosis');
    expect(result.status).toBe('supported');
    expect(result.summary).toMatchObject({
      completedCount: 6,
      failedCount: 0,
      timeoutCount: 0,
      criticalCount: 1,
      warningCount: 1,
      topPriorityCapability: 'cost_indicator_diagnosis',
    });
    expect(result.prioritizedFindings[0]).toMatchObject({
      capabilityId: 'cost_indicator_diagnosis',
      severity: 'critical',
      affectedMetrics: ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'],
    });
    expect(result.prioritizedFindings[1]).toMatchObject({
      capabilityId: 'growth_diagnosis',
      severity: 'warning',
      affectedMetrics: ['signed_premium', 'policy_count', 'growth_rate'],
    });
    expect(result.warnings).toEqual(expect.arrayContaining(['成本指标为项目内经营成本口径。', '增长不是利润。']));
    expect(result.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
  });

  it('downgrades failed or timed-out subdiagnoses instead of failing the whole patrol', async () => {
    const result = await runBusinessPatrolTasks(
      [
        {
          capabilityId: 'growth_diagnosis',
          run: async () => {
            throw new Error('growth failed');
          },
        },
        makeTask('cost_indicator_diagnosis', costResult, 50),
      ],
      { timeoutMs: 10, limit: 10 }
    );

    expect(result.status).toBe('partial');
    expect(result.summary).toMatchObject({
      completedCount: 0,
      failedCount: 1,
      timeoutCount: 1,
    });
    expect(result.capabilityStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capabilityId: 'growth_diagnosis', status: 'failed' }),
        expect.objectContaining({ capabilityId: 'cost_indicator_diagnosis', status: 'timeout' }),
      ])
    );
    expect(result.warnings.join('\n')).toContain('growth_diagnosis 子诊断失败');
    expect(result.warnings.join('\n')).toContain('cost_indicator_diagnosis 子诊断超时');
    expect(result.warnings.join('\n')).not.toContain('growth failed');
    expect(result.warnings.join('\n')).not.toContain('timed out after');
    expect(result.capabilityStatuses.map((item) => item.error).join('\n')).not.toContain('growth failed');
    expect(result.capabilityStatuses.map((item) => item.error).join('\n')).not.toContain('timed out after');
  });

  it('keeps the implementation deterministic and route-scoped', () => {
    const serviceSource = readSource('server/src/agent/services/agent-business-patrol-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).toContain('Promise.all');
    expect(serviceSource).toContain('setTimeout');
    expect(serviceSource).toContain('business_patrol_diagnosis');
    expect(routeSource).toContain("'/business-patrol'");
    expect(routeSource).not.toContain("createDomainMiddleware('PolicyFact', 'ClaimsAgg', 'QuoteConversion', 'RenewalTracker', 'ClaimsDetail', 'CustomerFlow')");
    expect(routeSource).toContain("ensureBusinessPatrolDomains('ClaimsAgg')");
    expect(routeSource).toContain("ensureBusinessPatrolDomains('QuoteConversion')");
    expect(routeSource).toContain("ensureBusinessPatrolDomains('RenewalTracker')");
    expect(routeSource).toContain("ensureBusinessPatrolDomains('ClaimsDetail', 'ClaimsAgg')");
    expect(routeSource).toContain("ensureBusinessPatrolDomains('CustomerFlow')");
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(`${serviceSource}\n${routeSource}`).not.toContain('CURRENT_DATE');
    expect(serverRoutesSource).toContain("BUSINESS_PATROL: '/business-patrol'");
    expect(frontendRoutesSource).toContain("BUSINESS_PATROL: 'agent/diagnosis/business-patrol'");
  });

  it('serves the protected HTTP route and invokes deterministic subdiagnosis services', async () => {
    const runGrowthDiagnosis = vi.fn().mockResolvedValue(growthResult);
    const runCostIndicatorDiagnosis = vi.fn().mockResolvedValue(costResult);
    const runQuoteConversionDiagnosis = vi.fn().mockResolvedValue(quietResult('quote_conversion_diagnosis'));
    const runRenewalTrackerDiagnosis = vi.fn().mockResolvedValue(quietResult('renewal_tracker_diagnosis'));
    const runClaimsRiskDiagnosis = vi.fn().mockResolvedValue(quietResult('claims_risk_diagnosis'));
    const runCustomerFlowDiagnosis = vi.fn().mockResolvedValue(quietResult('customer_flow_diagnosis'));

    vi.doMock('../../server/src/agent/services/agent-growth-diagnosis-service.js', () => ({ runGrowthDiagnosis }));
    vi.doMock('../../server/src/agent/services/agent-cost-indicator-diagnosis-service.js', () => ({ runCostIndicatorDiagnosis }));
    vi.doMock('../../server/src/agent/services/agent-quote-conversion-diagnosis-service.js', () => ({ runQuoteConversionDiagnosis }));
    vi.doMock('../../server/src/agent/services/agent-renewal-tracker-diagnosis-service.js', () => ({ runRenewalTrackerDiagnosis }));
    vi.doMock('../../server/src/agent/services/agent-claims-risk-diagnosis-service.js', () => ({ runClaimsRiskDiagnosis }));
    vi.doMock('../../server/src/agent/services/agent-customer-flow-diagnosis-service.js', () => ({ runCustomerFlowDiagnosis }));

    const express = serverRequire('express');
    const jwt = serverRequire('jsonwebtoken');
    const [{ authConfig }, { errorHandler }, { default: agentDiagnosisRoutes }] =
      await Promise.all([
        import('../../server/src/config/auth.js'),
        import('../../server/src/middleware/error.js'),
        import('../../server/src/agent/routes/agent-diagnosis.js'),
      ]);

    const app = express();
    app.use(express.json());
    app.use('/api/agent/diagnosis', agentDiagnosisRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/diagnosis/business-patrol`;
      const body = {
        timeoutMs: 1000,
        diagnostics: {
          growth: {
            currentPeriod: { startDate: '2026-04-01', endDate: '2026-04-25' },
            baselinePeriod: { startDate: '2025-04-01', endDate: '2025-04-25' },
          },
          costIndicators: { cutoffDate: '2026-04-25' },
          quoteConversion: { filters: { dateStart: '2026-04-01', dateEnd: '2026-04-25' } },
          renewalTracker: { start: '2026-04-01', end: '2026-04-30', cutoff: '2026-04-25' },
          claimsRisk: { filters: { dateStart: '2026-04-01', dateEnd: '2026-04-25' } },
          customerFlow: { year: 2026 },
        },
      };

      const unauthorizedResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(unauthorizedResponse.status).toBe(401);

      const adminToken = jwt.sign(
        { userId: 'admin', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json() as {
        success: boolean;
        data: { capabilityId: string; summary: { completedCount: number } };
      };
      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.data.capabilityId).toBe('business_patrol_diagnosis');
      expect(payload.data.summary.completedCount).toBe(6);
      expect(runGrowthDiagnosis).toHaveBeenCalledTimes(1);
      expect(runCostIndicatorDiagnosis).toHaveBeenCalledTimes(1);
      expect(runQuoteConversionDiagnosis).toHaveBeenCalledTimes(1);
      expect(runRenewalTrackerDiagnosis).toHaveBeenCalledTimes(1);
      expect(runClaimsRiskDiagnosis).toHaveBeenCalledTimes(1);
      expect(runCustomerFlowDiagnosis).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });
});
