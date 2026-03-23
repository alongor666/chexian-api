import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { duckdbService } from './duckdb.js';
import { escapeSqlValue } from '../utils/security.js';
import { PRESET_ROLES, PRESET_USERS, PresetRole, PresetUser } from '../config/preset-users.js';
import { getUserStorePath } from '../config/paths.js';
import { AppError } from '../middleware/error.js';

export interface AccessUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  organization?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active: boolean;
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
  } catch {
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
    allowedRoutes: parseStringArray(row.allowed_routes),
    defaultRoute: row.default_route ? String(row.default_route) : undefined,
    allowedIps: parseStringArray(row.allowed_ips),
    specialFeatures: parseStringArray(row.special_features),
    active: Boolean(row.active),
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

async function persistToFile(): Promise<void> {
  try {
    const users = await listUsersInternal();
    const roles = await listRoles();
    const store: UserStoreData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      users,
      roles,
    };
    ensureDataDir();
    const storePath = getUserStorePath();
    const tmpPath = storePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpPath, storePath);
  } catch (err) {
    console.error('[AccessControl] 持久化到文件失败:', err);
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

async function loadFromStore(store: UserStoreData): Promise<void> {
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
      ${serializeStringArray(user.allowedRoutes)},
      ${toSqlString(user.defaultRoute)},
      ${serializeStringArray(user.allowedIps)},
      ${serializeStringArray(user.specialFeatures)},
      ${toSqlBoolean(user.active)},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )`).join(',\n');
    await duckdbService.query(`
      INSERT INTO UserAccount
        (id, username, display_name, password_hash, role, organization, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
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
        (id, username, display_name, password_hash, role, organization, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
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
      (id, username, display_name, password_hash, role, organization, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(user.username)}',
      '${escapeSqlValue(user.displayName)}',
      '${escapeSqlValue(user.passwordHash)}',
      '${escapeSqlValue(user.role)}',
      ${toSqlString(user.organization)},
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
      (id, username, display_name, password_hash, role, organization, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(input.username)}',
      '${escapeSqlValue(input.displayName)}',
      '${escapeSqlValue(input.passwordHash)}',
      '${escapeSqlValue(input.role)}',
      ${toSqlString(input.organization)},
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
  if (input.passwordHash) {
    updates.push(`password_hash = '${escapeSqlValue(input.passwordHash)}'`);
  }
  await duckdbService.query(`
    UPDATE UserAccount
    SET ${updates.join(', ')}
    WHERE id = '${escapeSqlValue(id)}'
  `);
  await persistToFile();
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

export async function deleteUser(id: string): Promise<void> {
  await duckdbService.query(`
    DELETE FROM UserAccount
    WHERE id = '${escapeSqlValue(id)}'
  `);
  await persistToFile();
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
