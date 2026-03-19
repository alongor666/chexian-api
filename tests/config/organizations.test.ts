/**
 * 机构和权限配置单元测试
 * Tests for src/shared/config/organizations.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ORGANIZATIONS,
  UserRole,
  getPermissionByUsername,
  getVisibleOrganizations,
  canViewOrganization,
  canAccessRoute,
  getDefaultRoute,
} from '../../src/shared/config/organizations';

// ⚠️ SECURITY FIX: 以下函数已从前端移除，所有认证通过后端 API
// - hashPassword (已移至后端)
// - validateCredentials (已移至后端)
// - USER_CREDENTIALS (已移至后端)

describe('Organizations Config', () => {
  describe('ORGANIZATIONS constant', () => {
    it('should have 12 organizations', () => {
      expect(ORGANIZATIONS).toHaveLength(12);
    });

    it('should include expected organizations', () => {
      expect(ORGANIZATIONS).toContain('乐山');
      expect(ORGANIZATIONS).toContain('天府');
      expect(ORGANIZATIONS).toContain('宜宾');
      expect(ORGANIZATIONS).toContain('高新');
    });

    it('should have correct type (as const)', () => {
      // `as const` provides TypeScript-level immutability, not runtime freeze
      // Verify the array structure is what we expect
      expect(Array.isArray(ORGANIZATIONS)).toBe(true);
      expect(typeof ORGANIZATIONS[0]).toBe('string');
    });
  });

  describe('UserRole enum', () => {
    it('should have BRANCH_ADMIN role', () => {
      expect(UserRole.BRANCH_ADMIN).toBe('branch_admin');
    });

    it('should have ORG_USER role', () => {
      expect(UserRole.ORG_USER).toBe('org_user');
    });
  });

  describe('getPermissionByUsername', () => {
    it('should return admin permission for admin user', () => {
      const permission = getPermissionByUsername('admin');

      expect(permission).not.toBeNull();
      expect(permission?.role).toBe(UserRole.BRANCH_ADMIN);
      expect(permission?.displayName).toBe('系统管理员');
    });

    it('should return org permission for org user', () => {
      const permission = getPermissionByUsername('leshan');

      expect(permission).not.toBeNull();
      expect(permission?.role).toBe(UserRole.ORG_USER);
      expect(permission?.organization).toBe('乐山');
    });

    it('should return default admin permission for unknown user (dev mode)', () => {
      // In dev mode, unknown users get default admin permissions
      const permission = getPermissionByUsername('unknown_user');

      expect(permission).not.toBeNull();
      expect(permission?.role).toBe(UserRole.BRANCH_ADMIN);
      expect(permission?.username).toBe('unknown_user');
    });
  });

  describe('getVisibleOrganizations', () => {
    it('should return all orgs for branch admin', () => {
      const permission = getPermissionByUsername('admin')!;
      const visibleOrgs = getVisibleOrganizations(permission);

      expect(visibleOrgs).toContain('全部');
      ORGANIZATIONS.forEach((org) => {
        expect(visibleOrgs).toContain(org);
      });
    });

    it('should return only own org for org user', () => {
      const permission = getPermissionByUsername('leshan')!;
      const visibleOrgs = getVisibleOrganizations(permission);

      expect(visibleOrgs).toContain('全部');
      expect(visibleOrgs).toContain('乐山');
      expect(visibleOrgs).not.toContain('天府');
    });
  });



  describe('route defaults for org users', () => {
    it('should allow merged specialty routes and keep legacy aliases compatible for org users', () => {
      const orgUser = getPermissionByUsername('leshan')!;

      expect(canAccessRoute(orgUser, '/performance-analysis')).toBe(true);
      expect(canAccessRoute(orgUser, '/growth')).toBe(true);
      expect(canAccessRoute(orgUser, '/specialty')).toBe(true);
      expect(canAccessRoute(orgUser, '/renewal')).toBe(true);
      expect(canAccessRoute(orgUser, '/cross-sell')).toBe(true);
      expect(canAccessRoute(orgUser, '/truck')).toBe(true);

      expect(canAccessRoute(orgUser, '/dashboard')).toBe(false);
      expect(canAccessRoute(orgUser, '/reports')).toBe(false);
      expect(canAccessRoute(orgUser, '/premium-report')).toBe(false);
      expect(canAccessRoute(orgUser, '/marketing-report')).toBe(false);
      expect(canAccessRoute(orgUser, '/cost')).toBe(false);
    });

    it('should use performance-analysis as fallback default route for org user', () => {
      const orgUser = getPermissionByUsername('leshan')!;
      expect(getDefaultRoute(orgUser)).toBe('/performance-analysis');
    });
  });

  describe('canViewOrganization', () => {
    it('should allow admin to view any org', () => {
      const admin = getPermissionByUsername('admin')!;

      expect(canViewOrganization(admin, '乐山')).toBe(true);
      expect(canViewOrganization(admin, '天府')).toBe(true);
      expect(canViewOrganization(admin, '全部')).toBe(true);
    });

    it('should allow org user to view own org', () => {
      const leshanUser = getPermissionByUsername('leshan')!;

      expect(canViewOrganization(leshanUser, '乐山')).toBe(true);
      expect(canViewOrganization(leshanUser, '全部')).toBe(true);
    });

    it('should deny org user from viewing other org', () => {
      const leshanUser = getPermissionByUsername('leshan')!;

      expect(canViewOrganization(leshanUser, '天府')).toBe(false);
      expect(canViewOrganization(leshanUser, '宜宾')).toBe(false);
    });
  });

  // ⚠️ SECURITY FIX: 以下测试已移除，因为前端密码验证功能已删除
  // 所有认证测试应该针对后端 API (server/src/services/auth.ts)
  //
  // describe('hashPassword', () => { ... })
  // describe('validateCredentials', () => { ... })
});

describe('Security Best Practices', () => {
  it('should not expose user credentials in frontend', async () => {
    // ✅ SECURITY FIX: 验证前端不再导出敏感信息
    const credentialsModule = await import('../../src/shared/config/organizations');

    // USER_CREDENTIALS should not be exported
    expect((credentialsModule as any).USER_CREDENTIALS).toBeUndefined();

    // Password-related functions should not be exported
    expect((credentialsModule as any).validateCredentials).toBeUndefined();
    expect((credentialsModule as any).hashPassword).toBeUndefined();
    expect((credentialsModule as any).getDevPassword).toBeUndefined();
  });
});
