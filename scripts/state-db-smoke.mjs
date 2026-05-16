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
// better-sqlite3 是 server 子项目的 dependency（不是仓库根），
// 用 createRequire 显式从 server/node_modules 解析，无需依赖 cwd
// 这样无论从 root 还是 server 目录跑，import 路径都稳定
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, '..', 'server');
const requireFromServer = createRequire(join(serverDir, 'package.json'));
const Database = requireFromServer('better-sqlite3');

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
