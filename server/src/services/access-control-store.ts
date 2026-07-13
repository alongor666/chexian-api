/**
 * Access Control Store - SQLite Repository for users / roles (Phase 2, B297)
 *
 * ⚠️ 访问契约（RED LINE，沿用 state-db.ts 头注释）：
 *   ONLY access-control.ts may import this module. CLI / MCP / routes 走 HTTP API。
 *
 * 设计：
 * - snapshot-pattern 双写：access-control.ts 在每次 CRUD 后 dump DuckDB :memory: → JSON。
 *   本 store 接同一份 snapshot，全量 DELETE + INSERT 单事务替换 access_users / access_roles。
 * - 优于 row-level CRUD 双写：一次性事务，天然一致，调用方零额外语义负担。
 * - 仅在 dbEnv.STATE_STORE_BACKEND === 'sqlite' 时被调用；backend=json 模式下完全不加载。
 */

import { getDb, withTransaction } from './state-db.js';
import type { AccessUser, AccessRole } from './access-control.js';
import type { AuthIdentityRecord, PasswordCredentialRecord } from './auth-model.js';

export interface AccessControlSnapshot {
  users: AccessUser[];
  roles: AccessRole[];
  identities: AuthIdentityRecord[];
  passwordCredentials: PasswordCredentialRecord[];
}

function serializeArray(value: string[] | null | undefined): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

function parseArray(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean);
    }
  } catch {
    // ignore parse errors, treat as undefined
  }
  return undefined;
}

/**
 * 全量替换 access_users + access_roles。
 * 单事务：失败回滚，DB 状态原子。
 *
 * @throws better-sqlite3 异常（IO / 约束 / 类型不匹配等）原样抛出，由调用方包装为 AppError
 */
export function replaceAll(snapshot: AccessControlSnapshot): void {
  withTransaction((db) => {
    db.exec('DELETE FROM auth_identities');
    db.exec('DELETE FROM password_credentials');
    db.exec('DELETE FROM access_users');
    db.exec('DELETE FROM access_roles');

    const insertUser = db.prepare(`
      INSERT INTO access_users
        (id, username, display_name, password_hash, role, organization, branch_code,
         allowed_routes, default_route, allowed_ips, special_features, active,
         password_changed_at, updated_at)
      VALUES
        (@id, @username, @displayName, @passwordHash, @role, @organization, @branchCode,
         @allowedRoutes, @defaultRoute, @allowedIps, @specialFeatures, @active,
         @passwordChangedAt, datetime('now'))
    `);
    for (const user of snapshot.users) {
      insertUser.run({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        role: user.role,
        organization: user.organization ?? null,
        branchCode: user.branchCode ?? null,
        allowedRoutes: serializeArray(user.allowedRoutes),
        defaultRoute: user.defaultRoute ?? null,
        allowedIps: serializeArray(user.allowedIps),
        specialFeatures: serializeArray(user.specialFeatures),
        active: user.active ? 1 : 0,
        passwordChangedAt: user.passwordChangedAt ?? null,
      });
    }

    const insertRole = db.prepare(`
      INSERT INTO access_roles
        (role, name, data_scope, allowed_routes, default_route, updated_at)
      VALUES
        (@role, @name, @dataScope, @allowedRoutes, @defaultRoute, datetime('now'))
    `);
    for (const role of snapshot.roles) {
      insertRole.run({
        role: role.role,
        name: role.name,
        dataScope: role.dataScope,
        allowedRoutes: serializeArray(role.allowedRoutes),
        defaultRoute: role.defaultRoute ?? null,
      });
    }

    const insertIdentity = db.prepare(`
      INSERT INTO auth_identities
        (id, user_id, provider, provider_subject, enabled, last_verified_at, created_at, updated_at)
      VALUES
        (@id, @userId, @provider, @providerSubject, @enabled, @lastVerifiedAt, @createdAt, @updatedAt)
    `);
    for (const identity of snapshot.identities) {
      insertIdentity.run({
        ...identity,
        enabled: identity.enabled ? 1 : 0,
        lastVerifiedAt: identity.lastVerifiedAt ?? null,
      });
    }

    const insertPasswordCredential = db.prepare(`
      INSERT INTO password_credentials
        (user_id, password_hash, state, changed_at, updated_at)
      VALUES
        (@userId, @passwordHash, @state, @changedAt, datetime('now'))
    `);
    for (const credential of snapshot.passwordCredentials) {
      insertPasswordCredential.run({
        ...credential,
        changedAt: credential.changedAt ?? null,
      });
    }
  });
}

/**
 * 读取全量 snapshot。Phase 2 暂未接入启动加载路径（v5 plan 期间 JSON 仍是启动权威源），
 * 留给后续切换 SQLite-as-source-of-truth 时使用。
 */
export function readAll(): AccessControlSnapshot {
  const db = getDb();
  const userRows = db
    .prepare('SELECT * FROM access_users ORDER BY username ASC')
    .all() as Array<Record<string, unknown>>;
  const roleRows = db
    .prepare('SELECT * FROM access_roles ORDER BY role ASC')
    .all() as Array<Record<string, unknown>>;
  const identityRows = db
    .prepare('SELECT * FROM auth_identities ORDER BY provider, provider_subject')
    .all() as Array<Record<string, unknown>>;
  const credentialRows = db
    .prepare('SELECT * FROM password_credentials ORDER BY user_id')
    .all() as Array<Record<string, unknown>>;

  const users: AccessUser[] = userRows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    role: String(row.role),
    organization: row.organization ? String(row.organization) : undefined,
    branchCode: row.branch_code ? String(row.branch_code) : undefined,
    allowedRoutes: parseArray(row.allowed_routes),
    defaultRoute: row.default_route ? String(row.default_route) : undefined,
    allowedIps: parseArray(row.allowed_ips),
    specialFeatures: parseArray(row.special_features),
    active: row.active === 1 || row.active === true,
    passwordChangedAt: row.password_changed_at ? String(row.password_changed_at) : undefined,
  }));

  const roles: AccessRole[] = roleRows.map((row) => ({
    role: String(row.role),
    name: String(row.name),
    dataScope:
      row.data_scope === 'all' || row.data_scope === 'telemarketing'
        ? (row.data_scope as 'all' | 'telemarketing')
        : 'org',
    allowedRoutes: parseArray(row.allowed_routes),
    defaultRoute: row.default_route ? String(row.default_route) : undefined,
  }));

  const identities: AuthIdentityRecord[] = identityRows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider) as AuthIdentityRecord['provider'],
    providerSubject: String(row.provider_subject),
    enabled: row.enabled === 1 || row.enabled === true,
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  const passwordCredentials: PasswordCredentialRecord[] = credentialRows.map((row) => ({
    userId: String(row.user_id),
    passwordHash: String(row.password_hash),
    state: String(row.state) as PasswordCredentialRecord['state'],
    changedAt: row.changed_at ? String(row.changed_at) : undefined,
  }));

  return { users, roles, identities, passwordCredentials };
}

/**
 * 是否已有迁移过的数据。admin-import-users-from-json 用此判断是否拒绝二次导入。
 */
export function hasData(): boolean {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM access_users').get() as { n: number };
  return row.n > 0;
}
