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

describe('agent operating profit forecast', () => {
  it('calculates deterministic profit scenario with period sensitivity', async () => {
    const { calculateProfitScenario } = await import('../../server/src/agent/services/agent-profit-forecast-service.js');

    const result = calculateProfitScenario({
      premium: 20000000,
      ultimateVariableCostRatio: 85,
      ultimateFixedCostRatio: 9,
      earningSchedule: [
        { period: '2026', earnedRatio: 52 },
        { period: '2027', earnedRatio: 48 },
      ],
      scenarioName: 'test',
      assumptionSource: 'caller_provided',
    });

    expect(result.success).toBe(true);
    expect(result.data.ultimateCombinedCostRatio).toBe(94);
    expect(result.data.forecastOperatingProfitMargin).toBe(6);
    expect(result.data.perPeriodForecast[0]?.forecastOperatingProfit).toBe(624000);
    expect(result.data.perPeriodForecast[1]?.forecastOperatingProfit).toBe(576000);
    expect(result.data.fullCycleForecastOperatingProfit).toBe(1200000);
    expect(result.data.onePctSensitivity[0]?.sensitivity).toBe(104000);
    expect(result.data.warnings.join('')).toContain('不是财务报表利润');
    expect(result.data.forbiddenInterpretations).toEqual(
      expect.arrayContaining(['财务报表利润', '法定承保利润', '审计利润'])
    );
  });

  it('serves protected HTTP route and rejects unauthenticated requests', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-scenario`;

      const unauthorizedResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(unauthorizedResponse.status).toBe(401);

      const invalidRoleToken = jwt.sign(
        { userId: 'u1', username: 'bad-role', role: 'unknown_role' },
        authConfig.jwtSecret
      );
      const forbiddenResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${invalidRoleToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          premium: 20000000,
          ultimateVariableCostRatio: 85,
          ultimateFixedCostRatio: 9,
          earningSchedule: [{ period: '2026', earnedRatio: 100 }],
          scenarioName: 'test',
          assumptionSource: 'caller_provided',
        }),
      });
      expect(forbiddenResponse.status).toBe(403);

      const token = jwt.sign(
        { userId: 'u2', username: 'admin', role: 'branch_admin' },
        authConfig.jwtSecret
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          premium: 20000000,
          ultimateVariableCostRatio: 85,
          ultimateFixedCostRatio: 9,
          earningSchedule: [
            { period: '2026', earnedRatio: 52 },
            { period: '2027', earnedRatio: 48 },
          ],
          scenarioName: 'test',
          assumptionSource: 'caller_provided',
        }),
      });
      const body = await response.json() as { success: boolean; data: { fullCycleForecastOperatingProfit: number } };
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.fullCycleForecastOperatingProfit).toBe(1200000);
    } finally {
      await closeServer(server);
    }
  });

  it('returns 400 for invalid forecast inputs', async () => {
    const jwt = serverRequire('jsonwebtoken');
    const { authConfig } = await import('../../server/src/config/auth.js');
    const app = await buildForecastApp();
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
      const endpoint = `http://127.0.0.1:${address.port}/api/agent/forecast/profit-scenario`;
      const token = jwt.sign({ userId: 'u1', username: 'admin', role: 'branch_admin' }, authConfig.jwtSecret);
      const base = {
        premium: 20000000,
        ultimateVariableCostRatio: 85,
        ultimateFixedCostRatio: 9,
        earningSchedule: [{ period: '2026', earnedRatio: 100 }],
        scenarioName: 'test',
        assumptionSource: 'caller_provided',
      };

      for (const body of [
        { ...base, earningSchedule: [{ period: '2026', earnedRatio: 99 }] },
        { ...base, premium: 0 },
        { ...base, ultimateFixedCostRatio: undefined },
        { ...base, ultimateVariableCostRatio: 151 },
      ]) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
      }
    } finally {
      await closeServer(server);
    }
  });
});
