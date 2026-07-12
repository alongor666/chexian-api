import { describe, expect, it } from 'vitest';
import {
  DECISION_DOMAINS,
  ROUTES,
  getNavigationGroups,
  getPermissionRoutes,
} from '../routeRegistry';

const CANONICAL_APP_PATHS = [
  '/home',
  '/data-import',
  '/dashboard',
  '/performance-analysis',
  '/admin/access-control',
  '/growth',
  '/cost',
  '/reports',
  '/specialty',
  '/moto-cost',
  '/quote-conversion',
  '/expense-development',
  '/repair',
  '/customer-flow',
  '/claims-detail',
  '/renewal-tracker',
  '/chart-ledger',
];

describe('route registry contract', () => {
  it('registers every current authenticated canonical App page', () => {
    expect(ROUTES.map((route) => route.path).sort()).toEqual([...CANONICAL_APP_PATHS].sort());
    expect(ROUTES.some((route) => route.path === '/')).toBe(false);
  });

  it('keeps route ids and canonical paths unique', () => {
    expect(new Set(ROUTES.map((route) => route.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((route) => route.path)).size).toBe(ROUTES.length);
  });

  it('keeps aliases unique and separate from canonical paths', () => {
    const aliases = ROUTES.flatMap((route) => route.aliases ?? []);
    const canonicalPaths = new Set(ROUTES.map((route) => route.path));

    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.every((alias) => !canonicalPaths.has(alias))).toBe(true);
    expect(aliases).toEqual(expect.arrayContaining([
      '/premium-report',
      '/marketing-report',
      '/truck',
      '/cross-sell',
      '/comparison',
      '/comprehensive-analysis',
      '/old-dashboard',
    ]));
  });

  it('only returns canonical routes as permission choices', () => {
    const permissionPaths = getPermissionRoutes().map((route) => route.path);
    const aliases = ROUTES.flatMap((route) => route.aliases ?? []);

    expect(permissionPaths).not.toContain('/');
    for (const alias of aliases) {
      expect(permissionPaths).not.toContain(alias);
    }
    for (const legacyPath of ['/renewal', '/truck', '/cross-sell', '/comparison']) {
      expect(permissionPaths).not.toContain(legacyPath);
    }
  });

  it('keeps the six decision domains in their approved order', () => {
    expect(DECISION_DOMAINS).toEqual([
      '经营总览',
      '增长达成',
      '成本质量',
      '客户经营',
      '专项资源',
      '平台管理',
    ]);
    expect(getNavigationGroups().map((group) => group.domain)).toEqual(DECISION_DOMAINS);
  });

  it('sorts routes within each navigation domain by navigation order', () => {
    for (const group of getNavigationGroups()) {
      expect(group.routes.map((route) => route.navigationOrder)).toEqual(
        [...group.routes].map((route) => route.navigationOrder).sort((a, b) => a - b),
      );
    }
  });
});
