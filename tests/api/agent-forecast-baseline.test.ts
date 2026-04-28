/**
 * Agent forecast baseline service tests
 *
 * Covers:
 *  - computePercentile: edge cases (empty, single, even, odd, sub-cent)
 *  - service path: actual aggregation + cohort/yoy/recent percentiles + permission filter pass-through
 *  - HTTP integration: 401 unauth, 200 wrapped success, Zod rejection
 *  - SQL safety: source-level scan that the SQL helpers do not introduce
 *    LLM/NL2SQL/free-form/CURRENT_DATE patterns
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Server } from 'http';

import { computePercentile } from '../../server/src/agent/services/agent-forecast-baseline-service';

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../server/src/services/duckdb.js');
});

describe('agent forecast baseline — percentile math', () => {
  it('returns 0 for empty input', () => {
    expect(computePercentile([], 25)).toBe(0);
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 75)).toBe(0);
  });

  it('returns the single value when input has length 1', () => {
    expect(computePercentile([42.5], 25)).toBe(42.5);
    expect(computePercentile([42.5], 50)).toBe(42.5);
    expect(computePercentile([42.5], 75)).toBe(42.5);
  });

  it('linear-interpolates between samples', () => {
    // sorted: [10, 20, 30, 40, 50]
    // p50 (rank=2.0) = 30; p25 (rank=1.0) = 20; p75 (rank=3.0) = 40
    expect(computePercentile([50, 10, 30, 40, 20], 25)).toBeCloseTo(20, 4);
    expect(computePercentile([50, 10, 30, 40, 20], 50)).toBeCloseTo(30, 4);
    expect(computePercentile([50, 10, 30, 40, 20], 75)).toBeCloseTo(40, 4);
  });

  it('interpolates non-integer ranks', () => {
    // sorted: [78, 82, 90]; p50 = 82 (rank=1.0), p25 = 80 (rank=0.5)
    expect(computePercentile([78, 82, 90], 25)).toBeCloseTo(80, 4);
    expect(computePercentile([78, 82, 90], 50)).toBeCloseTo(82, 4);
    expect(computePercentile([78, 82, 90], 75)).toBeCloseTo(86, 4);
  });

  it('ignores non-finite values gracefully', () => {
    expect(computePercentile([10, NaN, 30], 50)).toBeCloseTo(20, 4);
  });
});

describe('agent forecast baseline — service composition', () => {
  it('aggregates actuals, derives percentiles, and propagates V3 = V1 history default', async () => {
    vi.doMock('../../server/src/services/duckdb.js', () => {
      const queries: string[] = [];
      const fixture = [
        // actual
        [
          {
            signed_premium: 21380,
            earned_premium: 10094,
            cumulative_reported_claims: 7924,
            cumulative_fee: 2950,
            total_exposure_days: 50000n,
            policy_count: 1234n,
          },
        ],
        // cohorts (history loss ratio)
        [
          { signing_year: 2023n, year_premium: 18000, year_claims: 14040, year_loss_ratio_pct: 78 },
          { signing_year: 2024n, year_premium: 19500, year_claims: 15990, year_loss_ratio_pct: 82 },
          { signing_year: 2025n, year_premium: 21000, year_claims: 18900, year_loss_ratio_pct: 90 },
        ],
        // yoy
        [
          { year: 2022n, year_premium: 16000, prev_year_premium: null, yoy_growth_pct: null },
          { year: 2023n, year_premium: 18000, prev_year_premium: 16000, yoy_growth_pct: 12.5 },
          { year: 2024n, year_premium: 19500, prev_year_premium: 18000, yoy_growth_pct: 8.33 },
          { year: 2025n, year_premium: 21000, prev_year_premium: 19500, yoy_growth_pct: 7.69 },
        ],
        // recent expense
        [
          {
            recent_signed_premium: 5500,
            recent_fee: 770,
            recent_expense_ratio_pct: 14,
            recent_policy_count: 320n,
          },
        ],
      ];
      let call = 0;
      const queryFn = vi.fn(async (sql: string) => {
        queries.push(sql);
        return fixture[call++] ?? [];
      });
      return {
        duckdbService: { query: queryFn },
        __queries: queries,
      };
    });

    const { buildForecastBaseline } = await import('../../server/src/agent/services/agent-forecast-baseline-service.js');

    const result = await buildForecastBaseline({
      request: {
        cutoffDate: '2026-04-28',
        filters: { orgLevel3: ['机构A'] },
        historyWindowYears: 3,
        recentExpenseMonths: 6,
      },
      permissionFilter: '1=1',
    });

    expect(result.success).toBe(true);
    expect(result.data.actual.signedPremium).toBe(21380);
    expect(result.data.actual.earnedPremium).toBe(10094);
    expect(result.data.actual.earnedRatioPct).toBeCloseTo(47.21, 2);
    expect(result.data.actual.earnedClaimRatioPct).toBeCloseTo(78.5, 1);
    expect(result.data.actual.feeRatioPct).toBeCloseTo(13.8, 1);
    expect(result.data.actual.remainingExposure).toBeCloseTo(11286, 0);

    // V1 percentiles from cohorts [78, 82, 90]
    const v1 = result.data.variables.historicalLossRatio;
    expect(v1.cohortCount).toBe(3);
    expect(v1.percentiles.p25).toBeCloseTo(80, 4);
    expect(v1.percentiles.p50).toBeCloseTo(82, 4);
    expect(v1.percentiles.p75).toBeCloseTo(86, 4);

    // V2 from non-null growths [12.5, 8.33, 7.69]
    const v2 = result.data.variables.newSigningPremiumGrowth;
    expect(v2.sampleCount).toBe(3);
    expect(v2.percentiles.p25).toBeCloseTo(8.01, 1);
    expect(v2.percentiles.p50).toBeCloseTo(8.33, 2);

    // V3 default = V1 history (until user overrides on the frontend)
    const v3 = result.data.variables.newSigningLossRatio;
    expect(v3.percentiles).toEqual(v1.percentiles);

    // V4 mean from recent
    const v4 = result.data.variables.newSigningExpenseRatio;
    expect(v4.meanExpenseRatioPct).toBe(14);
    expect(v4.windowMonths).toBe(6);

    // Defaults exposed
    expect(result.data.defaults.v1HistoricalLossRatio).toEqual(v1.percentiles);
    expect(result.data.defaults.v3NewSigningLossRatio).toEqual(v1.percentiles);
    expect(result.data.defaults.v4NewSigningExpenseRatio).toBe(14);

    // Forbidden interpretations always present
    expect(result.data.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['财务报表利润', '法定承保利润', '审计利润', '承保利润'])
    );
    // Warnings include scenario disclaimer + V3-V1 sourcing note
    expect(result.data.warnings.join('\n')).toContain('不是财务报表利润');
    expect(result.data.warnings.join('\n')).toContain('V3 新签业务终极赔付率默认与 V1 同源');
  });

  it('passes the permission filter into the SQL where clause', async () => {
    const observed: string[] = [];
    vi.doMock('../../server/src/services/duckdb.js', () => ({
      duckdbService: {
        query: vi.fn(async (sql: string) => {
          observed.push(sql);
          return [];
        }),
      },
    }));
    const { buildForecastBaseline } = await import('../../server/src/agent/services/agent-forecast-baseline-service.js');

    await buildForecastBaseline({
      request: {
        cutoffDate: '2026-04-28',
        filters: {},
        historyWindowYears: 3,
        recentExpenseMonths: 6,
      },
      permissionFilter: "org_level_3 = 'XYZ'",
    });

    // 4 SQL queries fired (actual / cohorts / yoy / recent), all must include the permission clause.
    expect(observed).toHaveLength(4);
    for (const sql of observed) {
      expect(sql).toContain("org_level_3 = 'XYZ'");
    }
  });

  it('emits a warning when historical samples are empty', async () => {
    vi.doMock('../../server/src/services/duckdb.js', () => ({
      duckdbService: { query: vi.fn(async () => []) },
    }));

    const { buildForecastBaseline } = await import('../../server/src/agent/services/agent-forecast-baseline-service.js');

    const result = await buildForecastBaseline({
      request: {
        cutoffDate: '2026-04-28',
        filters: {},
        historyWindowYears: 3,
        recentExpenseMonths: 6,
      },
      permissionFilter: '1=1',
    });

    expect(result.data.variables.historicalLossRatio.cohortCount).toBe(0);
    expect(result.data.variables.newSigningPremiumGrowth.sampleCount).toBe(0);
    expect(result.data.warnings.join('\n')).toContain('未在历史窗口内找到非零保费的赔付率样本');
    expect(result.data.warnings.join('\n')).toContain('YoY 同期样本不足');
  });
});

describe('agent forecast baseline — HTTP route', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const express = serverRequire('express');
    const { errorHandler } = await import('../../server/src/middleware/error.js');
    const { default: agentForecastRoutes } = await import('../../server/src/agent/routes/agent-forecast.js');

    const app = express();
    app.use(express.json());
    app.use('/api/agent/forecast', agentForecastRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/forecast/baseline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(401);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects malformed cutoffDate with 400', async () => {
    const jwt = serverRequire('jsonwebtoken');
    vi.doMock('../../server/src/services/duckdb.js', () => ({
      duckdbService: { query: vi.fn(async () => []) },
    }));
    const express = serverRequire('express');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const { errorHandler } = await import('../../server/src/middleware/error.js');
    const { default: agentForecastRoutes } = await import('../../server/src/agent/routes/agent-forecast.js');

    const app = express();
    app.use(express.json());
    app.use('/api/agent/forecast', agentForecastRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

      const token = jwt.sign({ userId: 'u1', username: 'admin', role: 'branch_admin' }, authConfig.jwtSecret);
      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/forecast/baseline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cutoffDate: '2026/04/28' }),
      });
      expect(response.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });

  it('returns SuccessResponseSchema-wrapped baseline for branch_admin', async () => {
    const jwt = serverRequire('jsonwebtoken');
    vi.doMock('../../server/src/services/duckdb.js', () => ({
      duckdbService: {
        query: vi.fn(async () => []),
      },
    }));
    const express = serverRequire('express');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const { errorHandler } = await import('../../server/src/middleware/error.js');
    const { default: agentForecastRoutes } = await import('../../server/src/agent/routes/agent-forecast.js');

    const app = express();
    app.use(express.json());
    app.use('/api/agent/forecast', agentForecastRoutes);
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

      const token = jwt.sign({ userId: 'u1', username: 'admin', role: 'branch_admin' }, authConfig.jwtSecret);
      const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/forecast/baseline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cutoffDate: '2026-04-28' }),
      });
      const body = (await response.json()) as {
        success: boolean;
        data: { cutoffDate: string; warnings: string[]; forbiddenInterpretations: string[] };
      };

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.cutoffDate).toBe('2026-04-28');
      expect(body.data.warnings.length).toBeGreaterThan(0);
      expect(body.data.forbiddenInterpretations).toEqual(
        expect.arrayContaining(['财务报表利润', '法定承保利润', '审计利润'])
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe('agent forecast baseline — source-level isolation', () => {
  function readSource(p: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
  }

  it('keeps the SQL helpers and service free of LLM/NL2SQL/free-SQL/CURRENT_DATE patterns', () => {
    const combined = [
      readSource('server/src/sql/forecast/baseline.ts'),
      readSource('server/src/agent/services/agent-forecast-baseline-service.ts'),
      readSource('server/src/agent/routes/agent-forecast.ts'),
      readSource('server/src/agent/schemas/agent-forecast-baseline.schema.ts'),
    ].join('\n');

    expect(combined).not.toMatch(/openrouter|zhipu|createChatCompletion|chatCompletion|completion\.create/i);
    expect(combined).not.toMatch(/rawSql|freeSql|nl2sql/i);
    expect(combined).not.toContain('CURRENT_DATE');
  });

  it('registers route constants in server and frontend mirrors', () => {
    expect(readSource('server/src/config/api-routes.ts')).toContain("BASELINE: '/baseline'");
    expect(readSource('src/shared/api/routes.ts')).toContain("BASELINE: 'agent/forecast/baseline'");
  });

  it('declares forecast_baseline in capability + tool registries', () => {
    expect(readSource('server/src/agent/registry/agent-data-capability-registry.ts')).toContain("id: 'forecast_baseline'");
    expect(readSource('server/src/agent/tools/tool-registry.ts')).toContain("id: 'forecast.baseline'");
  });
});
