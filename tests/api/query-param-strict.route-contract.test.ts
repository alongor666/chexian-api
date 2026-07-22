import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('query unknown parameter route contract', () => {
  it('mounts strict parameter validation after auth/RLS and before every query handler', () => {
    const source = readFileSync('server/src/routes/query.ts', 'utf8');
    const permission = source.indexOf('router.use(permissionMiddleware)');
    const strictParams = source.indexOf('router.use(rejectUnknownRegisteredQueryParams)');
    const firstRoute = source.indexOf('router.use(kpiRoutes)');

    expect(permission).toBeGreaterThan(-1);
    expect(strictParams).toBeGreaterThan(permission);
    expect(firstRoute).toBeGreaterThan(strictParams);
  });
});
