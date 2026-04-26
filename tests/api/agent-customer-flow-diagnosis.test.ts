import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import { diagnoseCustomerFlowRows } from '../../server/src/agent/services/agent-customer-flow-diagnosis-service';

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

describe('agent customer flow diagnosis workflow', () => {
  it('diagnoses inflow, outflow, trend direction, and data readiness', () => {
    const diagnosis = diagnoseCustomerFlowRows({
      filters: { year: 2026 },
      limit: 2,
      summaryRow: {
        total_policies: 1000,
        has_previous: 800,
        inflow_count: 200,
        has_next: 700,
        outflow_count: 250,
        self_renewal_count: 500,
      },
      inflowRows: [
        { insurer: 'A保险', policy_count: 120, share_pct: 60 },
        { insurer: 'B保险', policy_count: 80, share_pct: 40 },
      ],
      outflowRows: [
        { insurer: 'X保险', policy_count: 150, share_pct: 60 },
        { insurer: 'Y保险', policy_count: 100, share_pct: 40 },
      ],
      trendRows: [
        { month: '2026-01', total_policies: 400, inflow_count: 80, outflow_count: 60 },
        { month: '2026-02', total_policies: 300, inflow_count: 50, outflow_count: 100 },
        { month: '2026-03', total_policies: 300, inflow_count: 70, outflow_count: 90 },
      ],
      metadataRow: {
        min_date: '2026-01-01',
        max_date: '2026-03-31',
        years: [2026],
        total_rows: 1000,
      },
    });

    expect(diagnosis.capabilityId).toBe('customer_flow_diagnosis');
    expect(diagnosis.status).toBe('supported');
    expect(diagnosis.requestedTools).toEqual([
      'customer_flow.summary',
      'customer_flow.inflow',
      'customer_flow.outflow',
      'customer_flow.trend',
      'customer_flow.metadata',
    ]);
    expect(diagnosis.summary).toMatchObject({
      totalPolicies: 1000,
      inflowCount: 200,
      outflowCount: 250,
      netFlow: -50,
      inflowRate: 20,
      outflowRate: 25,
      selfRenewalCount: 500,
      topInflowInsurer: 'A保险',
      topOutflowInsurer: 'X保险',
      latestMonth: '2026-03',
      latestNetFlow: -20,
    });
    expect(diagnosis.dataReadiness).toMatchObject({
      minDate: '2026-01-01',
      maxDate: '2026-03-31',
      totalRows: 1000,
      status: 'ready',
    });
    expect(diagnosis.diagnostics[0]).toMatchObject({
      kind: 'flow_balance',
      severity: 'warning',
      message: '客户净流出 50 件',
    });
    expect(diagnosis.inflowDiagnostics[0]).toMatchObject({ insurer: 'A保险', policyCount: 120, sharePct: 60 });
    expect(diagnosis.outflowDiagnostics[0]).toMatchObject({ insurer: 'X保险', policyCount: 150, sharePct: 60 });
    expect(diagnosis.trendDiagnostics.at(-1)).toMatchObject({ month: '2026-03', netFlow: -20, direction: 'net_outflow' });
    expect(diagnosis.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
  });

  it('marks data readiness empty when requested year is outside metadata years', () => {
    const diagnosis = diagnoseCustomerFlowRows({
      filters: { year: 2030 },
      limit: 2,
      summaryRow: {
        total_policies: 0,
        has_previous: 0,
        inflow_count: 0,
        has_next: 0,
        outflow_count: 0,
        self_renewal_count: 0,
      },
      inflowRows: [],
      outflowRows: [],
      trendRows: [],
      metadataRow: {
        min_date: '2026-01-01',
        max_date: '2026-03-31',
        years: [2026],
        total_rows: 1000,
      },
    });

    expect(diagnosis.filters).toEqual({ year: 2030 });
    expect(diagnosis.summary.netFlow).toBe(0);
    expect(diagnosis.dataReadiness).toMatchObject({
      years: [2026],
      totalRows: 0,
      status: 'empty',
    });
  });

  it('keeps the implementation deterministic and scoped to customer-flow tools', () => {
    const serviceSource = readSource('server/src/agent/services/agent-customer-flow-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const toolsSource = readSource('server/src/agent/tools/tool-registry.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).toContain('generateFlowSummaryQuery');
    expect(serviceSource).toContain('generateInflowQuery');
    expect(serviceSource).toContain('generateOutflowQuery');
    expect(serviceSource).toContain('generateFlowTrendQuery');
    expect(serviceSource).toContain('generateFlowMetadataQuery');
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(`${serviceSource}\n${routeSource}`).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(`${serviceSource}\n${routeSource}`).not.toContain('CURRENT_DATE');
    expect(routeSource).toContain("createDomainMiddleware('CustomerFlow')");
    expect(routeSource).toContain("'/customer-flow'");
    expect(toolsSource).toContain("id: 'customer_flow.metadata'");
    expect(serverRoutesSource).toContain("CUSTOMER_FLOW: '/customer-flow'");
    expect(frontendRoutesSource).toContain("CUSTOMER_FLOW: 'agent/diagnosis/customer-flow'");
  });

  it('serves the protected HTTP route for branch admins and rejects org scoped users', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { total_policies: 1000, has_previous: 800, inflow_count: 200, has_next: 700, outflow_count: 250, self_renewal_count: 500 },
      ])
      .mockResolvedValueOnce([{ insurer: 'A保险', policy_count: 120, share_pct: 60 }])
      .mockResolvedValueOnce([{ insurer: 'X保险', policy_count: 150, share_pct: 60 }])
      .mockResolvedValueOnce([{ month: '2026-03', total_policies: 300, inflow_count: 70, outflow_count: 90 }])
      .mockResolvedValueOnce([{ min_date: '2026-01-01', max_date: '2026-03-31', years: [2026], total_rows: 1000 }]);

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
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/diagnosis/customer-flow`;

      const unauthorizedResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: 2026 }),
      });
      expect(unauthorizedResponse.status).toBe(401);
      expect(queryMock).not.toHaveBeenCalled();

      const orgToken = jwt.sign(
        { userId: 'u1', username: 'org-user', role: 'org_user', organization: 'A机构' },
        authConfig.jwtSecret
      );
      const forbiddenResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: 2026 }),
      });
      expect(forbiddenResponse.status).toBe(403);
      expect(queryMock).not.toHaveBeenCalled();

      const adminToken = jwt.sign(
        { userId: 'admin', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: 2026, limit: 5 }),
      });

      const body = await response.json() as {
        success: boolean;
        data: { capabilityId: string; summary: { netFlow: number } };
      };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('customer_flow_diagnosis');
      expect(body.data.summary.netFlow).toBe(-50);
      expect(queryMock).toHaveBeenCalledTimes(5);
      const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls.slice(0, 4).join('\n')).toContain('YEAR(CAST(insurance_start_date AS DATE)) = 2026');
    } finally {
      await closeServer(server);
    }
  });
});
