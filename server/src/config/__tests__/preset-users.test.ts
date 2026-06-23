/**
 * preset-users helper 函数单测。
 * 0B：getAllBranchCodes — cache-warmer 按 branch 预热的循环源头。
 */
import { describe, it, expect } from 'vitest';
import {
  PRESET_USERS,
  getAllBranchCodes,
  getAllPermissionScopes,
  ORG_ROLE_ALLOWED_ROUTES,
  ORG_ROLE_DEFAULT_ROUTE,
} from '../preset-users.js';

describe('getAllBranchCodes', () => {
  it('返回 PRESET_USERS 中所有唯一 branchCode（已排序）', () => {
    const codes = getAllBranchCodes();
    expect(Array.isArray(codes)).toBe(true);
    // G7 山西多省接入后：SC（四川）+ SX（山西）两个分公司
    expect(codes).toEqual(['SC', 'SX']);
  });

  it('结果为 PRESET_USERS 中所有 branchCode 字段的去重 + 字典序排序', () => {
    const codes = getAllBranchCodes();
    const setFromPresets = new Set<string>();
    for (const u of Object.values(PRESET_USERS)) {
      if (u.branchCode) setFromPresets.add(u.branchCode);
    }
    const sortedFromPresets = Array.from(setFromPresets).sort();
    expect(codes).toEqual(sortedFromPresets);
  });

  it('排序确定性：多次调用返回相同顺序', () => {
    expect(getAllBranchCodes()).toEqual(getAllBranchCodes());
  });

  it('与 getAllPermissionScopes 是正交维度（branch ≠ org scope）', () => {
    const branches = getAllBranchCodes();
    const scopes = getAllPermissionScopes();
    // 两者不应该有交集（branch 是 SC/SX；scope 是 all/乐山/...）
    const overlap = branches.filter((b) => scopes.includes(b));
    expect(overlap).toEqual([]);
  });

  it('包含山西分公司 SX', () => {
    expect(getAllBranchCodes()).toContain('SX');
  });
});

describe('山西分公司（SX）账号 — G7 多省接入', () => {
  // 权威经营单元名：数据管理/config/branch-org-mapping/SX.json 的 "units"
  // （= ETL 规范化后的 org_level_3 值）。新增/改名须与该文件同步。
  const SX_UNITS = [
    '太原一部',
    '太原二部',
    '经代、车商、重客',
    '大同',
    '阳泉',
    '长治',
    '晋城',
    '晋中',
    '运城',
    '临汾',
    '吕梁',
  ];

  it('山西超管 sxAdmin 存在且 role=branch_admin / branchCode=SX / specialFeatures 含 cost+moto_cost', () => {
    const admin = PRESET_USERS.sxAdmin;
    expect(admin).toBeDefined();
    expect(admin.role).toBe('branch_admin');
    expect(admin.branchCode).toBe('SX');
    expect(admin.specialFeatures).toContain('cost');
    expect(admin.specialFeatures).toContain('moto_cost');
    // 超管不绑定单一 organization
    expect(admin.organization).toBeUndefined();
  });

  it('山西超管 yangjie0621 存在且 role=branch_admin / branchCode=SX', () => {
    const admin = PRESET_USERS.yangjie0621;
    expect(admin).toBeDefined();
    expect(admin.role).toBe('branch_admin');
    expect(admin.branchCode).toBe('SX');
    // dataScope='all' 由 role=branch_admin 经 PRESET_ROLES 派生（branch_admin → all）
    // 超管不绑定单一 organization
    expect(admin.organization).toBeUndefined();
  });

  it('11 个山西经营单元 org_user 全部存在、branchCode=SX、organization 与 SX.json 一致', () => {
    const sxOrgUsers = Object.values(PRESET_USERS).filter(
      (u) => u.branchCode === 'SX' && u.role === 'org_user'
    );
    // 数量 = 11 经营单元
    expect(sxOrgUsers).toHaveLength(SX_UNITS.length);
    // organization 集合严格等于 SX.json 的 11 单元
    const orgs = sxOrgUsers.map((u) => u.organization).sort();
    expect(orgs).toEqual([...SX_UNITS].sort());
    // 每个 org_user 结构镜像 SC：allowedRoutes/defaultRoute 来自 ORG_ROLE 常量
    for (const u of sxOrgUsers) {
      expect(u.allowedRoutes).toEqual(ORG_ROLE_ALLOWED_ROUTES);
      expect(u.defaultRoute).toBe(ORG_ROLE_DEFAULT_ROUTE);
    }
  });

  it('SX 账号密码均为 tombstone 占位（bcrypt 格式，不含明文）', () => {
    const sxUsers = Object.values(PRESET_USERS).filter((u) => u.branchCode === 'SX');
    // sxAdmin + yangjie0621（2 超管）+ 11 org_user = 13
    expect(sxUsers).toHaveLength(13);
    for (const u of sxUsers) {
      expect(u.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    }
  });

  it('SX 账号全部 active:false — 山西上线前不可登录（auth.ts 第 121 行闸：!user.active → 403）', () => {
    const sxUsers = Object.values(PRESET_USERS).filter((u) => u.branchCode === 'SX');
    // 确保所有 SX 账号都显式设置了 active:false
    expect(sxUsers.length).toBeGreaterThan(0);
    for (const u of sxUsers) {
      expect(u.active).toBe(false);
    }
  });
});
