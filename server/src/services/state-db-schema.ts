/**
 * state.db Schema 定义与迁移注册表
 * State DB Schema & Migrations Registry
 *
 * Phase 1（B296）：仅基础设施。Phase 2/3 通过往 MIGRATIONS 末尾 append 扩展。
 *
 * 设计：
 * - 每条 migration = { id, description, sql }
 * - id 严格递增，幂等执行（schema_migrations 表记录已应用 id）
 * - sql 必须是幂等 DDL（CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS）
 * - 禁止 ALTER TABLE 之外的破坏性变更（防止误降级）
 */

import type Database from 'better-sqlite3';

export interface Migration {
  id: number;
  description: string;
  sql: string;
}

/**
 * 迁移注册表。append-only：新条目追加到末尾，禁止修改/删除已发布条目。
 * Phase 2 加 users/roles 表；Phase 3 加 api_tokens 表；扩展时此处追加。
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    description: 'Bootstrap schema_migrations tracking table',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

/**
 * SQLite PRAGMA 推荐配置（与 Phase 0 smoke 一致）。
 * - journal_mode=WAL：写并发友好，重启后保留
 * - foreign_keys=ON：默认 OFF，必须显式启用（FK 约束生效）
 * - busy_timeout=5000：避免短暂锁竞争立刻报 SQLITE_BUSY
 * - synchronous=NORMAL：WAL 模式下崩溃安全且性能优于 FULL
 */
export function applyRecommendedPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
}

/**
 * 应用所有待执行的 migration。幂等：已应用的 id 跳过。
 * 单事务包裹：任何 migration 抛错则整体回滚（schema_migrations 也不会记录）。
 */
export function applyMigrations(db: Database.Database): { applied: number[]; skipped: number[] } {
  const bootstrap = MIGRATIONS[0];
  if (!bootstrap || bootstrap.id !== 1) {
    throw new Error('[state-db-schema] MIGRATIONS[0] 必须是 schema_migrations bootstrap');
  }
  db.exec(bootstrap.sql);

  const stmtAppliedIds = db.prepare('SELECT id FROM schema_migrations ORDER BY id ASC');
  const appliedIds = new Set<number>(
    (stmtAppliedIds.all() as { id: number }[]).map((r) => r.id),
  );

  const insertStmt = db.prepare(
    'INSERT INTO schema_migrations (id, description) VALUES (?, ?)',
  );

  const result = { applied: [] as number[], skipped: [] as number[] };

  const runAll = db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (appliedIds.has(m.id)) {
        result.skipped.push(m.id);
        continue;
      }
      db.exec(m.sql);
      insertStmt.run(m.id, m.description);
      result.applied.push(m.id);
    }
  });
  runAll();

  return result;
}
