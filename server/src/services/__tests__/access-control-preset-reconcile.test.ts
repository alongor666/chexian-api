/**
 * preset ↔ store 用户字段对账不变量（2026-07-15）
 *
 * 背景：ensureUserFromPreset 只在账号**不存在**时按 PRESET_USERS 建行，此后 preset 里新增/
 * 修正的字段对已存在的行永不生效 —— 源码与运行时 store 静默漂移。实证：branchCode 于
 * 2026-06-05 多省改造（commit 72e0effa）才进 preset，早于此 seed 的 store 里 org_user 至今
 * 没有该字段 → 登录 JWT 缺 branchCode → 报告门户 resolvePortalScope fail-closed 403。
 * 生产未炸只是被 permission.ts 的「缺 branchCode 即 401」另一条 fail-closed 掩盖。
 *
 * 本测试锁死回填的**边界**（这是本次修复最容易回归的地方）：
 *   1. branch_code 缺失 → 自动回填（约束型 + 缺失即 fail-closed + 空值绝非运维意图）
 *   2. branch_code 已有值 → 绝不覆盖（store 是运维权威）
 *   3. 凭据 / 授权 / 生命周期字段 → 绝不回填（回填 = 破坏凭据链或提权）
 *
 * 测试层级：mock duckdbService 捕获 SQL（不依赖真实 DuckDB / 落盘目录指向 tmp），
 * 与 access-control-admin-reset.test.ts 同款harness。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-control-preset-reconcile-'));
const storePath = path.join(tmpDir, 'user_store.json');

vi.mock('../../config/paths.js', () => ({
  getUserStorePath: () => storePath,
}));

/** 当前 store 里的用户行（模拟 UserAccount 表），key = username */
let userRows: Record<string, Record<string, unknown>> = {};
const executedSql: string[] = [];

const mockQuery = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
  executedSql.push(sql);
  const normalized = sql.trim();
  // getUserByUsername
  const byUsername = normalized.match(/SELECT \*\s+FROM UserAccount\s+WHERE username = '([^']*)'/);
  if (byUsername) {
    const row = userRows[byUsername[1]];
    return row ? [row] : [];
  }
  // listUsersInternal（persistToFile 用）
  if (normalized.startsWith('SELECT * FROM UserAccount ORDER BY username')) {
    return Object.values(userRows);
  }
  // ensureUserFromPreset 的建行：登记到 userRows，使其尾部回读能命中
  // （否则 seedAccessControlData 遍历到任何不在 userRows 的 preset 账号都会 throw）。
  if (normalized.startsWith('INSERT INTO UserAccount')) {
    const m = normalized.match(/VALUES \(\s*'([^']*)',\s*'([^']*)'/);
    if (m) {
      const [, id, username] = m;
      userRows[username] = { ...makeRow(username), id };
    }
    return [];
  }
  return [];
});

vi.mock('../duckdb.js', () => ({
  duckdbService: { query: (sql: string) => mockQuery(sql) },
}));

import { seedAccessControlData } from '../access-control.js';
import { PRESET_USERS } from '../../config/preset-users.js';

/** 造一行 store 用户（字段名对齐 UserAccount 列名，mapUserRow 消费） */
function makeRow(username: string, overrides: Record<string, unknown> = {}) {
  const preset = PRESET_USERS[username];
  return {
    id: `uid-${username}`,
    username,
    display_name: preset.displayName,
    password_hash: preset.passwordHash,
    role: preset.role,
    organization: preset.organization ?? null,
    branch_code: null, // 默认模拟「早于 branchCode 引入」的存量行
    allowed_routes: preset.allowedRoutes ? JSON.stringify(preset.allowedRoutes) : null,
    default_route: preset.defaultRoute ?? null,
    allowed_ips: null,
    special_features: preset.specialFeatures ? JSON.stringify(preset.specialFeatures) : null,
    active: true,
    password_changed_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 写一份 store 文件，使 seedAccessControlData 走 loadFromStore（而非 seedFromPreset）分支 */
function writeStore(): void {
  fs.writeFileSync(
    storePath,
    JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), users: [], roles: [] }),
    'utf-8'
  );
}

/** 取针对某账号发出的 UPDATE UserAccount 语句 */
function updatesFor(username: string): string[] {
  return executedSql.filter(
    (s) => s.trim().startsWith('UPDATE UserAccount') && s.includes(`'uid-${username}'`)
  );
}

beforeEach(() => {
  executedSql.length = 0;
  mockQuery.mockClear();
  userRows = {};
  writeStore();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('seedAccessControlData · preset → store 字段对账', () => {
  it('存量行缺 branch_code → 按 preset 回填（tianfu: NULL → SC）', async () => {
    userRows.tianfu = makeRow('tianfu', { branch_code: null });

    await seedAccessControlData();

    const updates = updatesFor('tianfu');
    expect(updates, 'branch_code 缺失应触发回填 UPDATE').toHaveLength(1);
    expect(updates[0]).toMatch(/branch_code = 'SC'/);
  });

  it('存量行已有 branch_code → 绝不覆盖（即便与 preset 不同：store 是运维权威）', async () => {
    // 本机 store 实测存在 admin=SX 而 preset=SC 的情形；覆盖会把运维决策悄悄回滚。
    expect(PRESET_USERS.admin.branchCode).toBe('SC');
    userRows.admin = makeRow('admin', { branch_code: 'SX' });

    await seedAccessControlData();

    expect(updatesFor('admin'), 'branch_code 已有值不应被改写').toHaveLength(0);
  });

  it('branch_code 与 preset 一致 → 幂等，不产生多余写入', async () => {
    userRows.tianfu = makeRow('tianfu', { branch_code: 'SC' });

    await seedAccessControlData();

    expect(updatesFor('tianfu')).toHaveLength(0);
  });

  it('【RED LINE】回填绝不触碰凭据 / 授权 / 生命周期字段', async () => {
    // 若回填 password_hash → 破坏 auth.ts resolveEffectiveHash 三级优先级链，
    //   并违反 multi-branch-day1-sop.md Step 4.0「源码 tombstone 不得覆盖 store 已落地哈希」；
    // 若回填 special_features → 把管理员有意撤回的 cost 权限自动还回去（提权）；
    // 若回填 active → 覆盖账号生命周期决策。
    userRows.linxia = makeRow('linxia', {
      branch_code: null,
      password_hash: '$2b$10$RuntimeSelfSetHash0000000000000000000000000000000000000',
      special_features: null, // 模拟管理面已撤回 cost（preset 仍声明 ['cost']）
      active: false,
    });

    await seedAccessControlData();

    const updates = updatesFor('linxia');
    expect(updates).toHaveLength(1); // 仅 branch_code 那一条
    const sql = updates[0];
    expect(sql).toMatch(/branch_code = 'SC'/);
    for (const forbidden of [
      'password_hash',
      'password_changed_at',
      'special_features',
      'allowed_routes',
      'default_route',
      'active',
      'organization',
      'display_name',
      'role',
    ]) {
      expect(sql, `回填 SQL 不得写 ${forbidden}`).not.toContain(forbidden);
    }
    // 也不得改写该账号的 PasswordCredential
    // （限定 uid-linxia：同一次 seed 里其它 preset 账号走的是「不存在则建行」路径，
    //  那条路径本就会为**新建**账号插入 credential，与存量行对账无关。）
    expect(
      executedSql.some(
        (s) => /PasswordCredential/.test(s) && s.includes('uid-linxia')
      ),
      '对账不得触碰存量账号的 PasswordCredential'
    ).toBe(false);
  });

  it('store 缺账号 → 仍走既有 ensureUserFromPreset 建行（保持原行为）', async () => {
    // userRows 为空 → 所有 preset 账号都不存在
    await seedAccessControlData();

    const inserts = executedSql.filter((s) => s.trim().startsWith('INSERT INTO UserAccount'));
    expect(inserts.length).toBe(Object.keys(PRESET_USERS).length);
    // 不存在的账号走 INSERT，不应有 UPDATE
    expect(executedSql.filter((s) => s.trim().startsWith('UPDATE UserAccount'))).toHaveLength(0);
  });

  it('所有带 branchCode 的 preset 账号，存量行缺失时都能被回填（不是只修 tianfu 个例）', async () => {
    const withBranch = Object.values(PRESET_USERS).filter((u) => u.branchCode);
    expect(withBranch.length).toBeGreaterThan(0);
    for (const u of withBranch) {
      userRows[u.username] = makeRow(u.username, { branch_code: null });
    }

    await seedAccessControlData();

    for (const u of withBranch) {
      const updates = updatesFor(u.username);
      expect(updates, `${u.username} 应被回填`).toHaveLength(1);
      expect(updates[0]).toMatch(new RegExp(`branch_code = '${u.branchCode}'`));
    }
  });
});
