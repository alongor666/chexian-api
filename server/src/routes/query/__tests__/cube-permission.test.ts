/**
 * 单元测试：buildOrgScopedPermissionWhere（cube 续保路径 RLS 安全降级）
 *
 * 评审发现：RenewalTrackerFact 只含 org_level_3（无 is_telemarketing/branch_code），
 * 直接追加 permissionFilter 对电销/多分公司用户会 DuckDB Binder Error 500。
 * 本助手只保留视图真实存在的 org_level_3 段，对齐 repair.ts 既定降级模式。
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { buildOrgScopedPermissionWhere } from '../shared.js';

const reqWith = (pf?: string) => ({ permissionFilter: pf } as unknown as Request);

describe('buildOrgScopedPermissionWhere（派生视图缺权限列的安全降级）', () => {
  it('branch_admin / 无过滤 → 1=1（不限制）', () => {
    expect(buildOrgScopedPermissionWhere(reqWith(undefined))).toBe('1=1');
    expect(buildOrgScopedPermissionWhere(reqWith('1=1'))).toBe('1=1');
  });

  it('org_user：提取 org_level_3 段（视图有此列，照常隔离，无回归）', () => {
    expect(buildOrgScopedPermissionWhere(reqWith("org_level_3 = '天府'"))).toBe("org_level_3 = '天府'");
  });

  it('telemarketing_user：is_telemarketing=true（无 org_level_3）→ 1=1（不追加视图缺失列，防 Binder Error 500）', () => {
    expect(buildOrgScopedPermissionWhere(reqWith('is_telemarketing = true'))).toBe('1=1');
  });

  // 注：本函数只负责 org_level_3 段；branch_code 段由配套 resolveBranchRlsCode 单独下推
  // （见 cube-renewal-branch-rls.test.ts）。故此处「仅保留 org_level_3」是本 helper 的正确契约，
  // 不代表 cube 路由不隔离 branch_code。
  it('多分公司：org_level_3=X AND branch_code=Y → 本 helper 仅保留 org_level_3 段（branch_code 由 resolveBranchRlsCode 另行下推）', () => {
    expect(buildOrgScopedPermissionWhere(reqWith("org_level_3 = '天府' AND branch_code = 'SC'"))).toBe(
      "org_level_3 = '天府'"
    );
  });

  it('转义单引号的 org 名正确提取（防注入解析错位）', () => {
    expect(buildOrgScopedPermissionWhere(reqWith("org_level_3 = 'O''Brien'"))).toBe("org_level_3 = 'O''Brien'");
  });
});
