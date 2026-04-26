import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import { diagnoseClaimsRiskRows } from '../../server/src/agent/services/agent-claims-risk-diagnosis-service';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../server/src/services/duckdb.js');
});

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

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

describe('agent claims risk diagnosis workflow', () => {
  it('diagnoses pending risk, cause risk, and frequency yoy movement', () => {
    const diagnosis = diagnoseClaimsRiskRows({
      filters: { dateStart: '2026-01-01', dateEnd: '2026-04-24', orgName: 'A机构' },
      limit: 3,
      pendingOverviewRows: [
        { claim_status: '未业务结案', cases: 120, reserve_wan: 360, avg_reserve: 30000, injury_cases: 18, injury_reserve_wan: 120, bodily_wan: 90, vehicle_wan: 240, property_wan: 30 },
        { claim_status: '已业务结案', cases: 880, reserve_wan: 900, avg_reserve: 10227, injury_cases: 22, injury_reserve_wan: 160, bodily_wan: 150, vehicle_wan: 690, property_wan: 60 },
      ],
      causeRows: [
        { accident_cause: '碰撞', cases: 520, reserve_wan: 760, avg_reserve: 14615, injury_cases: 20, injury_pct: 3.8 },
        { accident_cause: '单方事故', cases: 140, reserve_wan: 420, avg_reserve: 30000, injury_cases: 28, injury_pct: 20 },
      ],
      frequencyRows: [
        { year: 2025, quarter: 1, claim_count: 100, injury_count: 5, reserve_wan: 200, policy_count: 10000, freq_per_1000: 10, injury_pct: 5 },
        { year: 2026, quarter: 1, claim_count: 160, injury_count: 12, reserve_wan: 380, policy_count: 10000, freq_per_1000: 16, injury_pct: 7.5 },
      ],
    });

    expect(diagnosis.capabilityId).toBe('claims_risk_diagnosis');
    expect(diagnosis.status).toBe('supported');
    expect(diagnosis.requestedTools).toEqual([
      'claims_detail.pending_overview',
      'claims_detail.cause_analysis',
      'claims_detail.frequency_yoy',
    ]);
    expect(diagnosis.summary).toMatchObject({
      totalCases: 1000,
      pendingCases: 120,
      pendingReserveWan: 360,
      pendingCaseShare: 12,
      topCause: '碰撞',
      latestFrequencyPer1000: 16,
      latestFrequencyYoyChange: 6,
    });
    expect(diagnosis.pendingRisk).toMatchObject({
      pendingCases: 120,
      pendingReserveWan: 360,
      injuryCases: 18,
      severity: 'warning',
    });
    expect(diagnosis.causeDiagnostics[0]).toMatchObject({
      accidentCause: '单方事故',
      avgReserve: 30000,
      injuryPct: 20,
      severity: 'critical',
    });
    expect(diagnosis.frequencyDiagnostics[0]).toMatchObject({
      period: '2026-Q1',
      freqPer1000: 16,
      yoyChange: 6,
      severity: 'warning',
    });
    expect(diagnosis.warnings.join('')).toContain('ClaimsDetail 是当前快照视图');
    expect(diagnosis.warnings.join('')).toContain('不代表完整准备金、IBNR');
    expect(diagnosis.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
  });

  it('keeps out excluded claims sub-routes, LLM, and free SQL', () => {
    const serviceSource = readSource('server/src/agent/services/agent-claims-risk-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).toContain('generatePendingOverviewQuery');
    expect(serviceSource).toContain('generateCauseAnalysisQuery');
    expect(serviceSource).toContain('generateFrequencyYoyQuery');
    expect(serviceSource).not.toContain('generatePendingByOrgQuery');
    expect(serviceSource).not.toContain('generatePendingAgingQuery');
    expect(serviceSource).not.toContain('generateGeoRiskByAccidentQuery');
    expect(serviceSource).not.toContain('generateGeoRiskByPlateQuery');
    expect(serviceSource).not.toContain('generateGeoComparisonQuery');
    expect(serviceSource).not.toContain('generateClaimCycleQuery');
    expect(serviceSource).not.toContain('generateLossRatioDevelopmentQuery');
    expect(serviceSource).not.toContain('generateClaimsHeatmapQuery');
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(`${serviceSource}\n${routeSource}`).not.toContain('CURRENT_DATE');
    expect(routeSource).toContain("createDomainMiddleware('ClaimsDetail', 'ClaimsAgg')");
    expect(routeSource).toContain("'/claims-risk'");
    expect(serverRoutesSource).toContain("CLAIMS_RISK: '/claims-risk'");
    expect(frontendRoutesSource).toContain("CLAIMS_RISK: 'agent/diagnosis/claims-risk'");
  });

  it('serves the protected HTTP route with auth and org permission converted to ClaimsDetail filters', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { claim_status: '未业务结案', cases: 120, reserve_wan: 360, avg_reserve: 30000, injury_cases: 18, injury_reserve_wan: 120 },
      ])
      .mockResolvedValueOnce([
        { accident_cause: '碰撞', cases: 520, reserve_wan: 760, avg_reserve: 14615, injury_cases: 20, injury_pct: 3.8 },
      ])
      .mockResolvedValueOnce([
        { year: 2026, quarter: 1, claim_count: 160, injury_count: 12, reserve_wan: 380, policy_count: 10000, freq_per_1000: 16, injury_pct: 7.5 },
      ]);

    vi.doMock('../../server/src/services/duckdb.js', () => ({
      duckdbService: {
        query: queryMock,
      },
    }));

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
      const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/claims-risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(unauthorizedResponse.status).toBe(401);
      expect(queryMock).not.toHaveBeenCalled();

      const token = jwt.sign(
        {
          userId: 'u1',
          username: 'org-user',
          role: 'org_user',
          organization: 'A机构',
        },
        authConfig.jwtSecret
      );

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/claims-risk`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            dateStart: '2026-01-01',
            dateEnd: '2026-04-24',
            accidentCause: "碰撞'测试",
            customerCategory: '非营业个人客车',
            coverageCombination: '主全',
          },
        }),
      });

      const body = await response.json() as {
        success: boolean;
        data: { capabilityId: string; summary: { pendingCases: number } };
      };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('claims_risk_diagnosis');
      expect(body.data.summary.pendingCases).toBe(120);
      expect(queryMock).toHaveBeenCalledTimes(3);
      const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls.join('\n')).toContain("c.accident_cause = '碰撞''测试'");
      expect(sqlCalls.join('\n')).toContain("p.org_level_3 = 'A机构'");
      expect(sqlCalls.join('\n')).toContain("p.customer_category = '非营业个人客车'");
      expect(sqlCalls.join('\n')).toContain("p.coverage_combination = '主全'");
    } finally {
      await closeServer(server);
    }
  });
});
