import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import path from 'node:path';
import type { Server } from 'http';

const serverRequire = createRequire(path.resolve(process.cwd(), 'server/package.json'));

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function buildForecastApp() {
  const express = serverRequire('express');
  const [{ errorHandler }, { default: agentForecastRoutes }] = await Promise.all([
    import('../../server/src/middleware/error.js'),
    import('../../server/src/agent/routes/agent-forecast.js'),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/agent/forecast', agentForecastRoutes);
  app.use(errorHandler);
  return app;
}

afterEach(() => {
  serverRequire.cache = {};
});

describe('agent operating profit forecast — segment capability', () => {
  it('produces per-segment results equivalent to single-scenario calculator', async () => {
    const [{ calculateProfitSegment }, { calculateProfitScenario }] = await Promise.all([
      import('../../server/src/agent/services/agent-profit-forecast-service.js'),
      import('../../server/src/agent/services/agent-profit-forecast-service.js'),
    ]);

    const baseEarning = [
      { period: '2026', earnedRatio: 52 },
      { period: '2027', earnedRatio: 48 },
    ];

    const segmentResult = calculateProfitSegment({
      scenarioName: 'orgs-2026',
      dimension: 'org_level_3',
      segments: [
        {
          dimensionLabel: '机构A',
          premium: 20000000,
          ultimateVariableCostRatio: 85,
          ultimateFixedCostRatio: 9,
          earningSchedule: baseEarning,
          assumptionSource: 'caller_provided',
        },
      ],
    });

    const singleResult = calculateProfitScenario({
      premium: 20000000,
      ultimateVariableCostRatio: 85,
      ultimateFixedCostRatio: 9,
      earningSchedule: baseEarning,
      scenarioName: 'machine-a',
      assumptionSource: 'caller_provided',
    });

    expect(segmentResult.success).toBe(true);
    const seg = segmentResult.data.segments[0]!;
    expect(seg.ultimateCombinedCostRatio).toBe(singleResult.data.ultimateCombinedCostRatio);
    expect(seg.forecastOperatingProfitMargin).toBe(singleResult.data.forecastOperatingProfitMargin);
    expect(seg.fullCycleForecastOperatingProfit).toBe(singleResult.data.fullCycleForecastOperatingProfit);
    expect(seg.perPeriodForecast).toEqual(singleResult.data.perPeriodForecast);
    expect(seg.onePctSensitivity).toEqual(singleResult.data.onePctSensitivity);
  });

  it('aggregates premium-weighted ultimate combined cost ratio across segments', async () => {
    const { calculateProfitSegment } = await import('../../server/src/agent/services/agent-profit-forecast-service.js');

    const result = calculateProfitSegment({
      scenarioName: '3-orgs-compare',
      dimension: 'org_level_3',
      segments: [
        {
          dimensionLabel: '机构A',
          premium: 10000000,
          ultimateVariableCostRatio: 80,
          ultimateFixedCostRatio: 10,
          earningSchedule: [{ period: '2026', earnedRatio: 100 }],
          assumptionSource: 'caller_provided',
        },
        {
          dimensionLabel: '机构B',
          premium: 30000000,
          ultimateVariableCostRatio: 95,
          ultimateFixedCostRatio: 8,
          earningSchedule: [{ period: '2026', earnedRatio: 100 }],
          assumptionSource: 'caller_provided',
        },
      ],
    });

    expect(result.data.aggregate.totalPremium).toBe(40000000);
    // 加权 cc = (10M * 90 + 30M * 103) / 40M = (900M + 3090M) / 40M = 99.75
    expect(result.data.aggregate.weightedUltimateCombinedCostRatio).toBeCloseTo(99.75, 4);
    // 全周期合计: 10M*10% + 30M*(-3%) = 1M - 0.9M = 0.1M
    expect(result.data.aggregate.totalFullCycleForecastOperatingProfit).toBeCloseTo(100000, 2);
    expect(result.data.warnings.join('')).toContain('不是财务报表利润');
    expect(result.data.warnings.join('')).toContain('分群预测');
    expect(result.data.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['财务报表利润', '法定承保利润', '审计利润', '承保利润'])
    );
  });

  it('serves the protected HTTP route and rejects unauthenticated requests', async () => {
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-segment`;

      const unauthorizedResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(unauthorizedResponse.status).toBe(401);
    } finally {
      await closeServer(server);
    }
  });

  it('returns 403 for non-branch_admin roles (org_user / telemarketing_user)', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-segment`;
      const validBody = {
        scenarioName: 'org_user-attempt',
        dimension: 'org_level_3',
        segments: [
          {
            dimensionLabel: '机构X',
            premium: 1000000,
            ultimateVariableCostRatio: 85,
            ultimateFixedCostRatio: 9,
            earningSchedule: [{ period: '2026', earnedRatio: 100 }],
            assumptionSource: 'caller_provided',
          },
        ],
      };

      const orgUserToken = jwt.sign(
        { userId: 'org-user-1', username: 'orguser', role: 'org_user', organization: '机构X' },
        authConfig.jwtSecret
      );
      const orgUserResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgUserToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(orgUserResponse.status).toBe(403);

      const telemarketingToken = jwt.sign(
        { userId: 'tm-user-1', username: 'tmuser', role: 'telemarketing_user' },
        authConfig.jwtSecret
      );
      const tmUserResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${telemarketingToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(tmUserResponse.status).toBe(403);
    } finally {
      await closeServer(server);
    }
  });

  it('accepts branch_admin and returns wrapped success payload', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-segment`;

      const adminToken = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioName: 'admin-3-orgs',
          dimension: 'org_level_3',
          segments: [
            {
              dimensionLabel: '机构A',
              premium: 20000000,
              ultimateVariableCostRatio: 85,
              ultimateFixedCostRatio: 9,
              earningSchedule: [{ period: '2026', earnedRatio: 52 }, { period: '2027', earnedRatio: 48 }],
              assumptionSource: 'caller_provided',
            },
            {
              dimensionLabel: '机构B',
              premium: 15000000,
              ultimateVariableCostRatio: 92,
              ultimateFixedCostRatio: 9,
              earningSchedule: [{ period: '2026', earnedRatio: 100 }],
              assumptionSource: 'pricing_redline_default',
            },
          ],
        }),
      });
      const body = (await response.json()) as {
        success: boolean;
        data: {
          dimension: string;
          segments: Array<{ dimensionLabel: string; ultimateCombinedCostRatio: number }>;
          aggregate: { totalPremium: number };
          warnings: string[];
          forbiddenInterpretations: string[];
        };
      };

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.dimension).toBe('org_level_3');
      expect(body.data.segments).toHaveLength(2);
      expect(body.data.segments[0]?.dimensionLabel).toBe('机构A');
      expect(body.data.segments[0]?.ultimateCombinedCostRatio).toBe(94);
      expect(body.data.segments[1]?.dimensionLabel).toBe('机构B');
      expect(body.data.segments[1]?.ultimateCombinedCostRatio).toBe(101);
      expect(body.data.aggregate.totalPremium).toBe(35000000);
      expect(body.data.warnings.length).toBeGreaterThan(0);
      expect(body.data.forbiddenInterpretations).toEqual(
        expect.arrayContaining(['财务报表利润', '法定承保利润', '审计利润', '承保利润'])
      );
    } finally {
      await closeServer(server);
    }
  });

  it('rejects invalid dimensions outside the whitelist', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-segment`;
      const adminToken = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioName: 'bad-dim',
          dimension: 'plate_no',
          segments: [
            {
              dimensionLabel: '京A12345',
              premium: 1000000,
              ultimateVariableCostRatio: 85,
              ultimateFixedCostRatio: 9,
              earningSchedule: [{ period: '2026', earnedRatio: 100 }],
              assumptionSource: 'caller_provided',
            },
          ],
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects earningSchedule that does not sum to 100 in any segment', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-segment`;
      const adminToken = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioName: 'bad-earning',
          dimension: 'org_level_3',
          segments: [
            {
              dimensionLabel: '机构A',
              premium: 1000000,
              ultimateVariableCostRatio: 85,
              ultimateFixedCostRatio: 9,
              earningSchedule: [{ period: '2026', earnedRatio: 99 }],
              assumptionSource: 'caller_provided',
            },
          ],
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects when ultimateFixedCostRatio is missing on any segment (no default)', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-segment`;
      const adminToken = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioName: 'no-fc',
          dimension: 'org_level_3',
          segments: [
            {
              dimensionLabel: '机构A',
              premium: 1000000,
              ultimateVariableCostRatio: 85,
              earningSchedule: [{ period: '2026', earnedRatio: 100 }],
              assumptionSource: 'caller_provided',
            },
          ],
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });
});
