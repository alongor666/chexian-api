import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('policy-geo route contract', () => {
  it('exposes /policy-geo/province and /policy-geo/city endpoints mounted on query router', () => {
    const queryRouter = readSource('server/src/routes/query.ts');
    expect(queryRouter).toContain("import policyGeoRoutes from './query/policy-geo.js'");
    expect(queryRouter).toContain('router.use(policyGeoRoutes)');

    const policyGeoRoute = readSource('server/src/routes/query/policy-geo.ts');
    expect(policyGeoRoute).toContain("'/policy-geo/province'");
    expect(policyGeoRoute).toContain("'/policy-geo/city'");
  });

  it('locks province query-param validation regex to CJK/Latin 1-20 chars', () => {
    const content = readSource('server/src/routes/query/policy-geo.ts');
    expect(content).toContain('/^[\\u4e00-\\u9fa5a-zA-Z]{1,20}$/');
    expect(content).toContain("throw new AppError(400, 'province 参数格式无效')");
  });

  it('keeps route constants aligned between backend and frontend registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("PROVINCE: '/policy-geo/province'");
    expect(backend).toContain("CITY: '/policy-geo/city'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("PROVINCE: 'policy-geo/province'");
    expect(frontend).toContain("CITY: 'policy-geo/city'");
  });

  it('uses hotspotMedium cache tier and ETag envelope consistent with peer geo routes', () => {
    const content = readSource('server/src/routes/query/policy-geo.ts');
    expect(content).toContain('QUERY_CACHE.hotspotMedium');
    expect(content).toContain('sendWithEtag(req, res, {');
    expect(content).toContain('HTTP_MAX_AGE.query');
  });
});
