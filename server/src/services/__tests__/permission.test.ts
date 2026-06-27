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
import { PRESET_USERS, getAllBranchCodes } from '../../config/preset-users.js';
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

describe('getVisibleOrganizations 全国超管 effectiveBranch（切省 + 全国合并）', () => {
  const superAdmin = (): JwtPayload =>
    mkUser({
      role: UserRole.BRANCH_ADMIN,
      branchCode: 'SC',
      visibleBranches: ['SC', 'SX'],
    } as Partial<JwtPayload>);

  it('超管 effectiveBranch=SX → 全部 + 山西机构（切省后下拉变山西）', () => {
    const r = permissionService.getVisibleOrganizations(superAdmin(), 'SX');
    expect(r).toEqual(['全部', ...SX_ORGANIZATIONS]);
    for (const sc of ORGANIZATIONS) expect(r).not.toContain(sc);
  });

  it('超管 effectiveBranch=SC → 全部 + 四川机构', () => {
    const r = permissionService.getVisibleOrganizations(superAdmin(), 'SC');
    expect(r).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('超管 effectiveBranch=ALL → 全部 + 四川机构 + 山西机构（合并、去重、按省顺序）', () => {
    const r = permissionService.getVisibleOrganizations(superAdmin(), 'ALL');
    expect(r).toEqual(['全部', ...ORGANIZATIONS, ...SX_ORGANIZATIONS]);
    // 含两省机构
    expect(r).toContain('乐山');
    expect(r).toContain('太原一部');
    // 去重：无重复
    expect(new Set(r).size).toBe(r.length);
  });

  it('超管未传 effectiveBranch（未切省）→ 回落本人默认省 SC（零回归）', () => {
    const r = permissionService.getVisibleOrganizations(superAdmin());
    expect(r).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('普通 SC branch_admin（无 visibleBranches）传 effectiveBranch=SC → 四川机构（不受影响）', () => {
    const r = permissionService.getVisibleOrganizations(
      mkUser({ role: UserRole.BRANCH_ADMIN, branchCode: 'SC' }),
      'SC'
    );
    expect(r).toEqual(['全部', ...ORGANIZATIONS]);
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

  // ★ 省份注册表耦合（codex 闸-2 P1-1 强化）：杜绝「半注册」省份。
  //   机构注册表(BRANCH_ORGANIZATIONS) 的省 keys 必须 == 预置账号省集合(getAllBranchCodes())。
  //   配合 preset-users.test.ts 的「visibleBranches == getAllBranchCodes()」不变量，三者锁成一条链：
  //     机构展示注册表 == 账号注册表 == 全国超管可见省。
  //   一个省不可能「有数据/有机构展示」却不在全国超管 visibleBranches 内 → ALL 视图（IN 白名单）
  //   不会泄漏「半注册」省。加第 3 省必须同时改这三处，否则本测试红。
  it('BRANCH_ORGANIZATIONS 省 keys == getAllBranchCodes()（省份注册表耦合，防半注册泄漏）', () => {
    const orgRegistryBranches = Object.keys(BRANCH_ORGANIZATIONS).sort();
    const presetBranches = getAllBranchCodes(); // 已排序
    expect(orgRegistryBranches).toEqual(presetBranches);
  });
});
