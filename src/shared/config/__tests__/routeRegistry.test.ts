import { describe, expect, it } from 'vitest';
import {
  DECISION_DOMAINS,
  ROUTES,
  buildNavigationGroups,
  getNavigationGroups,
  getPermissionRoutes,
} from '../routeRegistry';
import type { DecisionDomainId, RouteDefinition, RouteId } from '../routeRegistry';

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
  '/sales-team-performance',
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

  it('keeps redirects unique, targeted, and separate from canonical paths', () => {
    const redirects = ROUTES.flatMap((route) => route.redirects ?? []);
    const aliases = redirects.map((redirect) => redirect.path);
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
    expect(redirects).toEqual(expect.arrayContaining([
      { path: '/truck', to: '/specialty?tab=truck' },
      { path: '/cross-sell', to: '/specialty?tab=cross-sell' },
      { path: '/comprehensive-analysis', to: '/cost?view=comprehensive' },
    ]));
  });

  it('only returns canonical routes as permission choices', () => {
    const permissionRoutes = getPermissionRoutes();
    const permissionPaths = permissionRoutes.map((route) => route.path);
    const aliases = ROUTES.flatMap((route) => route.redirects?.map((redirect) => redirect.path) ?? []);

    expect(permissionPaths).not.toContain('/');
    for (const alias of aliases) {
      expect(permissionPaths).not.toContain(alias);
    }
    for (const legacyPath of ['/renewal', '/truck', '/cross-sell', '/comparison']) {
      expect(permissionPaths).not.toContain(legacyPath);
    }
    expect(permissionPaths).toEqual([
      '/data-import',
      '/home',
      '/dashboard',
      '/performance-analysis',
      '/reports',
      '/growth',
      '/renewal-tracker',
      '/specialty',
    ]);
    expect(permissionRoutes.every((route) => route.kind === 'canonical')).toBe(true);
  });

  it('keeps the six decision domains in their approved order', () => {
    expect(DECISION_DOMAINS.map((domain) => domain.label)).toEqual([
      '经营总览',
      '增长达成',
      '成本质量',
      '客户经营',
      '专项资源',
      '平台管理',
    ]);
    expect(getNavigationGroups().map((group) => group.domain)).toEqual(
      DECISION_DOMAINS.map((domain) => domain.id),
    );
  });

  it('sorts routes within each navigation domain by navigation order', () => {
    for (const group of getNavigationGroups()) {
      expect(group.routes.map((route) => route.navigationOrder)).toEqual(
        [...group.routes].map((route) => route.navigationOrder).sort((a, b) => a - b),
      );
    }
  });

  it('defines icon and navigation metadata for every canonical route', () => {
    expect(ROUTES.every((route) => typeof route.iconKey === 'string' && route.iconKey.length > 0)).toBe(true);
    expect(ROUTES.every((route) => typeof route.showInNavigation === 'boolean')).toBe(true);
    expect(ROUTES.every((route) => route.kind === 'canonical')).toBe(true);
  });

  it('omits routes explicitly hidden from navigation', () => {
    const hiddenRoute: RouteDefinition = {
      ...ROUTES[0],
      id: 'home' as RouteId,
      navigationDomain: 'overview' as DecisionDomainId,
      showInNavigation: false,
    };

    expect(buildNavigationGroups([hiddenRoute]).flatMap((group) => group.routes)).toEqual([]);
  });

  it('freezes the route registry and all nested registry values at runtime', () => {
    const originalDomainLabel = DECISION_DOMAINS[0].label;
    const originalRouteLabel = ROUTES[0].label;
    const routeWithRedirects = ROUTES.find((route) => route.redirects?.length);
    const redirects = routeWithRedirects?.redirects;
    const originalRedirects = [...(redirects ?? [])];

    expect(Object.isFrozen(DECISION_DOMAINS)).toBe(true);
    expect(DECISION_DOMAINS.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(ROUTES)).toBe(true);
    expect(ROUTES.every(Object.isFrozen)).toBe(true);
    expect(ROUTES.filter((route) => 'redirects' in route).every((route) => {
      const values = route.redirects;
      return Object.isFrozen(values) && values?.every(Object.isFrozen);
    })).toBe(true);

    expect(() => (DECISION_DOMAINS as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      (DECISION_DOMAINS[0] as { label: string }).label = '被篡改';
    }).toThrow(TypeError);
    expect(() => (ROUTES as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      (ROUTES[0] as { label: string }).label = '被篡改';
    }).toThrow(TypeError);
    expect(() => (redirects as unknown as object[]).push({ path: '/mutated', to: '/home' })).toThrow(TypeError);

    expect(DECISION_DOMAINS[0].label).toBe(originalDomainLabel);
    expect(ROUTES[0].label).toBe(originalRouteLabel);
    expect(redirects).toEqual(originalRedirects);
  });
});
