/**
 * state-db 单元测试（B296 Phase 1）
 *
 * 覆盖：
 * - 默认 backend='json' 时 init() 抛错
 * - sqlite 模式 init 后 PRAGMA + schema_migrations 表存在
 * - 重复 init() 幂等
 * - withTransaction 提交/回滚
 * - backup() 用 SQLite 原生 API
 *
 * 测试隔离：每个 test 使用 mkdtemp 临时目录，afterEach close + 删除。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// dbEnv 是 module-load-time 评估的 readonly 常量，无法直接覆盖；
// 用 vi.mock 替换 ../config/env.js 的 dbEnv 字段
let tmpDir = '';
let dbPath = '';

vi.mock('../../config/env.js', () => ({
  dbEnv: new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'STATE_STORE_BACKEND') return process.env.__TEST_STATE_BACKEND ?? 'sqlite';
        if (key === 'STATE_DB_PATH') return process.env.__TEST_STATE_DB_PATH ?? '';
        return undefined;
      },
    },
  ),
}));

// paths.ts 仍走真实模块（依赖 dbEnv 但只在 STATE_DB_PATH 解析时用到，由 process.env.__TEST_STATE_DB_PATH 控制）
import * as stateDb from '../state-db.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-db-test-'));
  dbPath = path.join(tmpDir, 'state.db');
  process.env.__TEST_STATE_DB_PATH = dbPath;
  process.env.__TEST_STATE_BACKEND = 'sqlite';
});

afterEach(() => {
  try {
    stateDb.close();
  } catch {
    // 已 close 的二次调用允许
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  delete process.env.__TEST_STATE_DB_PATH;
  delete process.env.__TEST_STATE_BACKEND;
});

describe('state-db', () => {
  it('backend != sqlite 时 init() 抛错', () => {
    process.env.__TEST_STATE_BACKEND = 'json';
    expect(() => stateDb.init()).toThrow(/STATE_STORE_BACKEND=sqlite/);
    expect(stateDb.isInitialized()).toBe(false);
  });

  it('init() 创建文件并应用 PRAGMA + migrations', () => {
    stateDb.init();
    expect(stateDb.isInitialized()).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = stateDb.getDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);

    // schema_migrations 表存在且 bootstrap migration 已记录
    const rows = db.prepare('SELECT id, description FROM schema_migrations ORDER BY id').all() as {
      id: number;
      description: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].description).toMatch(/schema_migrations/);
  });

  it('重复 init() 幂等（不抛错，不重复 migration）', () => {
    stateDb.init();
    const beforePath = stateDb.getCurrentDbPath();
    stateDb.init(); // 二次调用
    const afterPath = stateDb.getCurrentDbPath();
    expect(beforePath).toBe(afterPath);

    const rows = stateDb.getDb().prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as {
      c: number;
    };
    expect(rows.c).toBe(1); // 不会因二次 init 重复插入
  });

  it('未 init 时 getDb() 抛错', () => {
    expect(() => stateDb.getDb()).toThrow(/before init/);
  });

  it('withTransaction 正常路径提交', () => {
    stateDb.init();
    stateDb.getDb().exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    stateDb.withTransaction((db) => {
      db.prepare('INSERT INTO t (v) VALUES (?)').run('committed');
    });
    const row = stateDb.getDb().prepare('SELECT v FROM t').get() as { v: string };
    expect(row.v).toBe('committed');
  });

  it('withTransaction 抛错时回滚', () => {
    stateDb.init();
    stateDb.getDb().exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    expect(() =>
      stateDb.withTransaction((db) => {
        db.prepare('INSERT INTO t (v) VALUES (?)').run('rolled-back');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const count = stateDb.getDb().prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('backup() 写入有效的 SQLite 文件', async () => {
    stateDb.init();
    stateDb.getDb().exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    stateDb.getDb().prepare('INSERT INTO t (v) VALUES (?)').run('hello');

    const backupPath = path.join(tmpDir, 'backup.db');
    await stateDb.backup(backupPath);
    expect(fs.existsSync(backupPath)).toBe(true);

    // 用独立 Database 打开备份并验证数据一致
    const { default: Database } = await import('better-sqlite3');
    const verifyDb = new Database(backupPath, { readonly: true });
    try {
      const row = verifyDb.prepare('SELECT v FROM t LIMIT 1').get() as { v: string };
      expect(row.v).toBe('hello');
    } finally {
      verifyDb.close();
    }
  });

  it('close() 后 getDb() 抛错', () => {
    stateDb.init();
    stateDb.close();
    expect(stateDb.isInitialized()).toBe(false);
    expect(() => stateDb.getDb()).toThrow(/before init/);
  });

  it('Bun runtime + sqlite 模式触发 friendly error（保护本地 bun dev 启动）', () => {
    // Phase 0 沙盒漏检：better-sqlite3 是 NAPI 原生模块，Bun 暂不支持。
    // 默认 backend='json' 让本地 dev 不受影响；只有显式 sqlite + Bun runtime 才抛错。
    type GlobalWithBun = typeof globalThis & { Bun?: unknown };
    const g = globalThis as GlobalWithBun;
    const hadBun = 'Bun' in g;
    const prev = g.Bun;
    g.Bun = { version: 'mock-bun' };
    try {
      expect(() => stateDb.init()).toThrow(/Bun runtime/);
      expect(stateDb.isInitialized()).toBe(false);
    } finally {
      if (hadBun) {
        g.Bun = prev;
      } else {
        delete g.Bun;
      }
    }
  });
});
