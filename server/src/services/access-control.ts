import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { duckdbService } from './duckdb.js';
import { escapeSqlValue } from '../utils/security.js';
import { PRESET_ROLES, PRESET_USERS, PresetRole, PresetUser } from '../config/preset-users.js';
import { getUserStorePath } from '../config/paths.js';
import { dbEnv } from '../config/env.js';
import { AppError } from '../middleware/error.js';
import { createLogger } from '../utils/logger.js';
import { setActiveUsernames } from './user-activation-cache.js';

const log = createLogger('access-control');

// access-control-store / state-db 是 backend=sqlite 模式下的双写目标。
// dynamic import 防止默认 backend=json 模式下意外加载 better-sqlite3（codex P1 同款修复）。
type AccessControlStoreModule = typeof import('./access-control-store.js');
let accessControlStore: AccessControlStoreModule | null = null;

async function ensureAccessControlStore(): Promise<AccessControlStoreModule> {
  if (accessControlStore) return accessControlStore;
  accessControlStore = await import('./access-control-store.js');
  return accessControlStore;
}

export interface AccessUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  organization?: string;
  /** 分公司编码（'SC' / 'SX'）。undefined → 系统级超管看全国。详见 PresetUser.branchCode */
  branchCode?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active: boolean;
  /**
   * 用户/管理员在运行时自设密码的时间（ISO 字符串）。非空 → password_hash 是运行时写入的
   * 真实密码，登录时优先于 USER_PASSWORDS 环境变量初始密码；空 → 密码仍走 env 覆盖 ?? 占位。
   * 配合 PresetUser.mustChangePassword 实现「统一初始密码首登强制改密」。
   */
  passwordChangedAt?: string;
}

export interface AccessRole {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes?: string[];
  defaultRoute?: string;
}

interface UserStoreData {
  version: number;
  exportedAt: string;
  users: AccessUser[];
  roles: AccessRole[];
}

function toSqlString(value?: string | null): string {
  if (value === undefined || value === null || value === '') return 'NULL';
  return `'${escapeSqlValue(value)}'`;
}

function toSqlBoolean(value: boolean | undefined): string {
  return value ? 'true' : 'false';
}

function serializeStringArray(value?: string[] | null): string {
  if (!value || value.length === 0) return 'NULL';
  return `'${escapeSqlValue(JSON.stringify(value))}'`;
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item)).filter(Boolean);
    }
  } catch (err) {
    console.warn('[AccessControl] parseStringArray: 非法 JSON，按 undefined 处理:', err);
  }
  return undefined;
}

function mapUserRow(row: any): AccessUser {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name ?? row.displayName ?? row.username),
    passwordHash: String(row.password_hash ?? row.passwordHash ?? ''),
    role: String(row.role),
    organization: row.organization ? String(row.organization) : undefined,
    branchCode: row.branch_code ? String(row.branch_code) : undefined,
    allowedRoutes: parseStringArray(row.allowed_routes),
    defaultRoute: row.default_route ? String(row.default_route) : undefined,
    allowedIps: parseStringArray(row.allowed_ips),
    specialFeatures: parseStringArray(row.special_features),
    active: Boolean(row.active),
    passwordChangedAt: row.password_changed_at ? String(row.password_changed_at) : undefined,
  };
}

function mapRoleRow(row: any): AccessRole {
  return {
    role: String(row.role),
    name: String(row.name ?? row.role),
    dataScope: (row.data_scope === 'all' || row.data_scope === 'org' || row.data_scope === 'telemarketing')
      ? row.data_scope
      : 'org',
    allowedRoutes: parseStringArray(row.allowed_routes),
    defaultRoute: row.default_route ? String(row.default_route) : undefined,
  };
}

// ============================================
// JSON 文件持久化
// ============================================

function ensureDataDir(): void {
  const storePath = getUserStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 持久化 users + roles snapshot 到磁盘（v5 状态持久层 Phase 2 改造，B297）。
 *
 * 关键变更（vs 旧版吞错路径）：
 * - 任何写失败立即 throw AppError → asyncHandler 接住 → errorHandler 映射 HTTP 5xx。
 *   旧版 console.error 短路会导致 DuckDB :memory: 已更新 / 磁盘陈旧 → reload 后用户改动丢失。
 * - backend=sqlite 模式启用双写：SQLite first（新主权威）→ JSON（fallback / 可读 backup）。
 *   SQLite 成功 + JSON 失败 → `[INCONSISTENCY]` 日志 + throw（需运营介入修 JSON backup）。
 * - backend=json 模式：行为完全等于旧版（除 throw 替代吞错）。VPS 默认 json，零生效。
 */
async function persistToFile(): Promise<void> {
  const users = await listUsersInternal();
  const roles = await listRoles();
  const snapshot: UserStoreData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    users,
    roles,
  };

  // SQLite first（仅 backend=sqlite 模式）—— v5 plan 用户决策 lock 2026-05-16
  if (dbEnv.STATE_STORE_BACKEND === 'sqlite') {
    try {
      const store = await ensureAccessControlStore();
      store.replaceAll({ users, roles });
    } catch (err) {
      throw new AppError(
        500,
        `[AccessControl] state.db 写入失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // JSON fallback（无论 backend 都写，保证 reload 启动加载路径可读）
  ensureDataDir();
  const storePath = getUserStorePath();
  const tmpPath = storePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    fs.renameSync(tmpPath, storePath);
  } catch (err) {
    const inconsistency = dbEnv.STATE_STORE_BACKEND === 'sqlite'
      ? ' [INCONSISTENCY] SQLite 已写入但 JSON backup 失败，需运营介入修复 JSON。'
      : '';
    throw new AppError(
      500,
      `[AccessControl] user_store.json 写入失败:${inconsistency} ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function loadStoreFromFile(): UserStoreData | null {
  const storePath = getUserStorePath();
  if (!fs.existsSync(storePath)) return null;
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const store = JSON.parse(raw) as UserStoreData;
    if (!store.users || !Array.isArray(store.users)) return null;
    if (!store.roles || !Array.isArray(store.roles)) {
      store.roles = [];
    }
    return store;
  } catch (err) {
    console.warn('[AccessControl] user_store.json 解析失败，将从预置用户重新初始化:', err);
    return null;
  }
}

/**
 * store 与源码 PRESET_ROLES 的角色路由白名单对账（只警告不自动改）。
 * 背景（BACKLOG 45faef）：loadFromStore 时角色配置以 store 为准（管理面
 * updateRole 可改，store 是运维权威），但源码 preset 演进（如 ORG_ROLE_
 * ALLOWED_ROUTES 新增 /home）不会自动落到已 seed 的生产 store —— 两套
 * 事实静默漂移。此处启动时逐角色 diff 并打 warn，对齐由运维执行
 * scripts/ops/align-role-routes.mjs（默认 dry-run，确认 diff 后 --apply）。
 */
function warnRoleRouteDrift(storeRoles: UserStoreData['roles']): void {
  for (const preset of PRESET_ROLES) {
    if (!preset.allowedRoutes) continue;
    const stored = (storeRoles || []).find((r) => r.role === preset.role);
    if (!stored) continue;
    const storedRoutes = stored.allowedRoutes || [];
    const missing = preset.allowedRoutes.filter((r) => !storedRoutes.includes(r));
    const extra = storedRoutes.filter((r) => !preset.allowedRoutes!.includes(r));
    if (missing.length > 0 || extra.length > 0) {
      console.warn(
        `[AccessControl] 角色 ${preset.role} 的 allowedRoutes 与源码 preset 漂移 —— ` +
          `store 缺少: ${JSON.stringify(missing)}，store 多出: ${JSON.stringify(extra)}。` +
          `若非管理面有意修改，请运维执行 node scripts/ops/align-role-routes.mjs 查看 diff 后对齐`
      );
    }
  }
}

async function loadFromStore(store: UserStoreData): Promise<void> {
  warnRoleRouteDrift(store.roles);
  // 清空内存表再插入
  await duckdbService.query('DELETE FROM UserAccount');
  await duckdbService.query('DELETE FROM RoleConfig');

  // 插入角色
  if (store.roles && store.roles.length > 0) {
    const roleValues = store.roles.map((role) => `(
      '${escapeSqlValue(role.role)}',
      '${escapeSqlValue(role.name)}',
      '${escapeSqlValue(role.dataScope)}',
      ${serializeStringArray(role.allowedRoutes)},
      ${toSqlString(role.defaultRoute)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )`).join(',\n');
    await duckdbService.query(`
      INSERT INTO RoleConfig
        (role, name, data_scope, allowed_routes, default_route, created_at, updated_at)
      VALUES
      ${roleValues}
    `);
  }

  // 插入用户
  if (store.users && store.users.length > 0) {
    const userValues = store.users.map((user) => `(
      '${escapeSqlValue(user.id || crypto.randomUUID())}',
      '${escapeSqlValue(user.username)}',
      '${escapeSqlValue(user.displayName)}',
      '${escapeSqlValue(user.passwordHash)}',
      '${escapeSqlValue(user.role)}',
      ${toSqlString(user.organization)},
      ${toSqlString(user.branchCode)},
      ${serializeStringArray(user.allowedRoutes)},
      ${toSqlString(user.defaultRoute)},
      ${serializeStringArray(user.allowedIps)},
      ${serializeStringArray(user.specialFeatures)},
      ${toSqlBoolean(user.active)},
      ${toSqlString(user.passwordChangedAt)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )`).join(',\n');
    await duckdbService.query(`
      INSERT INTO UserAccount
        (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, password_changed_at, created_at, updated_at)
      VALUES
      ${userValues}
    `);
  }
  console.log(`[AccessControl] 从 user_store.json 加载了 ${store.users.length} 个用户和 ${store.roles.length} 个角色`);
}

async function seedFromPreset(): Promise<void> {
  // 清空已有数据（文件数据库可能已有旧数据）
  await duckdbService.query('DELETE FROM UserAccount');
  await duckdbService.query('DELETE FROM RoleConfig');

  // 插入预置角色
  const roleValues = PRESET_ROLES.map((role) => `(
    '${escapeSqlValue(role.role)}',
    '${escapeSqlValue(role.name)}',
    '${escapeSqlValue(role.dataScope)}',
    ${serializeStringArray(role.allowedRoutes)},
    ${toSqlString(role.defaultRoute)},
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )`).join(',\n');
  if (roleValues.length > 0) {
    await duckdbService.query(`
      INSERT INTO RoleConfig
        (role, name, data_scope, allowed_routes, default_route, created_at, updated_at)
      VALUES
      ${roleValues}
    `);
  }

  // 插入预置用户
  const users = Object.values(PRESET_USERS);
  const userValues = users.map((user) => `(
    '${escapeSqlValue(crypto.randomUUID())}',
    '${escapeSqlValue(user.username)}',
    '${escapeSqlValue(user.displayName)}',
    '${escapeSqlValue(user.passwordHash)}',
    '${escapeSqlValue(user.role)}',
    ${toSqlString(user.organization)},
    ${toSqlString(user.branchCode)},
    ${serializeStringArray(user.allowedRoutes)},
    ${toSqlString(user.defaultRoute)},
    ${serializeStringArray(user.allowedIps)},
    ${serializeStringArray(user.specialFeatures)},
    ${toSqlBoolean(user.active ?? true)},
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )`).join(',\n');
  if (userValues.length > 0) {
    await duckdbService.query(`
      INSERT INTO UserAccount
        (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
      VALUES
      ${userValues}
    `);
  }
  console.log(`[AccessControl] 从预置配置初始化了 ${users.length} 个用户和 ${PRESET_ROLES.length} 个角色`);

  // 立即持久化到文件
  await persistToFile();
}

async function ensureUserFromPreset(user: PresetUser): Promise<AccessUser> {
  const existing = await getUserByUsername(user.username);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await duckdbService.query(`
    INSERT INTO UserAccount
      (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(user.username)}',
      '${escapeSqlValue(user.displayName)}',
      '${escapeSqlValue(user.passwordHash)}',
      '${escapeSqlValue(user.role)}',
      ${toSqlString(user.organization)},
      ${toSqlString(user.branchCode)},
      ${serializeStringArray(user.allowedRoutes)},
      ${toSqlString(user.defaultRoute)},
      ${serializeStringArray(user.allowedIps)},
      ${serializeStringArray(user.specialFeatures)},
      ${toSqlBoolean(user.active ?? true)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `);
  await persistToFile();
  await refreshActiveUsernamesCache();
  const created = await getUserByUsername(user.username);
  if (!created) {
    throw new AppError(500, '创建预置用户失败');
  }
  return created;
}

export async function seedAccessControlData(): Promise<void> {
  const store = loadStoreFromFile();
  if (store) {
    await loadFromStore(store);
  } else {
    await seedFromPreset();
  }
  await refreshActiveUsernamesCache();
}

// JWT 实时吊销支持：把「active 且存在」的用户名集合刷进纯缓存模块 user-activation-cache，
// 供 authMiddleware O(1) 查询（详见该模块头注释：为何与 duckdb 解耦）。
// 每次用户写操作（create/update/delete/ensurePreset）+ 启动 seed 后调用。
async function refreshActiveUsernamesCache(): Promise<void> {
  try {
    const users = await listUsersInternal();
    setActiveUsernames(users.filter((u) => u.active).map((u) => u.username));
  } catch (err) {
    // fail-safe：刷新失败保留旧缓存（吊销延迟到下次成功刷新），绝不因此让写操作 500。
    log.error('刷新 active 用户名缓存失败，保留旧缓存', err);
  }
}

// ============================================
// 查询
// ============================================

export async function getUserByUsername(username: string): Promise<AccessUser | null> {
  const rows = await duckdbService.query(`
    SELECT *
    FROM UserAccount
    WHERE username = '${escapeSqlValue(username)}'
    LIMIT 1
  `);
  if (!rows || rows.length === 0) return null;
  return mapUserRow(rows[0]);
}

/**
 * 按主键 id（UUID）取用户。用户管理面按省隔离需先据 id 载入目标账号、核对其 branchCode
 * 是否在调用者可管理范围内（PUT/DELETE /users/:id 的 :id 即此 UUID，非 username）。
 */
export async function getUserById(id: string): Promise<AccessUser | null> {
  const rows = await duckdbService.query(`
    SELECT *
    FROM UserAccount
    WHERE id = '${escapeSqlValue(id)}'
    LIMIT 1
  `);
  if (!rows || rows.length === 0) return null;
  return mapUserRow(rows[0]);
}

/** 内部查询，含 passwordHash，仅供持久化使用 */
async function listUsersInternal(): Promise<AccessUser[]> {
  const rows = await duckdbService.query('SELECT * FROM UserAccount ORDER BY username ASC');
  return rows.map(mapUserRow);
}

export async function listUsers(): Promise<AccessUser[]> {
  return listUsersInternal();
}

// ============================================
// 用户 CRUD（写操作均追加持久化）
// ============================================

export async function createUser(input: {
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  organization?: string;
  branchCode?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active?: boolean;
}): Promise<AccessUser> {
  const exists = await getUserByUsername(input.username);
  if (exists) {
    throw new AppError(409, '用户名已存在');
  }
  const id = crypto.randomUUID();
  await duckdbService.query(`
    INSERT INTO UserAccount
      (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(input.username)}',
      '${escapeSqlValue(input.displayName)}',
      '${escapeSqlValue(input.passwordHash)}',
      '${escapeSqlValue(input.role)}',
      ${toSqlString(input.organization)},
      ${toSqlString(input.branchCode)},
      ${serializeStringArray(input.allowedRoutes)},
      ${toSqlString(input.defaultRoute)},
      ${serializeStringArray(input.allowedIps)},
      ${serializeStringArray(input.specialFeatures)},
      ${toSqlBoolean(input.active ?? true)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `);
  await persistToFile();
  await refreshActiveUsernamesCache();
  const created = await getUserByUsername(input.username);
  if (!created) {
    throw new AppError(500, '创建用户失败');
  }
  return created;
}

export async function updateUser(id: string, input: {
  displayName: string;
  passwordHash?: string;
  role: string;
  organization?: string;
  branchCode?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active?: boolean;
}): Promise<AccessUser> {
  const updates = [
    `display_name = '${escapeSqlValue(input.displayName)}'`,
    `role = '${escapeSqlValue(input.role)}'`,
    `organization = ${toSqlString(input.organization)}`,
    `allowed_routes = ${serializeStringArray(input.allowedRoutes)}`,
    `default_route = ${toSqlString(input.defaultRoute)}`,
    `allowed_ips = ${serializeStringArray(input.allowedIps)}`,
    `special_features = ${serializeStringArray(input.specialFeatures)}`,
    `active = ${toSqlBoolean(input.active ?? true)}`,
    'updated_at = CURRENT_TIMESTAMP',
  ];
  // branch_code 仅在显式传入时更新；未传则保留原值。否则多分公司 RLS 下，
  // 任何不带 branchCode 的用户编辑都会把 branch_code 抹成 NULL，
  // 该用户重登拿到的 JWT 无 branchCode → permission.ts fail-closed 401 锁死。
  if (input.branchCode !== undefined) {
    updates.push(`branch_code = ${toSqlString(input.branchCode)}`);
  }
  if (input.passwordHash) {
    updates.push(`password_hash = '${escapeSqlValue(input.passwordHash)}'`);
    // 管理面重置密码同样视为「运行时自设」：置 password_changed_at，令新哈希优先于
    // USER_PASSWORDS 环境变量初始密码生效（否则 env 覆盖恒胜，重置无效）。
    updates.push(`password_changed_at = '${escapeSqlValue(new Date().toISOString())}'`);
  }
  await duckdbService.query(`
    UPDATE UserAccount
    SET ${updates.join(', ')}
    WHERE id = '${escapeSqlValue(id)}'
  `);
  await persistToFile();
  await refreshActiveUsernamesCache();
  const rows = await duckdbService.query(`
    SELECT * FROM UserAccount
    WHERE id = '${escapeSqlValue(id)}'
    LIMIT 1
  `);
  if (!rows || rows.length === 0) {
    throw new AppError(404, '用户不存在');
  }
  return mapUserRow(rows[0]);
}

/**
 * 用户本人改密（统一初始密码首登强制改密链路）。
 * 写入新哈希并置 password_changed_at —— 此后登录以 store 哈希为准，
 * USER_PASSWORDS 环境变量里的统一初始密码对该账号自动失效。
 */
export async function setUserPasswordByUsername(
  username: string,
  passwordHash: string
): Promise<AccessUser> {
  const user = await getUserByUsername(username);
  if (!user) {
    throw new AppError(404, '用户不存在');
  }
  await duckdbService.query(`
    UPDATE UserAccount
    SET
      password_hash = '${escapeSqlValue(passwordHash)}',
      password_changed_at = '${escapeSqlValue(new Date().toISOString())}',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = '${escapeSqlValue(user.id)}'
  `);
  await persistToFile();
  const updated = await getUserByUsername(username);
  if (!updated) {
    throw new AppError(500, '密码更新失败');
  }
  return updated;
}

export async function deleteUser(id: string): Promise<void> {
  await duckdbService.query(`
    DELETE FROM UserAccount
    WHERE id = '${escapeSqlValue(id)}'
  `);
  await persistToFile();
  await refreshActiveUsernamesCache();
}

// ============================================
// 角色 CRUD（写操作均追加持久化）
// ============================================

export async function listRoles(): Promise<AccessRole[]> {
  const rows = await duckdbService.query('SELECT * FROM RoleConfig ORDER BY role ASC');
  return rows.map(mapRoleRow);
}

export async function createRole(role: PresetRole): Promise<AccessRole> {
  const exists = await duckdbService.query(`
    SELECT 1
    FROM RoleConfig
    WHERE role = '${escapeSqlValue(role.role)}'
    LIMIT 1
  `);
  if (exists.length > 0) {
    throw new AppError(409, '角色已存在');
  }
  await duckdbService.query(`
    INSERT INTO RoleConfig
      (role, name, data_scope, allowed_routes, default_route, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(role.role)}',
      '${escapeSqlValue(role.name)}',
      '${escapeSqlValue(role.dataScope)}',
      ${serializeStringArray(role.allowedRoutes)},
      ${toSqlString(role.defaultRoute)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `);
  await persistToFile();
  const rows = await duckdbService.query(`
    SELECT *
    FROM RoleConfig
    WHERE role = '${escapeSqlValue(role.role)}'
    LIMIT 1
  `);
  return mapRoleRow(rows[0]);
}

export async function updateRole(role: PresetRole): Promise<AccessRole> {
  await duckdbService.query(`
    UPDATE RoleConfig
    SET
      name = '${escapeSqlValue(role.name)}',
      data_scope = '${escapeSqlValue(role.dataScope)}',
      allowed_routes = ${serializeStringArray(role.allowedRoutes)},
      default_route = ${toSqlString(role.defaultRoute)},
      updated_at = CURRENT_TIMESTAMP
    WHERE role = '${escapeSqlValue(role.role)}'
  `);
  await persistToFile();
  const rows = await duckdbService.query(`
    SELECT *
    FROM RoleConfig
    WHERE role = '${escapeSqlValue(role.role)}'
    LIMIT 1
  `);
  if (!rows || rows.length === 0) {
    throw new AppError(404, '角色不存在');
  }
  return mapRoleRow(rows[0]);
}

export async function deleteRole(role: string): Promise<void> {
  await duckdbService.query(`
    DELETE FROM RoleConfig
    WHERE role = '${escapeSqlValue(role)}'
  `);
  await persistToFile();
}

export async function ensurePresetUser(username: string): Promise<AccessUser | null> {
  const preset = PRESET_USERS[username];
  if (!preset) return null;
  return ensureUserFromPreset(preset);
}
