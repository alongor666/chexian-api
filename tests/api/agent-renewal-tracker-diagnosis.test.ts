import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import { diagnoseRenewalTrackerRows } from '../../server/src/agent/services/agent-renewal-tracker-diagnosis-service';

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

describe('agent renewal tracker diagnosis workflow', () => {
  it('diagnoses renewal tracker overview, weak segments, and dimension risks', () => {
    const diagnosis = diagnoseRenewalTrackerRows({
      start: '2026-04-01',
      end: '2026-04-30',
      cutoff: '2026-04-24',
      filters: { orgNames: ['A机构'] },
      limit: 3,
      rows: [
        { row_level: 'overall', org_level_3: null, team_name: null, salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 1000, B: 650, C: 420 },
        { row_level: 'org', org_level_3: 'A机构', team_name: null, salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 500, B: 260, C: 140 },
        { row_level: 'org', org_level_3: 'B机构', team_name: null, salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 300, B: 240, C: 180 },
        { row_level: 'team', org_level_3: 'A机构', team_name: '一队', salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 200, B: 90, C: 42 },
        { row_level: 'overall_category', org_level_3: null, team_name: null, salesman_name: null, customer_category: '营业货车', coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 180, B: 70, C: 30 },
        { row_level: 'overall_fuel', org_level_3: null, team_name: null, salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: '电', used_transfer_type: null, renewal_type: null, A: 220, B: 170, C: 120 },
      ],
      meta: {
        exposure_row_count: 1200,
        distinct_vehicle_count: 1000,
        distinct_source_policy_count: 980,
        latest_data_date: '2026-04-24',
      },
    });

    expect(diagnosis.capabilityId).toBe('renewal_tracker_diagnosis');
    expect(diagnosis.status).toBe('supported');
    expect(diagnosis.requestedTools).toEqual(['renewal_tracker.query']);
    expect(diagnosis.summary).toMatchObject({
      expectedRenewalCount: 1000,
      quotedCount: 650,
      renewedCount: 420,
      quoteRate: 65,
      renewalRate: 42,
      quoteToRenewalRate: 64.6154,
      quoteGap: 350,
      renewalGap: 580,
      latestDataDate: '2026-04-24',
    });
    expect(diagnosis.segmentDiagnostics[0]).toMatchObject({
      level: 'team',
      dimKey: 'A机构 / 一队',
      renewalRate: 21,
      severity: 'critical',
    });
    expect(diagnosis.dimensionDiagnostics[0]).toMatchObject({
      dimension: 'customer_category',
      dimKey: '营业货车',
      renewalRate: 16.6667,
      severity: 'critical',
    });
    expect(diagnosis.cutoffExplanation).toContain('expiry_date');
    expect(diagnosis.cutoffExplanation).toContain('cutoff=2026-04-24');
    expect(diagnosis.warnings.join('')).toContain('不使用已下线 renewal funnel/v2');
    expect(diagnosis.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
  });

  it('keeps out deprecated renewal funnel/v2, LLM, and free SQL', () => {
    const serviceSource = readSource('server/src/agent/services/agent-renewal-tracker-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).toContain('generateRenewalTrackerQuery');
    expect(serviceSource).toContain('generateRenewalTrackerMetaQuery');
    expect(serviceSource).not.toMatch(/renewal[-_]?funnel|renewal[-_]?v2/i);
    expect(routeSource).not.toMatch(/renewal[-_]?funnel|renewal[-_]?v2/i);
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(`${serviceSource}\n${routeSource}`).not.toContain('CURRENT_DATE');
    expect(routeSource).toContain("createDomainMiddleware('RenewalTracker')");
    expect(routeSource).toContain("'/renewal-tracker'");
    expect(serverRoutesSource).toContain("RENEWAL_TRACKER: '/renewal-tracker'");
    expect(frontendRoutesSource).toContain("RENEWAL_TRACKER: 'agent/diagnosis/renewal-tracker'");
  });

  it('serves the protected HTTP route with auth and renewal tracker filters', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { row_level: 'overall', org_level_3: null, team_name: null, salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 1000, B: 650, C: 420 },
        { row_level: 'org', org_level_3: 'A机构', team_name: null, salesman_name: null, customer_category: null, coverage_combination: null, fuel_category: null, used_transfer_type: null, renewal_type: null, A: 500, B: 260, C: 140 },
      ])
      .mockResolvedValueOnce([
        { exposure_row_count: 1200, distinct_vehicle_count: 1000, distinct_source_policy_count: 980, latest_data_date: '2026-04-24' },
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
      const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/renewal-tracker`, {
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

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/renewal-tracker`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: '2026-04-01',
          end: '2026-04-30',
          cutoff: '2026-04-24',
          filters: {
            customerCategories: ['非营业个人客车'],
            coverageCombinations: ['主全'],
            isRenewal: true,
          },
        }),
      });

      const body = await response.json() as {
        success: boolean;
        data: { capabilityId: string; summary: { expectedRenewalCount: number } };
      };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('renewal_tracker_diagnosis');
      expect(body.data.summary.expectedRenewalCount).toBe(1000);
      expect(queryMock).toHaveBeenCalledTimes(2);
      const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls[0]).toContain("org_level_3 = 'A机构'");
      expect(sqlCalls[0]).toContain("customer_category IN ('非营业个人客车')");
      expect(sqlCalls[0]).toContain("coverage_combination IN ('主全')");
      expect(sqlCalls[0]).toContain('is_renewal = true');
    } finally {
      await closeServer(server);
    }
  });
});
