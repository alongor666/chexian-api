import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent profit forecast route contract', () => {
  it('exposes forecast route constants and app wiring', () => {
    const app = readSource('server/src/app.ts');
    const audit = readSource('server/src/middleware/audit.ts');
    const backendRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');
    const route = readSource('server/src/agent/routes/agent-forecast.ts');

    expect(app).toContain("app.use('/api/agent/forecast', queryLimiter)");
    expect(app).toContain("app.use('/api/agent/forecast', agentForecastRoutes)");
    expect(audit).toContain("'/api/agent/forecast'");
    expect(backendRoutes).toContain("PROFIT_SCENARIO: '/profit-scenario'");
    expect(frontendRoutes).toContain("PROFIT_SCENARIO: 'agent/forecast/profit-scenario'");
    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("'/profit-scenario'");
    expect(route).toContain('ProfitScenarioRequestSchema.safeParse(req.body)');
  });
});
