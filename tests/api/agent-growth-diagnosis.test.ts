import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import { diagnoseGrowthRows } from '../../server/src/agent/services/agent-growth-diagnosis-service';

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

describe('agent growth diagnosis workflow', () => {
  it('diagnoses growth declines and contribution drivers without profit interpretation', () => {
    const diagnosis = diagnoseGrowthRows({
      currentPeriod: { startDate: '2026-04-01', endDate: '2026-04-24' },
      baselinePeriod: { startDate: '2025-04-01', endDate: '2025-04-24' },
      comparisonMode: 'custom',
      timeView: 'monthly',
      dimension: 'org_level_3',
      limit: 3,
      minCurrentValue: 0,
      comparisonRows: [
        { org_level_3: 'A机构', current_value: 1200, previous_value: 1000, growth_rate: 0.2 },
        { org_level_3: 'B机构', current_value: 700, previous_value: 1000, growth_rate: -0.3 },
        { org_level_3: 'C机构', current_value: 950, previous_value: 1000, growth_rate: -0.05 },
      ],
      dailyContextRows: [
        {
          time_period: '2026-04-24',
          current_value: 120,
          previous_value: 100,
          growth_rate: 0.2,
          period_growth_rate: 0.12,
          ytd_growth_rate: 0.08,
        },
      ],
    });

    expect(diagnosis.capabilityId).toBe('growth_diagnosis');
    expect(diagnosis.status).toBe('supported');
    expect(diagnosis.requestedTools).toEqual(['growth.query', 'growth.daily_context']);
    expect(diagnosis.summary.declineCount).toBe(2);
    expect(diagnosis.summary.topPositiveContributor).toBe('A机构');
    expect(diagnosis.summary.topNegativeContributor).toBe('B机构');
    expect(diagnosis.diagnostics[0]).toMatchObject({
      dimKey: 'B机构',
      severity: 'critical_decline',
      growthRate: -0.3,
      currentValue: 700,
      baselineValue: 1000,
      contributionAmount: -300,
    });
    expect(diagnosis.drilldownSuggestions).toEqual(
      expect.arrayContaining(['customer_category', 'coverage_combination'])
    );
    expect(diagnosis.warnings.join('')).toContain('增长诊断只解释保费规模和件数变化');
    expect(diagnosis.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
  });

  it('keeps LLM and free-sql capabilities out of the deterministic workflow', () => {
    const serviceSource = readSource('server/src/agent/services/agent-growth-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const appSource = readSource('server/src/app.ts');
    const auditSource = readSource('server/src/middleware/audit.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(serviceSource).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(routeSource).toContain('router.use(authMiddleware);');
    expect(routeSource).toContain('router.use(permissionMiddleware);');
    expect(routeSource).toContain("createDomainMiddleware('PolicyFact')");
    expect(routeSource).toContain("'/growth'");
    expect(routeSource).toContain('GrowthDiagnosisRequestSchema.parse(req.body)');
    expect(routeSource).toContain('GrowthDiagnosisResultSchema');
    expect(appSource).toContain("app.use('/api/agent/diagnosis', agentDiagnosisRoutes)");
    expect(appSource).toContain("app.use('/api/agent/diagnosis', queryLimiter)");
    expect(auditSource).toContain("'/api/agent/diagnosis'");
    expect(serverRoutesSource).toContain("GROWTH: '/growth'");
    expect(frontendRoutesSource).toContain("GROWTH: 'agent/diagnosis/growth'");
  });

  it('serves the protected HTTP route through auth, permission filters, and growth SQL generators', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { org_level_3: 'A机构', current_value: 1200, previous_value: 1000, growth_rate: 0.2 },
        { org_level_3: 'B机构', current_value: 700, previous_value: 1000, growth_rate: -0.3 },
      ])
      .mockResolvedValueOnce([
        {
          time_period: '2026-04-24',
          current_value: 120,
          previous_value: 100,
          growth_rate: 0.2,
          period_growth_rate: 0.12,
          ytd_growth_rate: 0.08,
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
      const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/growth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPeriod: { startDate: '2026-04-01', endDate: '2026-04-24' },
          baselinePeriod: { startDate: '2025-04-01', endDate: '2025-04-24' },
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

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/growth`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPeriod: { startDate: '2026-04-01', endDate: '2026-04-24' },
          baselinePeriod: { startDate: '2025-04-01', endDate: '2025-04-24' },
          comparisonMode: 'custom',
          timeView: 'monthly',
          dimension: 'org_level_3',
          includeDailyContext: true,
          filters: {
            customerCategories: '非营业个人客车',
          },
        }),
      });

      const body = await response.json() as {
        success: boolean;
        data: { capabilityId: string; diagnostics: Array<{ dimKey: string }> };
      };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('growth_diagnosis');
      expect(body.data.diagnostics[0]?.dimKey).toBe('B机构');
      expect(queryMock).toHaveBeenCalledTimes(2);
      const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls.join('\n')).toContain("org_level_3 = 'A机构'");
      expect(sqlCalls.join('\n')).toContain("customer_category IN ('非营业个人客车')");
    } finally {
      await closeServer(server);
    }
  });
});
