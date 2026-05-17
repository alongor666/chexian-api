/**
 * access-control-store 单元测试（B297 Phase 2）
 *
 * 覆盖：
 * - Migration#2 应用后 access_users / access_roles 表存在；schema_migrations 含 id=2
 * - replaceAll → readAll round-trip 全字段一致（含 organization / allowedRoutes / allowedIps / specialFeatures / active）
 * - replaceAll 事务原子：单条插入失败 → 整体回滚，原数据保留
 * - hasData() 准确反映 access_users 行数
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

let tmpDir = '';
let dbPath = '';

vi.mock('../../config/env.js', () => ({
  dbEnv: new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'STATE_STORE_BACKEND') return 'sqlite';
        if (key === 'STATE_DB_PATH') return process.env.__TEST_STATE_DB_PATH ?? '';
        return undefined;
      },
    },
  ),
}));

import * as stateDb from '../state-db.js';
import * as store from '../access-control-store.js';
import type { AccessUser, AccessRole } from '../access-control.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-control-store-'));
  dbPath = path.join(tmpDir, 'state.db');
  process.env.__TEST_STATE_DB_PATH = dbPath;
  stateDb.init();
});

afterEach(() => {
  try {
    stateDb.close();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.__TEST_STATE_DB_PATH;
});

describe('access-control-store schema', () => {
  it('Migration#2 创建 access_users + access_roles 表', () => {
    const db = stateDb.getDb();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('access_users');
    expect(names).toContain('access_roles');
    expect(names).toContain('schema_migrations');

    const migrations = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: number }>;
    expect(migrations.map((m) => m.id)).toEqual([1, 2]);

    // 索引存在
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='access_users'")
      .all() as Array<{ name: string }>;
    expect(idx.map((i) => i.name)).toContain('idx_access_users_role');
  });
});

describe('access-control-store replaceAll / readAll', () => {
  const buildSnapshot = (): { users: AccessUser[]; roles: AccessRole[] } => ({
    users: [
      {
        id: 'u-1',
        username: 'admin',
        displayName: '管理员',
        passwordHash: '$2b$10$hash-admin',
        role: 'admin',
        organization: '总公司',
        allowedRoutes: ['/api/query/kpi', '/api/admin/users'],
        defaultRoute: '/dashboard',
        allowedIps: ['10.0.0.1', '192.168.1.0/24'],
        specialFeatures: ['NCD', 'PAT'],
        active: true,
      },
      {
        id: 'u-2',
        username: 'viewer',
        displayName: '只读用户',
        passwordHash: '$2b$10$hash-viewer',
        role: 'viewer',
        organization: undefined,
        allowedRoutes: undefined,
        defaultRoute: undefined,
        allowedIps: undefined,
        specialFeatures: undefined,
        active: false,
      },
    ],
    roles: [
      {
        role: 'admin',
        name: '管理员角色',
        dataScope: 'all',
        allowedRoutes: ['/api/**'],
        defaultRoute: '/dashboard',
      },
      {
        role: 'viewer',
        name: '只读',
        dataScope: 'org',
        allowedRoutes: undefined,
        defaultRoute: undefined,
      },
    ],
  });

  it('replaceAll 写入后 readAll 全字段一致', () => {
    const snap = buildSnapshot();
    store.replaceAll(snap);
    const read = store.readAll();

    expect(read.users).toHaveLength(2);
    expect(read.roles).toHaveLength(2);

    const admin = read.users.find((u) => u.username === 'admin');
    expect(admin).toBeDefined();
    expect(admin?.organization).toBe('总公司');
    expect(admin?.allowedRoutes).toEqual(['/api/query/kpi', '/api/admin/users']);
    expect(admin?.allowedIps).toEqual(['10.0.0.1', '192.168.1.0/24']);
    expect(admin?.specialFeatures).toEqual(['NCD', 'PAT']);
    expect(admin?.active).toBe(true);

    const viewer = read.users.find((u) => u.username === 'viewer');
    expect(viewer?.organization).toBeUndefined();
    expect(viewer?.allowedRoutes).toBeUndefined();
    expect(viewer?.specialFeatures).toBeUndefined();
    expect(viewer?.active).toBe(false);

    const adminRole = read.roles.find((r) => r.role === 'admin');
    expect(adminRole?.dataScope).toBe('all');
    expect(adminRole?.allowedRoutes).toEqual(['/api/**']);

    const viewerRole = read.roles.find((r) => r.role === 'viewer');
    expect(viewerRole?.dataScope).toBe('org');
    expect(viewerRole?.allowedRoutes).toBeUndefined();
  });

  it('replaceAll 全量替换：旧数据被清空', () => {
    store.replaceAll(buildSnapshot());
    expect(store.hasData()).toBe(true);

    store.replaceAll({
      users: [
        {
          id: 'u-only',
          username: 'only',
          displayName: 'Only One',
          passwordHash: 'x',
          role: 'admin',
          active: true,
        },
      ],
      roles: [],
    });

    const read = store.readAll();
    expect(read.users).toHaveLength(1);
    expect(read.users[0].username).toBe('only');
    expect(read.roles).toHaveLength(0);
  });

  it('replaceAll 事务原子：单条违反 UNIQUE 约束 → 整体回滚', () => {
    store.replaceAll(buildSnapshot());
    const before = store.readAll();

    // 构造非法 snapshot：两个 user 同 username 触发 UNIQUE 失败
    const broken = {
      users: [
        { ...before.users[0], id: 'u-dup-1' },
        { ...before.users[0], id: 'u-dup-2' }, // 同 username='admin'
      ],
      roles: before.roles,
    };

    expect(() => store.replaceAll(broken)).toThrow(/UNIQUE constraint/);

    const after = store.readAll();
    // 回滚后原数据保留（事务全失败 = DELETE 也回滚）
    expect(after.users).toEqual(before.users);
    expect(after.roles).toEqual(before.roles);
  });

  it('hasData() 准确反映表行数', () => {
    expect(store.hasData()).toBe(false);
    store.replaceAll(buildSnapshot());
    expect(store.hasData()).toBe(true);
    store.replaceAll({ users: [], roles: [] });
    expect(store.hasData()).toBe(false);
  });
});
