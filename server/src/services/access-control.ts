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
import type { AuthIdentityRecord, PasswordCredentialRecord } from './auth-model.js';

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
   * 真实密码，登录时优先于 USER_PASSWORDS 环境变量旧密码；空 → 密码仍走 env 覆盖 ?? 占位，
   * 且账号处于 pns（password-not-set）态：登录成功即被强制引导设密（admin 豁免）。
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
  identities?: AuthIdentityRecord[];
  passwordCredentials?: PasswordCredentialRecord[];
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
  const identities = await listAuthIdentitiesInternal();
  const passwordCredentials = await listPasswordCredentialsInternal();
  const snapshot: UserStoreData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    users,
    roles,
    identities,
    passwordCredentials,
  };

  // SQLite first（仅 backend=sqlite 模式）—— v5 plan 用户决策 lock 2026-05-16
  if (dbEnv.STATE_STORE_BACKEND === 'sqlite') {
    try {
      const store = await ensureAccessControlStore();
      store.replaceAll({ users, roles, identities, passwordCredentials });
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
  await duckdbService.query('DELETE FROM AuthIdentity');
  await duckdbService.query('DELETE FROM PasswordCredential');

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
  const identities = Array.isArray(store.identities) ? store.identities : [];
  if (identities.length > 0) {
    const values = identities.map((identity) => `(
      '${escapeSqlValue(identity.id)}',
      '${escapeSqlValue(identity.userId)}',
      '${escapeSqlValue(identity.provider)}',
      '${escapeSqlValue(identity.providerSubject)}',
      ${toSqlBoolean(identity.enabled)},
      ${toSqlString(identity.lastVerifiedAt)},
      '${escapeSqlValue(identity.createdAt)}',
      '${escapeSqlValue(identity.updatedAt)}'
    )`).join(',\n');
    await duckdbService.query(`
      INSERT INTO AuthIdentity
        (id, user_id, provider, provider_subject, enabled, last_verified_at, created_at, updated_at)
      VALUES ${values}
    `);
  }
  const passwordCredentials = Array.isArray(store.passwordCredentials)
    ? store.passwordCredentials
    : store.users.map((user) => ({
        userId: user.id,
        passwordHash: user.passwordHash,
        state: user.passwordChangedAt ? 'active' as const : 'bootstrap_required' as const,
        changedAt: user.passwordChangedAt,
      }));
  if (passwordCredentials.length > 0) {
    const values = passwordCredentials.map((credential) => `(
      '${escapeSqlValue(credential.userId)}',
      '${escapeSqlValue(credential.passwordHash)}',
      '${escapeSqlValue(credential.state)}',
      ${toSqlString(credential.changedAt)},
      '${escapeSqlValue(new Date().toISOString())}'
    )`).join(',\n');
    await duckdbService.query(`
      INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
      VALUES ${values}
    `);
  }
  console.log(`[AccessControl] 从 user_store.json 加载了 ${store.users.length} 个用户和 ${store.roles.length} 个角色`);
}

async function seedFromPreset(): Promise<void> {
  // 清空已有数据（文件数据库可能已有旧数据）
  await duckdbService.query('DELETE FROM UserAccount');
  await duckdbService.query('DELETE FROM RoleConfig');
  await duckdbService.query('DELETE FROM AuthIdentity');
  await duckdbService.query('DELETE FROM PasswordCredential');

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
  const users = Object.values(PRESET_USERS).map((user) => ({ user, id: crypto.randomUUID() }));
  const userValues = users.map(({ user, id }) => `(
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
  )`).join(',\n');
  if (userValues.length > 0) {
    await duckdbService.query(`
      INSERT INTO UserAccount
        (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
      VALUES
      ${userValues}
    `);
    const credentialValues = users.map(({ user, id }) => `(
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(user.passwordHash)}',
      'bootstrap_required',
      NULL,
      '${escapeSqlValue(new Date().toISOString())}'
    )`).join(',\n');
    await duckdbService.query(`
      INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
      VALUES ${credentialValues}
    `);
  }
  console.log(`[AccessControl] 从预置配置初始化了 ${users.length} 个用户和 ${PRESET_ROLES.length} 个角色`);

  // 立即持久化到文件
  await persistToFile();
}

async function ensureUserFromPreset(user: PresetUser): Promise<AccessUser> {
  // canonical 用户名：getUserByUsername 已大小写不敏感，故 preset 里即便写了大写也不会重建重复行；
  // 落库仍存 canonical，保证 store 用户名规范一致（历史 sxAdmin/sxadmin 分裂根治）。
  const username = canonicalizeUsername(user.username);
  const existing = await getUserByUsername(username);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await duckdbService.query(`
    INSERT INTO UserAccount
      (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(username)}',
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
  await duckdbService.query(`
    INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(user.passwordHash)}',
      'bootstrap_required',
      NULL,
      '${escapeSqlValue(new Date().toISOString())}'
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

/**
 * 用户字段对账时**跳过**的字段，逐条理由（新增字段前先判断是否属于以下任一类，属于则登记到此）：
 *  - username：对账主键本身，不参与比对。
 *  - displayName：管理面 updateUser 可改名，store 权威。
 *  - passwordHash：凭据三级优先级链（auth.ts resolveEffectiveHash）的第 3 级。
 *    multi-branch-day1-sop.md Step 4.0 明确「源码把占位改成 tombstone 不会也不得覆盖
 *    store 里已落地的哈希」——回填即破坏该不变量。
 *  - active：账号生命周期归管理面 / 激活流程，preset 的 active 只是初始值。
 *  - allowedRoutes / defaultRoute：**用户行上的值不参与后端鉴权**——路由白名单由
 *    PRESET_ROLES 按 role 派生（permission.ts getAllowedRoutesForRole、
 *    auth.ts 登录响应 resolveAllowedRoutes），已有两处兜底；再加一处即第三套事实源。
 *  - specialFeatures：授权型字段，管理面清空 = 有意收回（如撤 cost 成本权限），
 *    回填等于把管理员撤掉的权限自动还回去 —— 提权。
 *  - visibleBranches：非 store 列（UserAccount 无此字段），登录时由 PRESET_USERS
 *    经 getPresetVisibleBranches 派生，本就不存在漂移。
 */
const RECONCILE_IGNORED_PRESET_FIELDS: ReadonlySet<keyof PresetUser> = new Set([
  'username',
  'displayName',
  'passwordHash',
  'active',
  'allowedRoutes',
  'defaultRoute',
  'specialFeatures',
  'visibleBranches',
]);

/**
 * 自动回填 store 缺失的 branch_code（**唯一**可自愈字段 · RED LINE 边界）。
 *
 * 只有同时满足以下三条的字段才可加入自愈范围，新增前须逐条论证并补不变量测试：
 *  1. **约束型而非授权型**：该字段只收窄可见范围。回填至多把账号恢复到 preset 既定范围，
 *     绝不可能授予 preset 未声明的权限。
 *  2. **缺失即 fail-closed**：缺失时账号本就被拒——RLS 开启时 permission.ts 对无 branchCode
 *     的 token 直接 401；报告门户 reports.ts resolvePortalScope 要求 branch 合法否则 403。
 *     故回填的下界是「当前完全不可用」，不存在因回填新增的暴露面。
 *  3. **空值绝非运维意图**：updateUser 显式「branch_code 仅在传入时更新，未传则保留原值」
 *     （见该函数注释），即管理面不存在「有意把 branchCode 置空」的路径 ⇒ store 侧为空
 *     只可能是 preset 演进漂移（branchCode 于 2026-06-05 多省改造才进 preset，早于此
 *     seed 的 store 行没有该字段）。
 *
 * organization 满足 1、2 但**不**满足 3（管理面把 org_user 改成 branch_admin 后清空
 * organization 是合法态），故只告警不回填，交人工判断。
 *
 * 已有值一律不覆盖：store 侧的值可能是管理面有意改的（本机 store 实测 admin=SX 而 preset=SC），
 * 覆盖会把运维决策悄悄回滚。值冲突只告警，见 warnPresetUserDrift。
 *
 * @returns 是否实际写入（调用方据此决定是否落盘）
 */
async function backfillMissingBranchCode(
  preset: PresetUser,
  existing: AccessUser
): Promise<boolean> {
  if (!preset.branchCode || existing.branchCode) return false;
  await duckdbService.query(`
    UPDATE UserAccount
    SET branch_code = ${toSqlString(preset.branchCode)},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = '${escapeSqlValue(existing.id)}'
  `);
  log.warn(
    `preset 对账：账号 ${preset.username} 的 branch_code 缺失（store 早于 branchCode 引入），` +
      `已按 preset 回填为 ${preset.branchCode}。RLS 开启时该账号此前恒 401 / 报告门户 403。`
  );
  return true;
}

/**
 * store ↔ 源码 preset 的用户字段漂移告警（只警告不自动改，与 warnRoleRouteDrift 同一口径）。
 *
 * 覆盖两类：
 *  1. preset 声明了值而 store 侧为空 —— 即「preset 新增字段对存量行永不生效」这一漂移类本身。
 *     默认对**所有**未登记在 RECONCILE_IGNORED_PRESET_FIELDS 的字段生效（fail-loud 默认），
 *     故下一个新增的 preset 字段会在启动日志里自己叫出来，而不是静默重演 branchCode 那次。
 *  2. branchCode 值冲突（两侧都有值且不等）—— store 权威不覆盖，但跨省字段冲突须让人看见。
 */
function warnPresetUserDrift(preset: PresetUser, existing: AccessUser): void {
  // 按字段名动态取值：AccessUser 无索引签名，故须经 unknown 中转（本对账刻意是「字段无关」的
  // 通用扫描——正是它让未来新增的 preset 字段默认被检查到，不必逐个手写 accessor）。
  const readStoreField = (key: keyof PresetUser): unknown =>
    (existing as unknown as Record<string, unknown>)[key];

  for (const key of Object.keys(preset) as (keyof PresetUser)[]) {
    if (RECONCILE_IGNORED_PRESET_FIELDS.has(key)) continue;
    const presetValue = preset[key];
    if (presetValue === undefined || presetValue === null) continue;
    const storeValue = readStoreField(key);
    const storeEmpty =
      storeValue === undefined ||
      storeValue === null ||
      storeValue === '' ||
      (Array.isArray(storeValue) && storeValue.length === 0);
    if (storeEmpty) {
      log.warn(
        `preset 对账：账号 ${preset.username} 的 ${key} 在 store 中缺失，而源码 preset 声明为 ` +
          `${JSON.stringify(presetValue)}。store 是运维权威故不自动改写；若非管理面有意为之，` +
          `请在用户管理面补齐（该字段缺失可能导致该账号被 fail-closed 拒绝）。`
      );
    }
  }
  if (preset.branchCode && existing.branchCode && preset.branchCode !== existing.branchCode) {
    log.warn(
      `preset 对账：账号 ${preset.username} 的 branch_code store=${existing.branchCode} ` +
        `≠ preset=${preset.branchCode}。store 权威故保留 store 值；若非管理面有意改省，` +
        `请核对——该字段决定跨省数据隔离范围。`
    );
  }
}

export async function seedAccessControlData(): Promise<void> {
  const store = loadStoreFromFile();
  if (store) {
    await loadFromStore(store);
    // 对账：store 已存在时补齐 preset 新增账号（存量行一律不动）。
    // 否则新 preset 账号（如自助设密 6 账号）要等首次密码登录才 lazy 落库；
    // 而 tombstone 账号根本无法密码登录 → 管理员在管理面看不到它、发不了激活令牌（死锁）。
    //
    // 存量行则做**字段级**对账：ensureUserFromPreset 只在账号不存在时建行，此后 preset 里
    // 新增/修正的字段对已存在的行永不生效 → 源码与 store 静默漂移（branchCode 即实证）。
    // 边界见 backfillMissingBranchCode：仅 branch_code 自愈，其余一律只告警。
    let backfilled = 0;
    for (const preset of Object.values(PRESET_USERS)) {
      const existing = await getUserByUsername(preset.username);
      if (!existing) {
        await ensureUserFromPreset(preset);
        log.info(`preset 对账：补齐 store 缺失账号 ${preset.username}`);
        continue;
      }
      const didBackfill = await backfillMissingBranchCode(preset, existing);
      if (didBackfill) backfilled++;
      // 回填后的有效视图（不可变更新，不改动 existing 本身）
      const effective = didBackfill ? { ...existing, branchCode: preset.branchCode } : existing;
      warnPresetUserDrift(preset, effective);
    }
    if (backfilled > 0) {
      // 落盘一次即可（逐用户 persist 会放大启动 IO）。
      // ⚠️ 删掉这行 → duckdb-access-control-preset-reconcile.test.ts 必红（已变异验证）：
      //    不落盘 = 进程内看着已修复、reload 后 store 仍缺 branch_code，账号继续 401/403，
      //    而日志还在打印"已持久化" —— 最坏的静默失败。
      await persistToFile();
      log.warn(`preset 对账：共回填 ${backfilled} 个账号的 branch_code 并已持久化`);
    }
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

export async function refreshActiveUsernames(): Promise<void> {
  await refreshActiveUsernamesCache();
}

// ============================================
// 查询
// ============================================

/**
 * 用户名规范化（唯一 canonical 口径）：NFKC 归一 + 去空白 + 转小写。
 *
 * 登录早已用同一口径归一输入（auth.ts normalizeUsername），但**写入与查询边界**历史上
 * 按原始字符串精确处理 → 用户名大小写分裂：管理面可建 `NewUser`，登录查 `newuser` 找不到；
 * reconcile 的 getUserByUsername 大小写敏感又会因 `sxAdmin`/`sxadmin` 差异重建重复行。
 * 根治 = 所有写入存 canonical 用户名 + 查询大小写不敏感匹配（见 getUserByUsername）。
 */
export function canonicalizeUsername(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export async function getUserByUsername(username: string): Promise<AccessUser | null> {
  // 大小写不敏感匹配：既命中存量非规范行（历史大写用户名），也让 canonical 写入的新行一致命中。
  // 用 LOWER(username)=canonical 而非 username=canonical，避免存量未迁移的大写行漏配。
  const rows = await duckdbService.query(`
    SELECT *
    FROM UserAccount
    WHERE LOWER(username) = '${escapeSqlValue(canonicalizeUsername(username))}'
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

async function listAuthIdentitiesInternal(): Promise<AuthIdentityRecord[]> {
  const rows = await duckdbService.query('SELECT * FROM AuthIdentity ORDER BY provider, provider_subject');
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider) as AuthIdentityRecord['provider'],
    providerSubject: String(row.provider_subject),
    enabled: Boolean(row.enabled),
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

async function listPasswordCredentialsInternal(): Promise<PasswordCredentialRecord[]> {
  const rows = await duckdbService.query('SELECT * FROM PasswordCredential ORDER BY user_id');
  return rows.map((row) => ({
    userId: String(row.user_id),
    passwordHash: String(row.password_hash),
    state: String(row.state) as PasswordCredentialRecord['state'],
    changedAt: row.changed_at ? String(row.changed_at) : undefined,
  }));
}

export async function persistAccessControlState(): Promise<void> {
  await persistToFile();
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
  const username = canonicalizeUsername(input.username);
  const exists = await getUserByUsername(username);
  if (exists) {
    throw new AppError(409, '用户名已存在');
  }
  const id = crypto.randomUUID();
  await duckdbService.query(`
    INSERT INTO UserAccount
      (id, username, display_name, password_hash, role, organization, branch_code, allowed_routes, default_route, allowed_ips, special_features, active, created_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(username)}',
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
  await duckdbService.query(`
    INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
    VALUES (
      '${escapeSqlValue(id)}',
      '${escapeSqlValue(input.passwordHash)}',
      'bootstrap_required',
      NULL,
      '${escapeSqlValue(new Date().toISOString())}'
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

/**
 * 飞书个人身份专用开户：用户与身份绑定在同一 DuckDB 事务内创建，避免留下无身份孤儿账号。
 * 保留兼容 password_hash 列，但不创建 PasswordCredential。
 */
export async function createFeishuUserWithIdentity(input: {
  username: string;
  displayName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
  passwordHash: string;
  identityId: string;
  providerSubject: string;
  verifiedAt: string;
}): Promise<AccessUser> {
  const username = canonicalizeUsername(input.username);
  const existing = await getUserByUsername(username);
  if (existing) throw new AppError(409, '用户名已存在');
  const id = crypto.randomUUID();
  await duckdbService.query(`
    BEGIN TRANSACTION;
      INSERT INTO UserAccount
        (id, username, display_name, password_hash, role, organization, branch_code, active, created_at, updated_at)
      VALUES (
        '${escapeSqlValue(id)}', '${escapeSqlValue(username)}', '${escapeSqlValue(input.displayName)}',
        '${escapeSqlValue(input.passwordHash)}', '${escapeSqlValue(input.role)}', '${escapeSqlValue(input.organization)}',
        '${escapeSqlValue(input.branchCode)}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO AuthIdentity
        (id, user_id, provider, provider_subject, enabled, last_verified_at, created_at, updated_at)
      VALUES (
        '${escapeSqlValue(input.identityId)}', '${escapeSqlValue(id)}', 'feishu',
        '${escapeSqlValue(input.providerSubject)}', true, '${escapeSqlValue(input.verifiedAt)}',
        '${escapeSqlValue(input.verifiedAt)}', '${escapeSqlValue(input.verifiedAt)}'
      );
    COMMIT;
  `);
  await persistToFile();
  await refreshActiveUsernamesCache();
  const created = await getUserByUsername(input.username);
  if (!created) throw new AppError(500, '创建飞书个人账号失败');
  return created;
}

export async function updateFeishuUserEntitlement(user: AccessUser, input: {
  displayName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
}): Promise<AccessUser> {
  await duckdbService.query(`
    UPDATE UserAccount SET
      display_name = '${escapeSqlValue(input.displayName)}', role = '${escapeSqlValue(input.role)}',
      organization = '${escapeSqlValue(input.organization)}', branch_code = '${escapeSqlValue(input.branchCode)}',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = '${escapeSqlValue(user.id)}'
  `);
  await persistToFile();
  return (await getUserById(user.id)) ?? user;
}

/** 明确重新获得部门授权时，复用原账号并恢复 active。 */
export async function reactivateFeishuUserEntitlement(user: AccessUser, input: {
  displayName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
}): Promise<AccessUser> {
  await duckdbService.query(`
    UPDATE UserAccount SET
      display_name = '${escapeSqlValue(input.displayName)}', role = '${escapeSqlValue(input.role)}',
      organization = '${escapeSqlValue(input.organization)}', branch_code = '${escapeSqlValue(input.branchCode)}',
      active = true, updated_at = CURRENT_TIMESTAMP
    WHERE id = '${escapeSqlValue(user.id)}'
  `);
  await persistToFile();
  await refreshActiveUsernamesCache();
  return (await getUserById(user.id)) ?? { ...user, ...input, active: true };
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
  if (input.passwordHash) {
    const credentials = await duckdbService.query(`
      SELECT user_id FROM PasswordCredential
      WHERE user_id = '${escapeSqlValue(id)}'
      LIMIT 1
    `);
    if (credentials.length === 0) throw new AppError(403, 'AUTH_METHOD_NOT_ALLOWED');
  }
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
    // 管理面重置密码 = 一次性临时凭据（阶段二口径，取代阶段一「视为自设」）：
    // 置空 password_changed_at → 该账号回到 pns 态，用户凭临时密码下次登录成功即被
    // 强制自设专属密码。禁止管理员直接设定长期生效密码（管理员不应知晓用户长期密码）。
    // 边界：仍在 USER_PASSWORDS 覆盖清单内的账号，pns 态下 env 哈希优先于本临时哈希
    // （三级哈希链第 2 级），此临时密码不生效——此类账号请改用 reset-token 通道。
    updates.push('password_changed_at = NULL');
  }
  await duckdbService.query(`
    UPDATE UserAccount
    SET ${updates.join(', ')}
    WHERE id = '${escapeSqlValue(id)}'
  `);
  if (input.passwordHash) {
    await duckdbService.query(`DELETE FROM PasswordCredential WHERE user_id = '${escapeSqlValue(id)}'`);
    await duckdbService.query(`
      INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
      VALUES (
        '${escapeSqlValue(id)}',
        '${escapeSqlValue(input.passwordHash)}',
        'bootstrap_required',
        NULL,
        '${escapeSqlValue(new Date().toISOString())}'
      )
    `);
  }
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
  const changedAt = new Date().toISOString();
  // 原子写：UPDATE UserAccount + 覆盖 PasswordCredential 必须在同一连接的事务里，
  // 否则拆成多次 query() 落到不同池连接、无事务边界，中间步失败会把账号写成半坏态
  // （password_changed_at 已置新哈希 + 凭据行已删 → login 恒 403，锁死到下次 reseed；
  //  DELETE/INSERT 拆连接还偶发 Duplicate key 主键冲突）。见 duckdbService.transaction 头注释。
  await duckdbService.transaction([
    `UPDATE UserAccount
       SET password_hash = '${escapeSqlValue(passwordHash)}',
           password_changed_at = '${escapeSqlValue(changedAt)}',
           updated_at = CURRENT_TIMESTAMP
     WHERE id = '${escapeSqlValue(user.id)}'`,
    `DELETE FROM PasswordCredential WHERE user_id = '${escapeSqlValue(user.id)}'`,
    `INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
     VALUES (
       '${escapeSqlValue(user.id)}',
       '${escapeSqlValue(passwordHash)}',
       'active',
       '${escapeSqlValue(changedAt)}',
       '${escapeSqlValue(changedAt)}'
     )`,
  ]);
  await persistToFile();
  const updated = await getUserByUsername(username);
  if (!updated) {
    throw new AppError(500, '密码更新失败');
  }
  return updated;
}

export async function deleteUser(id: string): Promise<void> {
  await duckdbService.query(`DELETE FROM AuthIdentity WHERE user_id = '${escapeSqlValue(id)}'`);
  await duckdbService.query(`DELETE FROM PasswordCredential WHERE user_id = '${escapeSqlValue(id)}'`);
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
