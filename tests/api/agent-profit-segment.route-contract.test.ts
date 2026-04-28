import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('agent profit segment route contract', () => {
  it('registers route constants in server and frontend mirrors', () => {
    const backendRoutes = readSource('server/src/config/api-routes.ts');
    const frontendRoutes = readSource('src/shared/api/routes.ts');

    expect(backendRoutes).toContain("PROFIT_SEGMENT: '/profit-segment'");
    expect(frontendRoutes).toContain("PROFIT_SEGMENT: 'agent/forecast/profit-segment'");
  });

  it('mounts the segment endpoint on the protected forecast router with role gating', () => {
    const route = readSource('server/src/agent/routes/agent-forecast.ts');

    expect(route).toContain('router.use(authMiddleware);');
    expect(route).toContain('router.use(permissionMiddleware);');
    expect(route).toContain("'/profit-segment'");
    expect(route).toContain('ProfitSegmentRequestSchema.safeParse(req.body)');
    expect(route).toContain('UserRole.BRANCH_ADMIN');
    expect(route).toContain('calculateProfitSegment');
  });

  it('reuses the shared queryLimiter and audit-path entry from PR #300', () => {
    const app = readSource('server/src/app.ts');
    const audit = readSource('server/src/middleware/audit.ts');

    expect(app).toContain("app.use('/api/agent/forecast', queryLimiter)");
    expect(app).toContain("app.use('/api/agent/forecast', agentForecastRoutes)");
    expect(audit).toContain("'/api/agent/forecast'");
  });

  it('declares the segment capability and tool in registries', () => {
    const capability = readSource('server/src/agent/registry/agent-data-capability-registry.ts');
    const tool = readSource('server/src/agent/tools/tool-registry.ts');
    const forecastOutput = readSource('server/src/agent/registry/agent-forecast-output-registry.ts');
    const mapping = readSource('server/src/agent/registry/metric-capability-mapping.ts');

    expect(capability).toContain("id: 'forecast_operating_profit_segment'");
    expect(capability).toContain("'/api/agent/forecast/profit-segment'");
    expect(tool).toContain("id: 'forecast.profit_segment'");
    expect(tool).toContain("endpoint: '/api/agent/forecast/profit-segment'");
    expect(forecastOutput).toContain("id: 'forecast_operating_profit_by_segment'");
    expect(mapping).toContain('forecast_operating_profit_by_segment');
  });

  it('validates request and response through Agent Zod schemas', () => {
    const schema = readSource('server/src/agent/schemas/agent-forecast.schema.ts');
    const route = readSource('server/src/agent/routes/agent-forecast.ts');

    expect(schema).toContain('ProfitSegmentRequestSchema');
    expect(schema).toContain('ProfitSegmentResponseSchema');
    expect(schema).toContain('SegmentDimensionSchema');
    expect(route).toContain('ProfitSegmentRequestSchema.safeParse(req.body)');
    expect(route).toContain('ProfitSegmentResponseSchema.parse(calculateProfitSegment');
  });
});
