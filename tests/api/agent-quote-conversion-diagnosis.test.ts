import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Server } from 'http';

import { diagnoseQuoteConversionRows } from '../../server/src/agent/services/agent-quote-conversion-diagnosis-service';

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

describe('agent quote conversion diagnosis workflow', () => {
  it('diagnoses funnel bottlenecks, segment differences, and trend drops', () => {
    const diagnosis = diagnoseQuoteConversionRows({
      filters: { dateStart: '2026-04-01', dateEnd: '2026-04-24' },
      drilldownLevel: 'org',
      trendGranularity: 'week',
      limit: 3,
      kpiRow: {
        total_quotes: 1000,
        total_insured: 420,
        underwriting_rate: 42,
        avg_discount_rate: 0.88,
        renewal_quotes: 600,
        renewal_insured: 330,
        switch_quotes: 400,
        switch_insured: 90,
      },
      funnelRows: [
        { renewal_type: '续保', l1_total: 600, l2_valid: 540, l3_quality: 420, l4_insured: 330 },
        { renewal_type: '转保', l1_total: 400, l2_valid: 280, l3_quality: 160, l4_insured: 90 },
      ],
      drilldownRows: [
        { group_key: 'A机构', group_name: 'A机构', total_quotes: 500, total_insured: 260, underwriting_rate: 52, renewal_rate: 60, switch_rate: 28 },
        { group_key: 'B机构', group_name: 'B机构', total_quotes: 300, total_insured: 72, underwriting_rate: 24, renewal_rate: 35, switch_rate: 12 },
      ],
      trendRows: [
        { time_bucket: '2026-W14', renewal_type: '续保', total_quotes: 100, total_insured: 55, underwriting_rate: 55 },
        { time_bucket: '2026-W15', renewal_type: '续保', total_quotes: 100, total_insured: 38, underwriting_rate: 38 },
      ],
    });

    expect(diagnosis.capabilityId).toBe('quote_conversion_diagnosis');
    expect(diagnosis.status).toBe('supported');
    expect(diagnosis.requestedTools).toEqual([
      'quote_conversion.kpi',
      'quote_conversion.funnel',
      'quote_conversion.drilldown',
      'quote_conversion.trend',
    ]);
    expect(diagnosis.summary).toMatchObject({
      totalQuotes: 1000,
      totalInsured: 420,
      underwritingRate: 42,
      worstSegment: 'B机构',
    });
    expect(diagnosis.funnelBottlenecks[0]).toMatchObject({
      renewalType: '转保',
      stage: 'valid_to_quality',
      dropRate: 42.8571,
    });
    expect(diagnosis.segmentDifferences[0]).toMatchObject({
      dimKey: 'B机构',
      underwritingRate: 24,
      severity: 'critical',
    });
    expect(diagnosis.trendAnomalies[0]).toMatchObject({
      timeBucket: '2026-W15',
      renewalType: '续保',
      rateChange: -17,
      severity: 'warning',
    });
    expect(diagnosis.warnings.join('')).toContain('报价转化诊断不代表利润');
    expect(diagnosis.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['承保利润', '利润率', '财务盈利', '财务亏损'])
    );
  });

  it('flags negative funnel drops as critical and adds a data-anomaly warning', () => {
    const diagnosis = diagnoseQuoteConversionRows({
      filters: {},
      drilldownLevel: 'org',
      trendGranularity: 'week',
      limit: 5,
      kpiRow: { total_quotes: 100, total_insured: 50, underwriting_rate: 50 },
      funnelRows: [
        { renewal_type: '续保', l1_total: 100, l2_valid: 120, l3_quality: 100, l4_insured: 80 },
      ],
      drilldownRows: [],
      trendRows: [],
    });

    const negative = diagnosis.funnelBottlenecks.find((b) => b.stage === 'total_to_valid');
    expect(negative?.severity).toBe('critical');
    expect((negative?.dropRate ?? 0) < 0).toBe(true);
    expect(diagnosis.warnings.join('\n')).toContain('漏斗下游环节计数大于上游');
  });

  it('keeps out excluded quote sub-routes, LLM, and free SQL', () => {
    const serviceSource = readSource('server/src/agent/services/agent-quote-conversion-diagnosis-service.ts');
    const routeSource = readSource('server/src/agent/routes/agent-diagnosis.ts');
    const serverRoutesSource = readSource('server/src/config/api-routes.ts');
    const frontendRoutesSource = readSource('src/shared/api/routes.ts');

    expect(serviceSource).toContain('generateQuoteKpiQuery');
    expect(serviceSource).toContain('generateQuoteFunnelQuery');
    expect(serviceSource).toContain('generateQuoteDrilldownQuery');
    expect(serviceSource).toContain('generateQuoteTrendQuery');
    expect(serviceSource).not.toContain('generateQuoteHeatmapQuery');
    expect(serviceSource).not.toContain('generateQuotePriceQuery');
    expect(serviceSource).not.toContain('generateQuoteRankingQuery');
    expect(serviceSource).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(serviceSource).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(routeSource).toContain("createDomainMiddleware('QuoteConversion')");
    expect(routeSource).toContain("'/quote-conversion'");
    expect(serverRoutesSource).toContain("QUOTE_CONVERSION: '/quote-conversion'");
    expect(frontendRoutesSource).toContain("QUOTE_CONVERSION: 'agent/diagnosis/quote-conversion'");
  });

  it('serves the protected HTTP route with auth and role-derived quote filters', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { total_quotes: 1000, total_insured: 420, underwriting_rate: 42, avg_discount_rate: 0.88 },
      ])
      .mockResolvedValueOnce([
        { renewal_type: '续保', l1_total: 600, l2_valid: 540, l3_quality: 420, l4_insured: 330 },
      ])
      .mockResolvedValueOnce([
        { group_key: 'A机构', group_name: 'A机构', total_quotes: 500, total_insured: 260, underwriting_rate: 52 },
      ])
      .mockResolvedValueOnce([
        { time_bucket: '2026-W15', renewal_type: '续保', total_quotes: 100, total_insured: 38, underwriting_rate: 38 },
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
      const unauthorizedResponse = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/quote-conversion`, {
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

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/quote-conversion`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            dateStart: '2026-04-01',
            dateEnd: '2026-04-24',
            customerCategory: '非营业个人客车',
          },
          drilldownLevel: 'org',
          trendGranularity: 'week',
        }),
      });

      const body = await response.json() as {
        success: boolean;
        data: { capabilityId: string; summary: { totalQuotes: number } };
      };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.capabilityId).toBe('quote_conversion_diagnosis');
      expect(body.data.summary.totalQuotes).toBe(1000);
      expect(queryMock).toHaveBeenCalledTimes(4);
      const sqlCalls = queryMock.mock.calls.map(([sql]) => String(sql));
      expect(sqlCalls.join('\n')).toContain("org_level_3 = 'A机构'");
      expect(sqlCalls.join('\n')).toContain("customer_category = '非营业个人客车'");
    } finally {
      await closeServer(server);
    }
  });

  it('rejects requests with dateStart later than dateEnd', async () => {
    const queryMock = vi.fn();
    vi.doMock('../../server/src/services/duckdb.js', () => ({
      duckdbService: { query: queryMock },
    }));

    const express = serverRequire('express');
    const jwt = serverRequire('jsonwebtoken');
    const [{ authConfig }, { errorHandler }, { default: agentDiagnosisRoutes }] = await Promise.all([
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
      const token = jwt.sign(
        { userId: 'u1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/diagnosis/quote-conversion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { dateStart: '2026-04-30', dateEnd: '2026-04-01' },
        }),
      });
      expect(response.status).toBe(400);
      expect(queryMock).not.toHaveBeenCalled();
      const body = await response.json() as { error?: { message?: string } };
      expect(JSON.stringify(body)).toMatch(/Invalid filters\.date range/);
    } finally {
      await closeServer(server);
    }
  });
});
