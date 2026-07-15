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
  getPresetVisibleBranches,
  ORG_ROLE_ALLOWED_ROUTES,
  ORG_ROLE_DEFAULT_ROUTE,
  RESTRICTED_MODULES,
  ACCESS_CONTROL_PAGE,
  canAccessRestrictedModule,
  getDeniedModules,
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
  // 2026-07-15 经代/车商/重客 拆分（BACKLOG 2026-07-15-user-e04971）：11 → 13。
  const SX_UNITS = [
    '太原一部',
    '太原二部',
    '经代',
    '车商',
    '重客',
    '大同',
    '阳泉',
    '长治',
    '晋城',
    '晋中',
    '运城',
    '临汾',
    '吕梁',
  ];
  // 已退役合并账号（active:false 墓碑保留，防 preset 兜底写回复活）
  const RETIRED_SX_ORG_USERS = ['sx_jdcszk'];

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

  it('13 个山西经营单元活跃 org_user 全部存在、branchCode=SX、organization 与 SX.json 一致', () => {
    const sxOrgUsers = Object.values(PRESET_USERS).filter(
      (u) => u.branchCode === 'SX' && u.role === 'org_user' && u.active !== false
    );
    // 数量 = 13 经营单元（退役墓碑账号 active:false 不计入）
    expect(sxOrgUsers).toHaveLength(SX_UNITS.length);
    // organization 集合严格等于 SX.json 的 13 单元
    const orgs = sxOrgUsers.map((u) => u.organization).sort();
    expect(orgs).toEqual([...SX_UNITS].sort());
    // 每个 org_user 结构镜像 SC：allowedRoutes/defaultRoute 来自 ORG_ROLE 常量
    for (const u of sxOrgUsers) {
      expect(u.allowedRoutes).toEqual(ORG_ROLE_ALLOWED_ROUTES);
      expect(u.defaultRoute).toBe(ORG_ROLE_DEFAULT_ROUTE);
    }
  });

  it('退役合并账号 sx_jdcszk 保留为 active:false 墓碑（经代/车商/重客拆分，防 preset 兜底写回复活）', () => {
    for (const username of RETIRED_SX_ORG_USERS) {
      const u = PRESET_USERS[username];
      expect(u, username).toBeDefined();
      expect(u.active).toBe(false);
      // 退役账号的 organization 是已拆除的旧合并值——不得出现在现行 units 里
      expect(SX_UNITS).not.toContain(u.organization);
      // 仍是 tombstone（不可登录）
      expect(u.passwordHash).toMatch(/Tombstone/i);
    }
  });

  it('SX 账号密码均为「构造式 tombstone」占位（bcrypt 格式 + 含 Tombstone 标记 → fail-safe，绝非真实凭据）', () => {
    const sxUsers = Object.values(PRESET_USERS).filter((u) => u.branchCode === 'SX');
    // sxAdmin + yangjie0621（2 超管）+ 6 车险部个人 branch_admin（2026-07-11 发放）
    // + 13 活跃 org_user + 1 退役墓碑（sx_jdcszk，2026-07-15 拆分）= 22
    expect(sxUsers).toHaveLength(22);
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

  it('SX 账号除退役墓碑外全部 active:true — 山西已于 2026-06-26 完成 cutover 步⑥发账号上线', () => {
    const sxUsers = Object.values(PRESET_USERS).filter(
      (u) => u.branchCode === 'SX' && !RETIRED_SX_ORG_USERS.includes(u.username)
    );
    // 山西上线后预置表 active 翻 true（passwordHash 仍 tombstone：见上一条 tombstone 行为闸，
    // 即便 re-seed 也需生产 USER_PASSWORDS 真凭据才能登录，源码本身永不成后门）。
    // 退役墓碑账号（RETIRED_SX_ORG_USERS）由专项用例断言 active:false。
    expect(sxUsers.length).toBeGreaterThan(0);
    for (const u of sxUsers) {
      expect(u.active).toBe(true);
    }
  });
});

describe('总部超管 + 市州一把手（2026-07-12 发放）', () => {
  // 市州一把手 → 复用现有 SC org_user 的 organization（已验证精确匹配 org_level_3）
  const CITY_HEADS = [
    { username: 'yibinzong', organization: '宜宾' },
    { username: 'leshanzong', organization: '乐山' },
    { username: 'dazhouzong', organization: '达州' },
    { username: 'luzhouzong', organization: '泸州' },
  ];

  it('zongbu 是全国超管：role=branch_admin / branchCode=SC / visibleBranches=[SC,SX] / cost+moto_cost', () => {
    const u = PRESET_USERS.zongbu;
    expect(u).toBeDefined();
    expect(u.role).toBe('branch_admin');
    expect(u.branchCode).toBe('SC'); // 默认省，保 fail-closed 不变量（无人缺 branchCode）
    expect(u.visibleBranches).toEqual(['SC', 'SX']); // 全国超管恒见所有省（不变量下方锁死）
    expect(u.specialFeatures).toContain('cost');
    expect(u.specialFeatures).toContain('moto_cost');
    expect(u.organization).toBeUndefined(); // 超管不绑定单一 organization
    expect(u.active).toBe(true);
  });

  it('4 个市州一把手：role=org_user（dataScope=org）/ branchCode=SC / organization 精确匹配 / 只读结构镜像', () => {
    for (const { username, organization } of CITY_HEADS) {
      const u = PRESET_USERS[username];
      expect(u, username).toBeDefined();
      expect(u.role).toBe('org_user'); // org_user → dataScope=org（PRESET_ROLES 派生），天然只读本机构
      expect(u.branchCode).toBe('SC');
      expect(u.organization).toBe(organization);
      expect(u.allowedRoutes).toEqual(ORG_ROLE_ALLOWED_ROUTES);
      expect(u.defaultRoute).toBe(ORG_ROLE_DEFAULT_ROUTE);
      expect(u.active).toBe(true);
      expect(u.visibleBranches).toBeUndefined(); // 非超管，无跨省视图
    }
  });

  // timeout 30s：本测试自身只做字符串断言，但全量套件（5000+ 测试）满载时同文件 bcrypt 测试
  // 抢占 worker CPU，默认 5s 会被饿死超时（2026-07-15 本机全量复现两次）。与本文件既有先例一致放宽。
  it('5 账号密码均为「构造式 tombstone」占位（bcrypt 60 字符格式 + 含 Tombstone 标记 → fail-safe）', () => {
    for (const username of ['zongbu', ...CITY_HEADS.map((c) => c.username)]) {
      const u = PRESET_USERS[username];
      expect(u.passwordHash, username).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(u.passwordHash, username).toHaveLength(60);
      expect(u.passwordHash, username).toMatch(/Tombstone/i);
      // 行为闸：bcrypt.compare 对任意明文恒 false 且不抛错（真验证占位哈希为废值，非仅字符串形态）
      for (const pwd of [username, '']) {
        expect(() => bcrypt.compareSync(pwd, u.passwordHash)).not.toThrow();
        expect(bcrypt.compareSync(pwd, u.passwordHash)).toBe(false);
      }
    }
  }, 30000);
});

describe('全国超管 visibleBranches（切省 + 全国合并视图）', () => {
  it('xuechenglong 是全国超管：branchCode=SC（默认省，保 fail-closed 不变量）+ visibleBranches=[SC,SX]', () => {
    const u = PRESET_USERS.xuechenglong;
    expect(u).toBeDefined();
    expect(u.role).toBe('branch_admin');
    expect(u.branchCode).toBe('SC'); // 保留默认省 → 不破 permission.test.ts:181「无人缺 branchCode」
    expect(u.visibleBranches).toEqual(['SC', 'SX']);
  });

  it('普通用户 visibleBranches 为 undefined（行为不变）', () => {
    // 抽样若干普通用户（SC org_user / SX 超管 / 系统 admin）
    expect(PRESET_USERS.leshan.visibleBranches).toBeUndefined();
    expect(PRESET_USERS.sxAdmin.visibleBranches).toBeUndefined();
    expect(PRESET_USERS.admin.visibleBranches).toBeUndefined();
    expect(PRESET_USERS.tianfu.visibleBranches).toBeUndefined();
  });

  // ★ 安全不变量（codex 闸-1 P1-1 的核心前提）：
  //   permission.ts 对 targetBranch=ALL 用「不拼 branch_code（baseFilter）」实现合并视图，
  //   这只有在「全国超管的 visibleBranches == 系统所有省」时才与「合并 visibleBranches 全集」等价，
  //   否则会泄漏不在 visibleBranches 内的省。本测试把该等价关系锁死：加第 3 省时若忘了同步加进
  //   超管的 visibleBranches，此处即红，强制开发者补齐（数据驱动扩展，禁硬编码省份）。
  it('【安全不变量】任一带 visibleBranches 的用户，其 visibleBranches == getAllBranchCodes()（全国超管恒见所有省）', () => {
    const allBranches = getAllBranchCodes(); // ['SC','SX']
    const superAdmins = Object.values(PRESET_USERS).filter(
      (u) => u.visibleBranches && u.visibleBranches.length > 0
    );
    expect(superAdmins.length).toBeGreaterThan(0); // xuechenglong + zongbu（2026-07-12 新增）
    for (const u of superAdmins) {
      // 角色必须是 branch_admin（permission.ts 仅 branch_admin 认 visibleBranches，防 org_user 越权）
      expect(u.role).toBe('branch_admin');
      // 集合相等（顺序无关）
      expect([...u.visibleBranches!].sort()).toEqual([...allBranches].sort());
    }
  });

  it('getPresetVisibleBranches: 超管返回省集合，普通用户返回 undefined', () => {
    expect(getPresetVisibleBranches('xuechenglong')).toEqual(['SC', 'SX']);
    expect(getPresetVisibleBranches('leshan')).toBeUndefined();
    expect(getPresetVisibleBranches('sxAdmin')).toBeUndefined();
    expect(getPresetVisibleBranches('不存在的用户')).toBeUndefined();
  });

  it('getPresetVisibleBranches 返回副本（不可变，外部 mutate 不影响 PRESET_USERS）', () => {
    const vb = getPresetVisibleBranches('xuechenglong')!;
    vb.push('ZZ');
    expect(PRESET_USERS.xuechenglong.visibleBranches).toEqual(['SC', 'SX']);
  });
});

/**
 * 全局 tombstone 不变量（安全审查 H1 · RED LINE）：
 * 所有账号（不限省份/批次）的 passwordHash 必须是构造式 tombstone——源码永不含真实可登录哈希。
 * 这是防「未来又把 bcrypt(明文) 写进源码」的 durable 回归闸；此前只有 SX/zongbu 分批断言，
 * 存量四川账号（admin/leshan/... 约 19 个）曾带真实哈希 = 漏注入 USER_PASSWORDS key 即后门。
 */
describe('全局 tombstone 不变量（H1）', () => {
  const entries = Object.entries(PRESET_USERS);

  it.each(entries)('%s 的 passwordHash 是合法格式的构造式 tombstone', (_username, user) => {
    // 字符串形态闸：标准 bcrypt 前缀 + 长度 60 + 含 Tombstone 标记
    expect(user.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(user.passwordHash).toHaveLength(60);
    expect(user.passwordHash).toMatch(/Tombstone/i);
  });

  it(
    '每个账号 bcrypt.compare 对代表性明文恒 false 且不抛（行为闸）',
    () => {
      // cost=10 × N 账号 × 4 明文，默认 5s 超时在全量套件下会 flaky。曾放宽到 30s 仍在
      // 5000+ 测试满载时超时（2026-07-15 本机全量复现两次，单文件跑仅 ~16s）→ 再放宽到 60s。
      const candidates = ['', 'Chexian@2026', 'password'];
      for (const [username, user] of entries) {
        for (const pw of [username, ...candidates]) {
          expect(bcrypt.compareSync(pw, user.passwordHash)).toBe(false);
        }
      }
    },
    60000,
  );

  it('所有 tombstone 唯一（防 codemod 生成碰撞）', () => {
    const hashes = entries.map(([, u]) => u.passwordHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

/**
 * 模块负面清单（RESTRICTED_MODULES · 2026-07-15 用户指令 · RED LINE）：
 * 权限管理模块仅限 薛成龙/杨杰/林霞 三位业务管理员 + admin（系统运维兜底），
 * 其余账号（总经理室/车险部员工在内）一律拒绝——fail-closed，新增账号默认无权限管理。
 */
describe('模块负面清单 RESTRICTED_MODULES', () => {
  const ACCESS_CONTROL_ALLOWLIST = ['admin', 'xuechenglong', 'yangjie0621', 'linxia'];

  it('权限管理模块白名单锁死为 admin + 薛成龙 + 杨杰 + 林霞（改名单须过本测试）', () => {
    expect([...RESTRICTED_MODULES[ACCESS_CONTROL_PAGE]].sort()).toEqual(
      [...ACCESS_CONTROL_ALLOWLIST].sort(),
    );
  });

  it('白名单内用户可访问权限管理，其余全部 PRESET_USERS 账号被拒', () => {
    for (const username of Object.keys(PRESET_USERS)) {
      const expected = ACCESS_CONTROL_ALLOWLIST.includes(username);
      expect(canAccessRestrictedModule(username, ACCESS_CONTROL_PAGE)).toBe(expected);
    }
  });

  it('未登记在负面清单的模块对任意用户恒放行（负面清单语义）', () => {
    expect(canAccessRestrictedModule('liangchunfan', '/cost')).toBe(true);
    expect(canAccessRestrictedModule('unknown-user', '/dashboard')).toBe(true);
  });

  it('getDeniedModules：白名单外用户回传权限管理页路径，白名单内为空', () => {
    expect(getDeniedModules('liangchunfan')).toEqual([ACCESS_CONTROL_PAGE]);
    expect(getDeniedModules('chexianbu')).toEqual([ACCESS_CONTROL_PAGE]);
    expect(getDeniedModules('sxAdmin')).toEqual([ACCESS_CONTROL_PAGE]);
    expect(getDeniedModules('xuechenglong')).toEqual([]);
    expect(getDeniedModules('yangjie0621')).toEqual([]);
    expect(getDeniedModules('linxia')).toEqual([]);
    expect(getDeniedModules('admin')).toEqual([]);
  });
});
