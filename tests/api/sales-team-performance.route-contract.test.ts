import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('sales-team-performance route contract', () => {
  it('mounts /sales-team-performance endpoint on query router', () => {
    const queryRouter = readSource('server/src/routes/query.ts');
    expect(queryRouter).toContain("import salesTeamPerformanceRoutes from './query/sales-team-performance.js'");
    expect(queryRouter).toContain('router.use(salesTeamPerformanceRoutes)');

    const route = readSource('server/src/routes/query/sales-team-performance.ts');
    expect(route).toContain("'/sales-team-performance'");
  });

  it('enforces admin-only access via requireBranchAdmin (no standard RLS columns in view)', () => {
    const route = readSource('server/src/routes/query/sales-team-performance.ts');
    expect(route).toContain('requireBranchAdmin');
  });

  it('locks query-param validation: dimension whitelist + optional YYYY-MM-DD dates + bounded limit', () => {
    const route = readSource('server/src/routes/query/sales-team-performance.ts');
    expect(route).toContain('Object.prototype.hasOwnProperty.call(SALES_TEAM_DIMENSIONS, dimensionRaw)');
    expect(route).toContain('isValidDateFormat(start)');
    expect(route).toContain('isValidDateFormat(end)');
    expect(route).toContain("'start' must be <= 'end'");
    expect(route).toContain('Number.isInteger(limit)');
  });

  it('keeps route constants aligned between backend and frontend registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("SALES_TEAM_PERFORMANCE: '/sales-team-performance'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("SALES_TEAM_PERFORMANCE: 'sales-team-performance'");
  });

  it('registers catalog metadata and param contract', () => {
    const metadata = readSource('server/src/config/query-routes-metadata.ts');
    expect(metadata).toContain("key: 'SALES_TEAM_PERFORMANCE', path: '/sales-team-performance', method: 'GET'");

    const contracts = readSource('server/src/config/route-param-contracts.ts');
    expect(contracts).toContain("'/sales-team-performance': {");
    expect(contracts).toContain("extraKeys: ['dimension', 'start', 'end', 'limit']");
  });

  it('uses lazy domain middleware + hotspot cache + ETag envelope', () => {
    const route = readSource('server/src/routes/query/sales-team-performance.ts');
    expect(route).toContain("createDomainMiddleware('SalesTeamPerformance')");
    expect(route).toContain('QUERY_CACHE.hotspotShort');
    expect(route).toContain('sendWithEtag(');
    expect(route).toContain('HTTP_MAX_AGE.query');
  });

  it('wires lazy domain loader against enriched parquet (rules layer SSOT lives in ETL)', () => {
    const bootstrapper = readSource('server/src/services/data-bootstrapper.ts');
    expect(bootstrapper).toContain("this.lazyRegistry.register('SalesTeamPerformance'");

    const loaders = readSource('server/src/services/duckdb-domain-loaders.ts');
    expect(loaders).toContain('CREATE OR REPLACE VIEW SalesTeamPerformanceFact');

    const paths = readSource('server/src/config/paths.ts');
    expect(paths).toContain('sales_team_performance/biaobao_enriched.parquet');
  });

  it('registers frontend route + page + client method', () => {
    const registry = readSource('src/shared/config/routeRegistry.ts');
    expect(registry).toContain("id: 'sales-team-performance', path: '/sales-team-performance'");

    const app = readSource('src/app/App.tsx');
    expect(app).toContain('SalesTeamPerformancePage');
    expect(app).toContain('path="sales-team-performance"');

    const client = readSource('src/shared/api/client.ts');
    expect(client).toContain('getSalesTeamPerformance');
  });
});
