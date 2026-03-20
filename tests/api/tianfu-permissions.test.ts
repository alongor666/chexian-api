import { describe, expect, it } from 'vitest';
import { canAccessRoute, UserRole, UserPermission } from '../../src/shared/config/organizations';
import { permissionService } from '../../server/src/services/permission';

describe('tianfu user (org_user) permissions verification', () => {
  const tianfuUser: UserPermission = {
    username: 'tianfu',
    displayName: '天府机构',
    role: UserRole.ORG_USER,
    organization: '天府',
    // Not explicitly setting allowedRoutes to fallback to org_user defaults:
    // ['/performance-analysis', '/growth', '/specialty']
  };

  it('allows access to cross-sell (alias for /specialty)', () => {
    // '/cross-sell' maps to '/specialty' via ROUTE_ALIAS_MAP
    expect(canAccessRoute(tianfuUser, '/cross-sell')).toBe(true);
  });

  it('allows access to performance-analysis', () => {
    expect(canAccessRoute(tianfuUser, '/performance-analysis')).toBe(true);
  });

  it('allows access to growth', () => {
    expect(canAccessRoute(tianfuUser, '/growth')).toBe(true);
  });

  it('denies access to comprehensive-analysis (alias for /cost)', () => {
    // '/comprehensive-analysis' maps to '/cost'
    expect(canAccessRoute(tianfuUser, '/comprehensive-analysis')).toBe(false);
  });

  it('denies access to cost', () => {
    expect(canAccessRoute(tianfuUser, '/cost')).toBe(false);
  });

  it('denies access to premium-report (alias for /reports)', () => {
    expect(canAccessRoute(tianfuUser, '/premium-report')).toBe(false);
  });

  it('backend permission filter is restricted to organization', () => {
    // Simulating token payload processing by permissionService
    const permissionFilter = permissionService.generatePermissionWhereClause({
      role: 'org_user',
      username: 'tianfu',
      organization: '天府',
    } as any);

    expect(permissionFilter).toContain("org_level_3 = '天府'");
    expect(permissionFilter).not.toBe('1=1');
  });
});
