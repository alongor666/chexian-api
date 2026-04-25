import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import { diagnoseCostIndicatorRows } from '../../server/src/agent/services/agent-cost-indicator-diagnosis-service';

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

describe('agent cost indicator diagnosis workflow', () => {
  it('ranks variable cost anomalies and decomposes claim vs expense drivers', () => {
    const diagnosis = diagnoseCostIndicatorRows({
      cutoffDate: '2026-04-24',
      dimension: 'org_level_3',
      limit: 3,
      minPremium: 0,
      variableCostRows: [
        {
          dim_key: 'A机构',
          policy_count: 100,
          total_premium: 1000000,
          earned_premium: 800000,
          total_reported_claims: 720000,
          total_fee: 160000,
          earned_claim_ratio: 90,
          expense_ratio: 16,
          variable_cost_ratio: 106,
        },
        {
          dim_key: 'B机构',
          policy_count: 80,
          total_premium: 900000,
          earned_premium: 700000,
          total_reported_claims: 350000,
          total_fee: 315000,
          earned_claim_ratio: 50,
          expense_ratio: 35,
          variable_cost_ratio: 85,
        },
      ],
      claimRatioRows: [
        {
          dim_key: 'A机构',
          total_claim_cases: 12,
          avg_claim_amount: 60000,
          earned_loss_frequency: 13.5,
        },
      ],
      expenseRatioRows: [
        {
          dim_key: 'A机构',
          total_fee: 160000,
          expense_ratio: 16,
        },
      ],
    });

    expect(diagnosis.capabilityId).toBe('cost_indicator_diagnosis');
    expect(diagnosis.status).toBe('supported');
    expect(diagnosis.requestedTools).toEqual(['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio']);
    expect(diagnosis.anomalies[0]).toMatchObject({
      rank: 1,
      dimKey: 'A机构',
      severity: 'critical',
      primaryDriver: 'claim',
    });
    expect(diagnosis.anomalies[0]?.metrics.variableCostRatio).toBe(106);
    expect(diagnosis.anomalies[0]?.contribution.claimRatio).toBe(90);
    expect(diagnosis.anomalies[0]?.contribution.expenseRatio).toBe(16);
    expect(diagnosis.anomalies[0]?.drilldownSuggestions).toEqual(
      expect.arrayContaining(['customer_category', 'coverage_combination'])
    );
    expect(diagnosis.summary.highRiskCount).toBe(1);
    expect(diagnosis.warnings.join('')).toContain('项目内经营分析口径');
  });

  it('keeps profit and free-sql capabilities out of the deterministic workflow', () => {
    const serviceSource = readSource('server/src/agent/services/agent-cost-indicator-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const appSource = readSource('server/src/app.ts');
    const auditSource = readSource('server/src/middleware/audit.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(serviceSource).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(routeSource).toContain('router.use(authMiddleware);');
    expect(routeSource).toContain('router.use(permissionMiddleware);');
    expect(routeSource).toContain("createDomainMiddleware('ClaimsAgg')");
    expect(routeSource).toContain("'/cost-indicators'");
    expect(appSource).toContain("app.use('/api/agent/diagnosis', agentDiagnosisRoutes)");
    expect(appSource).toContain("app.use('/api/agent/diagnosis', queryLimiter)");
    expect(auditSource).toContain("'/api/agent/diagnosis'");
    expect(serverRoutesSource).toContain('AGENT_DIAGNOSIS_ROUTES');
    expect(frontendRoutesSource).toContain('agent/diagnosis/cost-indicators');
  });

  it('serves the protected HTTP route through auth, permission filters, and cost SQL generators', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        {
          dim_key: 'A机构',
          policy_count: 100,
          total_premium: 1000000,
          earned_premium: 800000,
          total_reported_claims: 720000,
          total_fee: 160000,
          earned_claim_ratio: 90,
          expense_ratio: 16,
          variable_cost_ratio: 106,
        },
      ])
      .mockResolvedValueOnce([
        {
          dim_key: 'A机构',
          total_claim_cases: 12,
          avg_claim_amount: 60000,
          earned_loss_frequency: 13.5,
        },
      ])
      .mockResolvedValueOnce([
        {
          dim_key: 'A机构',
          total_fee: 160000,
          expense_ratio: 16,
        },
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
      const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/cost-indicators`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cutoffDate: '2026-04-24',
          dimension: 'org_level_3',
        }),
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

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/cost-indicators`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cutoffDate: '2026-04-24',
          dimension: 'org_level_3',
          filters: {
            customerCategories: '非营业个人客车',
          },
        }),
      });

      const body = await response.json() as { success: boolean; data: { capabilityId: string; anomalies: Array<{ dimKey: string }> } };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('cost_indicator_diagnosis');
      expect(body.data.anomalies[0]?.dimKey).toBe('A机构');
      expect(queryMock).toHaveBeenCalledTimes(3);
      const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls.join('\n')).toContain("org_level_3 = 'A机构'");
      expect(sqlCalls.join('\n')).toContain("customer_category IN ('非营业个人客车')");
    } finally {
      await closeServer(server);
    }
  });
});
