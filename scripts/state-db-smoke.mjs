#!/usr/bin/env node
/**
 * state-db-smoke.mjs — Phase 0 better-sqlite3 沙盒预检（B295）
 *
 * 验证 better-sqlite3 在当前 Node 环境的完整工作链路：
 *   1. ESM import: import Database from 'better-sqlite3'
 *   2. 持久 DB 打开 + PRAGMA: journal_mode=WAL / foreign_keys=ON / busy_timeout
 *   3. CRUD: CREATE TABLE + prepared INSERT + SELECT
 *   4. backup API: db.backup(path)（Phase 5 部署前快照依赖此 API）
 *
 * 用途：
 *   - 本地临时 worktree：`bun add better-sqlite3 && node scripts/state-db-smoke.mjs`
 *   - VPS /tmp 沙盒：sandbox 安装后用 wrapper doctor 的 NODE_BIN 执行
 *   - Phase 1 CI 集成：CI build 后跑此 smoke 防 better-sqlite3 build/import 退化
 *
 * 退出码：0 = SMOKE OK；1 = 任一步骤失败（带具体错误信息）
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'state-db-smoke-'));
const dbPath = join(tmp, 'test.db');
const backupPath = join(tmp, 'test.bak');

try {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)');
  db.prepare('INSERT INTO t (x) VALUES (?)').run('hello');
  const row = db.prepare('SELECT x FROM t LIMIT 1').get();
  if (row?.x !== 'hello') throw new Error('SELECT mismatch: ' + JSON.stringify(row));
  await db.backup(backupPath);
  db.close();
  console.log('SMOKE OK');
} catch (err) {
  console.error('SMOKE FAIL:', err.message);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
