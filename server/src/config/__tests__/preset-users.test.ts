/**
 * preset-users helper 函数单测。
 * 0B：getAllBranchCodes — cache-warmer 按 branch 预热的循环源头。
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
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

  it('SX 账号密码均为「构造式 tombstone」占位（bcrypt 格式 + 含 Tombstone 标记 → fail-safe，绝非真实凭据）', () => {
    const sxUsers = Object.values(PRESET_USERS).filter((u) => u.branchCode === 'SX');
    // sxAdmin + yangjie0621（2 超管）+ 11 org_user = 13
    expect(sxUsers).toHaveLength(13);
    for (const u of sxUsers) {
      // 1) bcrypt 60 字符格式（可被 bcrypt.compare 解析而不抛错）
      expect(u.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(u.passwordHash).toHaveLength(60);
      // 2) 必须是构造式 tombstone（含 "Tombstone" 可辨标记）。真实口令的 bcrypt 哈希几乎
      //    不可能含此字面子串 → 该断言拦截「误把真实凭据写进预置表」的回归。
      //    根因：yangjie0621 曾用正常 bcrypt 真哈希占位（非 fail-safe）——漏注入 USER_PASSWORDS
      //    且误激活时会回落到该哈希（auth.ts: passwordOverride ?? user.passwordHash），若明文已知即成后门。
      //    改为构造式 tombstone 后 bcrypt.compare 对任意明文恒 false。
      expect(u.passwordHash).toMatch(/Tombstone/i);
    }
  });

  // timeout 30s：bcrypt cost=10 × 13 账号 × 2 明文真跑（满载并发下单条 ~70ms）。
  // 默认 5s 在跑全量套件（4000+ 测试争 CPU）时会超时变 flaky——曾因此 pre-push 失败一次。
  it('SX 账号 tombstone 行为闸：bcrypt.compare 对任意明文恒 false 且不抛错（fail-safe 真验证，非仅校验字符串形态）', () => {
    const sxUsers = Object.values(PRESET_USERS).filter((u) => u.branchCode === 'SX');
    // 字符串形态断言（含 /Tombstone/）只防「写错占位」，不保证 bcrypt 能解析。
    // salt 段一旦构造非法，bcrypt.compare 会「抛错」→ 登录返回 500 而非 401，且上层 catch 行为不可控。
    // 故此处对每个占位哈希做真实 bcrypt.compare：必须返回 false（拒绝登录）且不得抛错。
    // 候选取「用户名本身」（最危险的可预测明文）+ 空串（边界）；二者任一 false 即证占位哈希体为废值。
    for (const u of sxUsers) {
      for (const pwd of [u.username, '']) {
        expect(() => bcrypt.compareSync(pwd, u.passwordHash)).not.toThrow();
        expect(bcrypt.compareSync(pwd, u.passwordHash)).toBe(false);
      }
    }
  }, 30000);

  it('SX 账号全部 active:true — 山西已于 2026-06-26 完成 cutover 步⑥发账号上线', () => {
    const sxUsers = Object.values(PRESET_USERS).filter((u) => u.branchCode === 'SX');
    // 山西上线后预置表 active 翻 true（passwordHash 仍 tombstone：见上一条 tombstone 行为闸，
    // 即便 re-seed 也需生产 USER_PASSWORDS 真凭据才能登录，源码本身永不成后门）。
    expect(sxUsers.length).toBeGreaterThan(0);
    for (const u of sxUsers) {
      expect(u.active).toBe(true);
    }
  });
});
