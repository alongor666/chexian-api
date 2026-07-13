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
  {
    id: 2,
    description: 'access_users + access_roles for Phase 2 (B297)',
    sql: `
      CREATE TABLE IF NOT EXISTS access_users (
        id               TEXT PRIMARY KEY,
        username         TEXT NOT NULL UNIQUE,
        display_name     TEXT NOT NULL,
        password_hash    TEXT NOT NULL,
        role             TEXT NOT NULL,
        organization     TEXT,
        allowed_routes   TEXT,
        default_route    TEXT,
        allowed_ips      TEXT,
        special_features TEXT,
        active           INTEGER NOT NULL DEFAULT 1,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_access_users_role ON access_users(role);
      CREATE TABLE IF NOT EXISTS access_roles (
        role           TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        data_scope     TEXT NOT NULL,
        allowed_routes TEXT,
        default_route  TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    id: 3,
    description: 'api_tokens for Phase 3 (B298)',
    sql: `
      CREATE TABLE IF NOT EXISTS api_tokens (
        token_id     TEXT PRIMARY KEY,
        token_hash   TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        username     TEXT NOT NULL,
        name         TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        last_used_at TEXT,
        last_used_ip TEXT,
        created_at   TEXT NOT NULL,
        revoked_at   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked ON api_tokens(revoked_at);
    `,
  },
  {
    id: 4,
    description: 'branch_code on access_users for multi-branch RLS (plan v2 0D)',
    sql: `
      ALTER TABLE access_users ADD COLUMN branch_code TEXT;
    `,
  },
  {
    id: 5,
    description: 'password_changed_at on access_users for first-login forced password change (2026-07-11)',
    sql: `
      ALTER TABLE access_users ADD COLUMN password_changed_at TEXT;
    `,
  },
  {
    id: 6,
    description: 'activation_tokens for admin-issued one-time password-set tokens (2026-07-11)',
    sql: `
      CREATE TABLE IF NOT EXISTS activation_tokens (
        token_id   TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        username   TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_activation_tokens_user ON activation_tokens(user_id);
    `,
  },
  {
    id: 7,
    description: 'kind column on activation_tokens: activation vs reset (password recovery, 2026-07-11 phase 2)',
    sql: `
      ALTER TABLE activation_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'activation';
    `,
  },
  {
    id: 8,
    description: 'auth identities for external login providers (2026-07-13)',
    sql: `
      CREATE TABLE IF NOT EXISTS auth_identities (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL,
        provider         TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        enabled          INTEGER NOT NULL DEFAULT 1,
        last_verified_at TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        UNIQUE(provider, provider_subject)
      );
      CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
    `,
  },
  {
    id: 9,
    description: 'password credentials separated from access users (2026-07-13)',
    sql: `
      CREATE TABLE IF NOT EXISTS password_credentials (
        user_id       TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        state         TEXT NOT NULL CHECK(state IN ('bootstrap_required', 'active')),
        changed_at    TEXT,
        updated_at    TEXT NOT NULL
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
