/**
 * permission.service 单测 —— 重点：getVisibleOrganizations 多省省份化。
 *
 * 背景（2026-06-26 山西 cutover 步⑥发账号时发现的 bug）：
 *   getVisibleOrganizations 对所有 branch_admin 返回静态四川机构常量 ORGANIZATIONS，
 *   → 山西 branch_admin 的机构下拉泄漏四川机构名、且不含山西机构。
 *   修复：按 user.branchCode 从 BRANCH_ORGANIZATIONS 取该省机构列表。
 */
import { describe, it, expect } from 'vitest';
import {
  permissionService,
  ORGANIZATIONS,
  SX_ORGANIZATIONS,
  BRANCH_ORGANIZATIONS,
} from '../permission.js';
import { UserRole } from '../../middleware/permission.js';
import { PRESET_USERS } from '../../config/preset-users.js';
import type { JwtPayload } from '../../middleware/auth.js';

const mkUser = (p: Partial<JwtPayload>): JwtPayload =>
  ({ userId: 'u', username: 'u', role: UserRole.ORG_USER, ...p } as JwtPayload);

describe('getVisibleOrganizations 省份化', () => {
  it('四川 branch_admin → 全部 + 四川机构（零回归）', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' })
    );
    expect(r).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('山西 branch_admin → 全部 + 山西机构，且不含任何四川机构（修复跨省泄漏）', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.BRANCH_ADMIN, branchCode: 'SX' })
    );
    expect(r).toEqual(['全部', ...SX_ORGANIZATIONS]);
    for (const sc of ORGANIZATIONS) {
      expect(r).not.toContain(sc);
    }
  });

  it('未登记 branchCode 的 branch_admin → 保守回落四川机构（不抛错、不泄漏未知省）', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.BRANCH_ADMIN, branchCode: 'ZZ' })
    );
    expect(r).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('branchCode 缺失的 branch_admin → 回落四川机构', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.BRANCH_ADMIN })
    );
    expect(r).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('山西 org_user → 仅全部 + 本机构（不受 branchCode 分支影响）', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.ORG_USER, branchCode: 'SX', organization: '太原一部' })
    );
    expect(r).toEqual(['全部', '太原一部']);
  });

  it('山西电销用户 → 按 branchCode 取山西机构', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.TELEMARKETING_USER, branchCode: 'SX' })
    );
    expect(r).toEqual(['全部', ...SX_ORGANIZATIONS]);
  });
});

describe('BRANCH_ORGANIZATIONS 漂移守卫', () => {
  it('山西机构列表与 PRESET_USERS 的 SX org_user organization 集合严格一致（SSOT 对账）', () => {
    const fromPreset = Object.values(PRESET_USERS)
      .filter((u) => u.branchCode === 'SX' && u.role === 'org_user')
      .map((u) => u.organization)
      .filter((o): o is string => Boolean(o))
      .sort();
    expect([...BRANCH_ORGANIZATIONS.SX].sort()).toEqual(fromPreset);
  });

  it('四川机构列表 = ORGANIZATIONS 常量', () => {
    expect(BRANCH_ORGANIZATIONS.SC).toBe(ORGANIZATIONS);
  });
});
