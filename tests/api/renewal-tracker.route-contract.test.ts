import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('renewal-tracker route contract', () => {
  it('mounts /renewal-tracker endpoint on query router', () => {
    const queryRouter = readSource('server/src/routes/query.ts');
    expect(queryRouter).toContain("import renewalTrackerRoutes from './query/renewal-tracker.js'");
    expect(queryRouter).toContain('router.use(renewalTrackerRoutes)');

    const route = readSource('server/src/routes/query/renewal-tracker.ts');
    expect(route).toContain("'/renewal-tracker'");
  });

  it('locks query-param validation to start/end/cutoff YYYY-MM-DD', () => {
    const content = readSource('server/src/routes/query/renewal-tracker.ts');
    expect(content).toContain("isValidDateFormat(start)");
    expect(content).toContain("isValidDateFormat(end)");
    expect(content).toContain("isValidDateFormat(cutoff)");
    expect(content).toContain("'start' must be <= 'end'");
  });

  it('restricts non-time filters to org / salesman / customerCategory only', () => {
    const content = readSource('server/src/routes/query/renewal-tracker.ts');
    expect(content).toContain("buildInCondition('org_level_3', orgNames)");
    expect(content).toContain("buildInCondition('salesman_name', salesmanNames)");
    expect(content).toContain("buildInCondition('customer_category', customerCategories)");
  });

  it('keeps route constants aligned between backend and frontend registries', () => {
    const backend = readSource('server/src/config/api-routes.ts');
    expect(backend).toContain("RENEWAL_TRACKER: '/renewal-tracker'");

    const frontend = readSource('src/shared/api/routes.ts');
    expect(frontend).toContain("RENEWAL_TRACKER: 'renewal-tracker'");
  });

  it('uses lazy domain middleware + hotspot cache tiers + ETag envelope', () => {
    const content = readSource('server/src/routes/query/renewal-tracker.ts');
    expect(content).toContain("createDomainMiddleware('RenewalTracker')");
    expect(content).toContain('QUERY_CACHE.hotspotShort');
    expect(content).toContain('QUERY_CACHE.hotspotLong');
    expect(content).toContain('sendWithEtag(');
    expect(content).toContain('HTTP_MAX_AGE.query');
  });

  it('partitions response rows into 6 arrays (base + 5 dimensions)', () => {
    const content = readSource('server/src/routes/query/renewal-tracker.ts');
    expect(content).toContain("['overall', 'org', 'team', 'salesman']");
    expect(content).toContain("'overall_category'");
    expect(content).toContain("'overall_coverage'");
    expect(content).toContain("'overall_fuel'");
    expect(content).toContain("'overall_used_transfer'");
    expect(content).toContain("'overall_renewal_type'");
    expect(content).toContain("r.row_level === 'overall'");
  });
});
