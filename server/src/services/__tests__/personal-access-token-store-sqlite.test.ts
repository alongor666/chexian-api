/**
 * personal-access-token-store SQLite Repository 单测（v5 Phase 3, B298）
 *
 * 覆盖：
 *  - Migration#3 应用后 api_tokens 表 + 两个索引存在；schema_migrations 含 id=3
 *  - upsertPatToSqlite → readAllPatsFromSqlite round-trip 全字段一致
 *  - upsertPatToSqlite 同 token_id 第二次 → ON CONFLICT UPDATE（不抛 UNIQUE）
 *  - revokePatInSqlite / unrevokePatInSqlite 改 revoked_at 字段
 *  - deletePatFromSqlite 删行
 *  - updateLastUsedBatchInSqlite 单事务批量更新
 *  - replaceAllPatsInSqlite 全量替换（DELETE + bulk INSERT）
 *  - hasPatDataInSqlite 准确反映行数
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

// Mock duckdbService — 捕获 SQL + 可注入失败实现，给 reload 原子事务 P1 回归用
const duckdbQueries: Array<{ sql: string }> = [];
let duckdbQueryImpl: (sql: string) => Promise<any[]> = async () => [];
vi.mock('../duckdb.js', () => ({
  duckdbService: {
    query: async (sql: string) => {
      duckdbQueries.push({ sql });
      return duckdbQueryImpl(sql);
    },
  },
}));

import * as stateDb from '../state-db.js';
import {
  upsertPatToSqlite,
  revokePatInSqlite,
  unrevokePatInSqlite,
  deletePatFromSqlite,
  updateLastUsedBatchInSqlite,
  replaceAllPatsInSqlite,
  readAllPatsFromSqlite,
  hasPatDataInSqlite,
  reloadApiTokenMirrorFromSqlite,
  _resetStateDbModuleForTest,
  type PatRecord,
} from '../personal-access-token-store.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pat-store-sqlite-'));
  dbPath = path.join(tmpDir, 'state.db');
  process.env.__TEST_STATE_DB_PATH = dbPath;
  stateDb.init();
  duckdbQueries.length = 0;
  duckdbQueryImpl = async () => [];
});

afterEach(() => {
  try {
    stateDb.close();
  } catch {
    // ignore
  }
  _resetStateDbModuleForTest();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.__TEST_STATE_DB_PATH;
});

const buildRecord = (overrides: Partial<PatRecord> = {}): PatRecord => ({
  token_id: 'AAAAAAAA',
  token_hash: '$2b$10$hash',
  user_id: 'u-1',
  username: 'alice',
  name: 'cli-token',
  expires_at: '2026-12-31T00:00:00.000Z',
  last_used_at: null,
  last_used_ip: null,
  created_at: '2026-05-12T00:00:00.000Z',
  revoked_at: null,
  ...overrides,
});

describe('personal-access-token-store-sqlite schema', () => {
  it('Migration#3 创建 api_tokens 表 + 两个索引', () => {
    const db = stateDb.getDb();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('api_tokens');
    expect(names).toContain('schema_migrations');

    const migrations = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: number }>;
    expect(migrations.map((m) => m.id)).toContain(3);

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_tokens'")
      .all() as Array<{ name: string }>;
    const idxNames = idx.map((i) => i.name);
    expect(idxNames).toContain('idx_api_tokens_user_id');
    expect(idxNames).toContain('idx_api_tokens_revoked');
  });
});

describe('upsertPatToSqlite / readAllPatsFromSqlite', () => {
  it('单条 upsert + readAll round-trip 全字段一致', async () => {
    const record = buildRecord({
      last_used_at: '2026-05-13T10:00:00.000Z',
      last_used_ip: '1.2.3.4',
    });
    await upsertPatToSqlite(record);
    const rows = await readAllPatsFromSqlite();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(record);
  });

  it('同 token_id 第二次 upsert → ON CONFLICT UPDATE，不抛 UNIQUE', async () => {
    await upsertPatToSqlite(buildRecord({ name: 'v1' }));
    await upsertPatToSqlite(buildRecord({ name: 'v2', last_used_ip: '5.6.7.8' }));
    const rows = await readAllPatsFromSqlite();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('v2');
    expect(rows[0].last_used_ip).toBe('5.6.7.8');
  });
});

describe('revoke / unrevoke / delete', () => {
  it('revokePatInSqlite 写入 revoked_at；unrevoke 清空回 NULL', async () => {
    await upsertPatToSqlite(buildRecord());
    await revokePatInSqlite('AAAAAAAA', '2026-05-14T12:00:00.000Z');
    let rows = await readAllPatsFromSqlite();
    expect(rows[0].revoked_at).toBe('2026-05-14T12:00:00.000Z');

    await unrevokePatInSqlite('AAAAAAAA');
    rows = await readAllPatsFromSqlite();
    expect(rows[0].revoked_at).toBeNull();
  });

  it('deletePatFromSqlite 删行', async () => {
    await upsertPatToSqlite(buildRecord({ token_id: 'TKN00001' }));
    await upsertPatToSqlite(buildRecord({ token_id: 'TKN00002', user_id: 'u-2' }));
    expect((await readAllPatsFromSqlite())).toHaveLength(2);
    await deletePatFromSqlite('TKN00001');
    const rows = await readAllPatsFromSqlite();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_id).toBe('TKN00002');
  });
});

describe('updateLastUsedBatchInSqlite', () => {
  it('单事务批量更新多个 token 的 last_used_at / last_used_ip', async () => {
    await upsertPatToSqlite(buildRecord({ token_id: 'TKN00001' }));
    await upsertPatToSqlite(buildRecord({ token_id: 'TKN00002', user_id: 'u-2' }));

    await updateLastUsedBatchInSqlite([
      { tokenId: 'TKN00001', lastUsedAt: '2026-05-14T10:00:00.000Z', lastUsedIp: '1.1.1.1' },
      { tokenId: 'TKN00002', lastUsedAt: '2026-05-14T10:05:00.000Z', lastUsedIp: '2.2.2.2' },
    ]);

    const rows = await readAllPatsFromSqlite();
    const t1 = rows.find((r) => r.token_id === 'TKN00001')!;
    const t2 = rows.find((r) => r.token_id === 'TKN00002')!;
    expect(t1.last_used_at).toBe('2026-05-14T10:00:00.000Z');
    expect(t1.last_used_ip).toBe('1.1.1.1');
    expect(t2.last_used_at).toBe('2026-05-14T10:05:00.000Z');
    expect(t2.last_used_ip).toBe('2.2.2.2');
  });

  it('空数组：不报错，无副作用', async () => {
    await expect(updateLastUsedBatchInSqlite([])).resolves.toBeUndefined();
  });
});

describe('replaceAllPatsInSqlite', () => {
  it('全量替换：旧数据被清空', async () => {
    await upsertPatToSqlite(buildRecord({ token_id: 'OLD00001' }));
    await upsertPatToSqlite(buildRecord({ token_id: 'OLD00002', user_id: 'u-2' }));
    expect(await hasPatDataInSqlite()).toBe(true);

    await replaceAllPatsInSqlite([buildRecord({ token_id: 'NEW00001', user_id: 'u-new' })]);
    const rows = await readAllPatsFromSqlite();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_id).toBe('NEW00001');
    expect(rows[0].user_id).toBe('u-new');
  });

  it('replaceAll 事务原子：UNIQUE 违反 → 整体回滚（保留原数据）', async () => {
    await upsertPatToSqlite(buildRecord({ token_id: 'EXIST001' }));
    const before = await readAllPatsFromSqlite();

    // 构造非法 snapshot：两条同 token_id 触发 PRIMARY KEY 失败
    const broken: PatRecord[] = [
      buildRecord({ token_id: 'DUP00001' }),
      buildRecord({ token_id: 'DUP00001' }),  // 同 PK
    ];

    await expect(replaceAllPatsInSqlite(broken)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);

    const after = await readAllPatsFromSqlite();
    // 回滚后原数据保留（事务全失败 = DELETE 也回滚）
    expect(after).toEqual(before);
  });
});

describe('hasPatDataInSqlite', () => {
  it('准确反映 api_tokens 表行数', async () => {
    expect(await hasPatDataInSqlite()).toBe(false);
    await upsertPatToSqlite(buildRecord());
    expect(await hasPatDataInSqlite()).toBe(true);
    await deletePatFromSqlite('AAAAAAAA');
    expect(await hasPatDataInSqlite()).toBe(false);
  });
});

// codex P1 (PR #389) 回归：reload 不可先 DELETE 后 INSERT，
// 否则 readAll 或 INSERT 失败会把 DuckDB 镜像永久清空，verifyPat 全失败。
describe('reloadApiTokenMirrorFromSqlite 原子事务（codex P1 PR#389）', () => {
  it('非空表：单次 query 包含 BEGIN/DELETE/INSERT/COMMIT 而非两次 query', async () => {
    await upsertPatToSqlite(buildRecord());
    duckdbQueries.length = 0;
    await reloadApiTokenMirrorFromSqlite();
    // 整个 reload 只发一次 query（原子事务，不是 DELETE+INSERT 两次）
    expect(duckdbQueries).toHaveLength(1);
    const sql = duckdbQueries[0].sql;
    expect(sql).toContain('BEGIN TRANSACTION');
    expect(sql).toContain('DELETE FROM ApiToken');
    expect(sql).toContain('INSERT INTO ApiToken');
    expect(sql).toContain('COMMIT');
    // 严格顺序：BEGIN < DELETE < INSERT < COMMIT
    expect(sql.indexOf('BEGIN TRANSACTION')).toBeLessThan(sql.indexOf('DELETE FROM ApiToken'));
    expect(sql.indexOf('DELETE FROM ApiToken')).toBeLessThan(sql.indexOf('INSERT INTO ApiToken'));
    expect(sql.indexOf('INSERT INTO ApiToken')).toBeLessThan(sql.indexOf('COMMIT'));
  });

  it('空表：单 DELETE 即可，不需要事务包裹', async () => {
    // SQLite 没数据
    duckdbQueries.length = 0;
    await reloadApiTokenMirrorFromSqlite();
    expect(duckdbQueries).toHaveLength(1);
    expect(duckdbQueries[0].sql).toContain('DELETE FROM ApiToken');
    expect(duckdbQueries[0].sql).not.toContain('INSERT INTO ApiToken');
  });

  it('DuckDB 事务 INSERT 失败 → 错误传播但只调用一次 query（DELETE 与 INSERT 同一事务，由 DuckDB 自动回滚）', async () => {
    await upsertPatToSqlite(buildRecord());
    duckdbQueryImpl = async () => { throw new Error('DuckDB constraint violation'); };
    duckdbQueries.length = 0;
    await expect(reloadApiTokenMirrorFromSqlite()).rejects.toThrow(/DuckDB constraint/);
    // 只发了一次 query；之前的 DELETE-then-INSERT 实现会调两次（第二次失败前第一次已清空镜像）
    expect(duckdbQueries).toHaveLength(1);
    expect(duckdbQueries[0].sql).toContain('BEGIN TRANSACTION');
  });

});
