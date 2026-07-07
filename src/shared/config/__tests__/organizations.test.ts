import { describe, it, expect } from 'vitest';
import {
  ORGANIZATIONS,
  SX_ORGANIZATIONS,
  BRANCH_ORGANIZATIONS,
  QUICK_LOGIN_USERS_BY_BRANCH,
  UserRole,
  getVisibleOrganizations,
  type UserPermission,
} from '../organizations';

describe('BRANCH_ORGANIZATIONS', () => {
  it('SC 别名与 ORGANIZATIONS 逐字节一致', () => {
    expect(BRANCH_ORGANIZATIONS.SC).toBe(ORGANIZATIONS);
  });

  it('SX 别名与 SX_ORGANIZATIONS 逐字节一致', () => {
    expect(BRANCH_ORGANIZATIONS.SX).toBe(SX_ORGANIZATIONS);
  });

  it('SX 经营单元为 11 个（镜像 server BRANCH_ORGANIZATIONS）', () => {
    expect(SX_ORGANIZATIONS).toHaveLength(11);
  });
});

describe('getVisibleOrganizations — 分公司管理员按 branchCode 取机构清单', () => {
  it('SC 管理员（字节安全）：branchCode=SC → 四川 12 机构', () => {
    const permission: UserPermission = {
      username: 'admin',
      displayName: '系统管理员',
      role: UserRole.BRANCH_ADMIN,
      branchCode: 'SC',
    };
    expect(getVisibleOrganizations(permission)).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('SX 管理员：branchCode=SX → 山西 11 机构（回归前会误得四川机构名）', () => {
    const permission: UserPermission = {
      username: 'sxAdmin',
      displayName: '山西分公司管理员',
      role: UserRole.BRANCH_ADMIN,
      branchCode: 'SX',
    };
    const visible = getVisibleOrganizations(permission);
    expect(visible).toEqual(['全部', ...SX_ORGANIZATIONS]);
    expect(visible).not.toContain('乐山');
  });

  it('未知/缺省 branchCode 回落四川（字节安全兜底）', () => {
    const permission: UserPermission = {
      username: 'legacy',
      displayName: '历史用户',
      role: UserRole.BRANCH_ADMIN,
    };
    expect(getVisibleOrganizations(permission)).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('电销用户同样按 branchCode 取机构清单', () => {
    const permission: UserPermission = {
      username: 'sxdianxiao',
      displayName: '山西电销',
      role: UserRole.TELEMARKETING_USER,
      branchCode: 'SX',
    };
    expect(getVisibleOrganizations(permission)).toEqual(['全部', ...SX_ORGANIZATIONS]);
  });

  it('三级机构用户只见本机构（与 branchCode 无关）', () => {
    const permission: UserPermission = {
      username: 'sx_taiyuan1',
      displayName: '太原一部机构',
      role: UserRole.ORG_USER,
      organization: '太原一部' as UserPermission['organization'],
      branchCode: 'SX',
    };
    expect(getVisibleOrganizations(permission)).toEqual(['全部', '太原一部']);
  });
});

describe('getVisibleOrganizations — effectiveBranch 参数（超管切省联动，对齐后端 permission.ts）', () => {
  const superAdmin: UserPermission = {
    username: 'xuechenglong',
    displayName: '超级管理员',
    role: UserRole.BRANCH_ADMIN,
    branchCode: 'SC',
    visibleBranches: ['SC', 'SX'],
  };

  it('未传 effectiveBranch 时回落 permission.branchCode（向后兼容，字节安全）', () => {
    expect(getVisibleOrganizations(superAdmin)).toEqual(['全部', ...ORGANIZATIONS]);
  });

  it('传 effectiveBranch=SX（超管切省后）→ 山西机构清单，而非默认省 SC', () => {
    const visible = getVisibleOrganizations(superAdmin, 'SX');
    expect(visible).toEqual(['全部', ...SX_ORGANIZATIONS]);
    expect(visible).not.toContain('乐山');
  });

  it("effectiveBranch='ALL' → 合并 visibleBranches 各省机构去重", () => {
    const visible = getVisibleOrganizations(superAdmin, 'ALL');
    expect(visible).toEqual(['全部', ...ORGANIZATIONS, ...SX_ORGANIZATIONS]);
  });

  it("effectiveBranch='ALL' 但 visibleBranches 缺省 → 回落全部已知省", () => {
    const permission: UserPermission = { ...superAdmin, visibleBranches: undefined };
    const visible = getVisibleOrganizations(permission, 'ALL');
    expect(visible).toEqual(['全部', ...ORGANIZATIONS, ...SX_ORGANIZATIONS]);
  });
});

describe('QUICK_LOGIN_USERS_BY_BRANCH — 快速切换用户按省（阶段3）', () => {
  it('SC 清单与改动前逐字节一致（admin + 12 机构，字节安全）', () => {
    const sc = QUICK_LOGIN_USERS_BY_BRANCH.SC;
    expect(sc).toHaveLength(13);
    expect(sc[0]).toEqual({ username: 'admin', displayName: '系统管理员', role: UserRole.BRANCH_ADMIN });
    expect(sc.map((u) => u.username)).toEqual([
      'admin', 'leshan', 'tianfu', 'yibin', 'deyang', 'xindu', 'wuhou',
      'luzhou', 'zigong', 'ziyang', 'dazhou', 'qingyang', 'gaoxin',
    ]);
  });

  it('SX 清单为 sxAdmin + 11 经营单元账号（回归前山西用户看到的是四川账号列表）', () => {
    const sx = QUICK_LOGIN_USERS_BY_BRANCH.SX;
    expect(sx).toHaveLength(12);
    expect(sx[0]).toEqual({ username: 'sxAdmin', displayName: '山西分公司管理员', role: UserRole.BRANCH_ADMIN });
    expect(sx.map((u) => u.username)).not.toContain('admin');
    expect(sx.map((u) => u.username)).not.toContain('leshan');
  });

  it('SX 机构账号名与 SX_ORGANIZATIONS 机构清单一一对应', () => {
    const sxOrgUserDisplayNames = QUICK_LOGIN_USERS_BY_BRANCH.SX
      .filter((u) => u.role === UserRole.ORG_USER)
      .map((u) => u.displayName.replace(/机构$/, ''));
    expect(sxOrgUserDisplayNames).toEqual([...SX_ORGANIZATIONS]);
  });
});
