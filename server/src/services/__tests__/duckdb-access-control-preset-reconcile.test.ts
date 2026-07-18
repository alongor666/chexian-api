/**
 * preset ↔ store 字段对账 · 真实 DuckDB + 真实落盘的端到端锁（2026-07-15）
 *
 * 为什么需要这一层（同目录 access-control-preset-reconcile.test.ts 之外）：
 * 那份 mock 单测只捕获 SQL 文本、不把 UPDATE 应用回内存表，因此**锁不住"回填是否真的落盘"**——
 * 实测把 access-control.ts 里 `await persistToFile()` 整行删掉，那 6 个用例仍然全绿（评审
 * 指出 + 变异验证复现）。而"回填了但没落盘"正是最坏的静默失败：进程内看着已修复，PM2
 * reload / 重启后 store 仍缺 branch_code，账号继续 401/403，且日志还打印"已持久化"。
 *
 * 本文件用**真实 DuckDB（:memory:）+ 真实临时 user_store.json** 锁死三件事：
 *   1. 回填后 user_store.json 真的写入了 branchCode（锁 persistToFile 调用，杀上述变异）
 *   2. 二次启动（读回落盘的 store）幂等：不再发 UPDATE、不再重写文件
 *   3. 凭据字段跨对账不变（passwordHash / passwordChangedAt / PasswordCredential）
 *
 * 分层依据（CLAUDE.md §5「CI 测试分层协议」）：本用例走 DuckDB 原生绑定，jsdom 环境无法
 * 加载 .node，故命名为 duckdb-* 落到 vitest.integration.config.ts（node 环境），
 * 并自带合成数据、不依赖 warehouse parquet。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-preset-reconcile-'));
const storePath = path.join(tmpDir, 'user_store.json');

vi.mock('../../config/paths.js', () => ({
  getUserStorePath: () => storePath,
}));

const { duckdbService } = await import('../duckdb.js');
const { seedAccessControlData, createUser, getUserByUsername, canonicalizeUsername } = await import(
  '../access-control.js'
);
const { PRESET_USERS, PRESET_ROLES } = await import('../../config/preset-users.js');

/** 早于 branchCode 引入（2026-06-05）的存量行：整个 branchCode 键都不存在 */
const LEGACY_NO_BRANCH = ['tianfu', 'leshan'] as const;
/** 运行时自设过密码的真实哈希（对账绝不可覆盖它） */
const SELF_SET_HASH = '$2b$10$SelfSetRuntimeHash000000000000000000000000000000000000';
const SELF_SET_AT = '2026-07-01T00:00:00.000Z';

type StoreUser = Record<string, unknown>;

/**
 * 造一份贴近真实形态的 store：含全部 preset 账号（避免走"缺账号补建"路径干扰），
 * 其中 LEGACY_NO_BRANCH 这几行**不含 branchCode 键**，tianfu 另带运行时自设密码。
 */
function buildStore(): { users: StoreUser[]; roles: unknown[] } {
  const users: StoreUser[] = Object.values(PRESET_USERS).map((p) => {
    const u: StoreUser = {
      id: `uid-${p.username}`,
      username: p.username,
      displayName: p.displayName,
      passwordHash: p.passwordHash,
      role: p.role,
      active: true,
    };
    if (p.organization) u.organization = p.organization;
    if (p.allowedRoutes) u.allowedRoutes = p.allowedRoutes;
    if (p.defaultRoute) u.defaultRoute = p.defaultRoute;
    if (p.specialFeatures) u.specialFeatures = p.specialFeatures;
    // 关键：legacy 行整个 branchCode 键缺席（模拟 2026-06-05 之前 seed 的行）
    if (p.branchCode && !LEGACY_NO_BRANCH.includes(p.username as never)) {
      u.branchCode = p.branchCode;
    }
    // tianfu：运行时已自设密码 —— 对账绝不可覆盖 passwordHash / passwordChangedAt
    if (p.username === 'tianfu') {
      u.passwordHash = SELF_SET_HASH;
      u.passwordChangedAt = SELF_SET_AT;
    }
    return u;
  });
  const roles = PRESET_ROLES.map((r) => ({
    role: r.role,
    name: r.name,
    dataScope: r.dataScope,
    allowedRoutes: r.allowedRoutes,
    defaultRoute: r.defaultRoute,
  }));
  return { users, roles };
}

function writeStore(): void {
  fs.writeFileSync(
    storePath,
    JSON.stringify({ version: 2, exportedAt: '2026-07-01T00:00:00.000Z', ...buildStore() }, null, 2),
    'utf-8'
  );
}

function readStore(): { users: StoreUser[]; exportedAt: string } {
  return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
}

function findUser(username: string): StoreUser {
  const u = readStore().users.find((x) => x.username === username);
  expect(u, `store 应含账号 ${username}`).toBeDefined();
  return u!;
}

/** 统计对 branch_code 的 UPDATE 次数（用于幂等断言） */
function countBranchCodeUpdates(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(
    (c) => typeof c[0] === 'string' && /UPDATE UserAccount/.test(c[0]) && /branch_code =/.test(c[0])
  ).length;
}

beforeAll(async () => {
  await duckdbService.init();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  writeStore();
  vi.restoreAllMocks();
});

describe('preset 对账 · 真实 DuckDB + 真实落盘', () => {
  it('回填后 user_store.json 真的写入 branchCode（锁 persistToFile —— 删掉它本用例必须红）', async () => {
    // 前置：legacy 行确实没有 branchCode 键
    for (const name of LEGACY_NO_BRANCH) {
      expect(findUser(name).branchCode, `${name} 回填前不应有 branchCode`).toBeUndefined();
    }

    await seedAccessControlData();

    // ★ 核心断言：读**磁盘上的** store，而非进程内状态
    for (const name of LEGACY_NO_BRANCH) {
      expect(findUser(name).branchCode, `${name} 应已按 preset 回填并落盘`).toBe(
        PRESET_USERS[name].branchCode
      );
    }
  });

  it('二次启动幂等：不再发 branch_code UPDATE，也不重写 store 文件', async () => {
    await seedAccessControlData(); // 第一次：回填并落盘
    const afterFirst = readStore().exportedAt;

    // 第二次启动 = 重新从落盘的 store 载入（loadFromStore 会 DELETE + INSERT 重建内存表）
    const spy = vi.spyOn(duckdbService, 'query');
    await seedAccessControlData();

    expect(countBranchCodeUpdates(spy), '二次启动不应再回填').toBe(0);
    expect(readStore().exportedAt, '二次启动不应重写 store（persistToFile 不该被调用）').toBe(
      afterFirst
    );
    // 且值仍在（不是被抹掉后"看起来幂等"）
    for (const name of LEGACY_NO_BRANCH) {
      expect(findUser(name).branchCode).toBe(PRESET_USERS[name].branchCode);
    }
  });

  it('【RED LINE】凭据字段跨对账不变：运行时自设的 passwordHash / passwordChangedAt 原样保留', async () => {
    await seedAccessControlData();

    const tianfu = findUser('tianfu');
    expect(tianfu.branchCode, 'tianfu 的 branch_code 应被回填').toBe('SC');
    // 同一行上：branch_code 变了，凭据一个字节都不能动
    expect(tianfu.passwordHash, '运行时自设哈希不得被 preset tombstone 覆盖').toBe(SELF_SET_HASH);
    expect(tianfu.passwordChangedAt, 'password_changed_at 不得被清空').toBe(SELF_SET_AT);
  });

  it('全量凭据快照：对账前后所有账号的 passwordHash 零变化', async () => {
    const before = new Map(readStore().users.map((u) => [u.username as string, u.passwordHash]));

    await seedAccessControlData();

    const changed = readStore()
      .users.filter((u) => before.has(u.username as string))
      .filter((u) => before.get(u.username as string) !== u.passwordHash)
      .map((u) => u.username);
    expect(changed, '对账不得改动任何账号的 passwordHash').toEqual([]);
  });

  it('【RED LINE】用户名大小写：store 存量大写行不产生重复行（根治 sxAdmin/sxadmin 分裂）', async () => {
    // 造存量非规范行：把 store 里 sxadmin 的 username 改成历史大写形态 'SxAdmin'
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const row = store.users.find((u: StoreUser) => u.username === 'sxadmin');
    expect(row, 'preset 应含 sxadmin（本用例的前置）').toBeDefined();
    row.username = 'SxAdmin';
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
    expect(PRESET_USERS.sxadmin.username).toBe('sxadmin'); // preset 是 canonical 小写

    await seedAccessControlData();

    // ★ 核心：reconcile 不得因大小写差异把 sxadmin 再建一行。
    // 修复前 getUserByUsername 大小写敏感 → 查 'sxadmin' 找不到 'SxAdmin' → ensureUserFromPreset 重建 → 2 行。
    const matches = readStore().users.filter(
      (u) => canonicalizeUsername(String(u.username)) === 'sxadmin'
    );
    expect(matches.map((u) => u.username), 'sxadmin 只应有一行（大小写不敏感去重）').toHaveLength(1);
  });

  it('【RED LINE】用户名大小写：管理面建 NewUser 后按 newuser 可查到，且大小写变体建号被拒', async () => {
    await seedAccessControlData();

    // 管理面 schema 接受任意大小写 → 服务层必须落 canonical，否则登录（查小写）恒找不到
    const created = await createUser({
      username: 'NewUser',
      displayName: '大小写测试账号',
      passwordHash: '$2b$10$CaseTestTombstone00000000000000000000000000000000000u',
      role: 'org_user',
      organization: '天府',
      branchCode: 'SC',
    });
    expect(created.username, '落库用户名必须是 canonical 小写').toBe('newuser');

    // 登录路径按 canonical 查（auth.ts normalizeUsername → 小写）：必须命中
    await expect(getUserByUsername('newuser')).resolves.toMatchObject({ username: 'newuser' });
    // 原样大写也命中（查询大小写不敏感）
    await expect(getUserByUsername('NewUser')).resolves.toMatchObject({ username: 'newuser' });

    // 大小写变体不得绕过唯一性建出第二个账号
    await expect(
      createUser({
        username: 'NEWUSER',
        displayName: '重复账号',
        passwordHash: '$2b$10$CaseTestTombstone00000000000000000000000000000000000u',
        role: 'org_user',
        organization: '天府',
        branchCode: 'SC',
      })
    ).rejects.toThrow('用户名已存在');
  });

  it('store 已有值不被覆盖：store=SX 而 preset=SC 时保留 SX（运维权威）', async () => {
    // admin 的 preset 是 SC；把 store 侧改成 SX 模拟管理面有意改省
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const admin = store.users.find((u: StoreUser) => u.username === 'admin');
    admin.branchCode = 'SX';
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
    expect(PRESET_USERS.admin.branchCode).toBe('SC');

    await seedAccessControlData();

    expect(findUser('admin').branchCode, 'store 已有值不得被 preset 回滚').toBe('SX');
  });
});
