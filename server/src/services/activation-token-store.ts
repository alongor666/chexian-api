/**
 * 激活令牌持久层（全员密码体系改造 · 阶段一）
 *
 * ⚠️ 访问契约（RED LINE，沿用 state-db.ts 头注释）：
 *   ONLY activation-token.ts may import this module.
 *   CLI / MCP / routes 走 HTTP API。
 *
 * 存储设计（刻意区别于 PAT 的三层热路径设计）：
 *   激活令牌是低频、一次性、24h 短命凭据 —— 单层存储即可，无 DuckDB :memory: mirror、
 *   无 JSON snapshot 双写：
 *     - STATE_STORE_BACKEND=sqlite（生产 node/PM2）→ state.db activation_tokens 表（migration id=6）
 *     - STATE_STORE_BACKEND=json（默认 / 本地 Bun dev，better-sqlite3 不支持 Bun）
 *       → server/data/activation_tokens.json 原子写（tmp + rename）
 *   文件/表内只存 bcrypt(secret)，明文令牌仅创建响应返回一次。
 *   单 PM2 fork（instances=1）进程内串行，无跨进程并发。
 */

import fs from 'fs';
import { getActivationTokenStorePath, getDataDir } from '../config/paths.js';
import { dbEnv } from '../config/env.js';

// state-db dynamic import — 防止默认 backend=json 模式下意外加载 better-sqlite3
// 触发 Bun NAPI 错误（同 access-control / personal-access-token store 模式）。
type StateDbModule = typeof import('./state-db.js');
let stateDb: StateDbModule | null = null;

async function ensureStateDb(): Promise<StateDbModule> {
  if (stateDb) return stateDb;
  stateDb = await import('./state-db.js');
  if (!stateDb.isInitialized()) stateDb.init();
  return stateDb;
}

/**
 * 令牌用途（阶段二新增 reset）：
 *   - 'activation'：管理员签发的激活令牌（cx_act_，首次设密通道）
 *   - 'reset'：找回/重置令牌（cx_rst_，飞书扫码找回 or 管理员重置发放）
 * 两类共用同一张表/文件，消费端点按 kind 严格隔离（activation 令牌打不了 reset 端点，反之亦然）。
 */
export type PasswordTokenKind = 'activation' | 'reset';

export interface ActivationTokenRecord {
  token_id: string;
  token_hash: string;
  user_id: string;
  username: string;
  /** 签发者（管理员 username；飞书找回自助签发为 'feishu-reset'）（审计追责） */
  created_by: string;
  created_at: string; // ISO
  expires_at: string; // ISO
  used_at: string | null;
  /** 令牌用途。历史行（migration 7 之前 / 旧 JSON 文件）缺省视为 'activation'（读取时归一化） */
  kind: PasswordTokenKind;
}

/** 历史存量行无 kind 字段（阶段一产物）→ 归一化为 'activation'；非法值同样兜底 */
function normalizeKind(raw: unknown): PasswordTokenKind {
  return raw === 'reset' ? 'reset' : 'activation';
}

function useSqlite(): boolean {
  return dbEnv.STATE_STORE_BACKEND === 'sqlite';
}

// ─────────────────────────────────────────────────────────────
// JSON backend（默认 / 本地 Bun dev）
// ─────────────────────────────────────────────────────────────

interface ActivationTokenStoreFile {
  version: 1;
  tokens: ActivationTokenRecord[];
}

function readJsonStore(): ActivationTokenStoreFile {
  const storePath = getActivationTokenStorePath();
  if (!fs.existsSync(storePath)) return { version: 1, tokens: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as ActivationTokenStoreFile;
    if (!parsed || !Array.isArray(parsed.tokens)) return { version: 1, tokens: [] };
    return parsed;
  } catch (err) {
    console.warn('[ActivationToken] activation_tokens.json 解析失败，按空存储处理:', err);
    return { version: 1, tokens: [] };
  }
}

function writeJsonStore(store: ActivationTokenStoreFile): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const finalPath = getActivationTokenStorePath();
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpPath, finalPath);
}

// ─────────────────────────────────────────────────────────────
// 对外仓储 API（按 backend 分派）
// ─────────────────────────────────────────────────────────────

/** 写入新令牌 */
export async function insertActivationToken(record: ActivationTokenRecord): Promise<void> {
  if (useSqlite()) {
    const mod = await ensureStateDb();
    mod.withTransaction((db) => {
      db.prepare(`
        INSERT INTO activation_tokens
          (token_id, token_hash, user_id, username, created_by, created_at, expires_at, used_at, kind)
        VALUES
          (@token_id, @token_hash, @user_id, @username, @created_by, @created_at, @expires_at, @used_at, @kind)
      `).run(record);
    });
    return;
  }
  const store = readJsonStore();
  writeJsonStore({ ...store, tokens: [...store.tokens, record] });
}

/**
 * 作废该用户同 kind 的所有未使用令牌（重发即取代：同一账号同一用途同时只有一张有效令牌）。
 * 按 kind 隔离：签发 reset 令牌不影响在途的 activation 令牌，反之亦然。
 */
export async function deleteUnusedTokensForUser(userId: string, kind: PasswordTokenKind): Promise<void> {
  if (useSqlite()) {
    const mod = await ensureStateDb();
    mod.withTransaction((db) => {
      db.prepare(
        "DELETE FROM activation_tokens WHERE user_id = ? AND used_at IS NULL AND COALESCE(kind, 'activation') = ?"
      ).run(userId, kind);
    });
    return;
  }
  const store = readJsonStore();
  writeJsonStore({
    ...store,
    tokens: store.tokens.filter(
      (t) => !(t.user_id === userId && t.used_at === null && normalizeKind(t.kind) === kind)
    ),
  });
}

/** 按 token_id 读取（不存在 → null） */
export async function getActivationTokenById(tokenId: string): Promise<ActivationTokenRecord | null> {
  if (useSqlite()) {
    const mod = await ensureStateDb();
    const row = mod.getDb()
      .prepare('SELECT * FROM activation_tokens WHERE token_id = ?')
      .get(tokenId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      token_id: String(row.token_id),
      token_hash: String(row.token_hash),
      user_id: String(row.user_id),
      username: String(row.username),
      created_by: String(row.created_by),
      created_at: String(row.created_at),
      expires_at: String(row.expires_at),
      used_at: row.used_at === null || row.used_at === undefined ? null : String(row.used_at),
      kind: normalizeKind(row.kind),
    };
  }
  const store = readJsonStore();
  const found = store.tokens.find((t) => t.token_id === tokenId);
  return found ? { ...found, kind: normalizeKind(found.kind) } : null;
}

/**
 * 一次性消费：仅当 used_at 仍为空时置位。
 * @returns true = 本次成功占用；false = 已被使用（一次性语义被并发/重放触发）
 */
export async function markActivationTokenUsed(tokenId: string, usedAt: string): Promise<boolean> {
  if (useSqlite()) {
    const mod = await ensureStateDb();
    return mod.withTransaction((db) => {
      const result = db
        .prepare('UPDATE activation_tokens SET used_at = ? WHERE token_id = ? AND used_at IS NULL')
        .run(usedAt, tokenId);
      return result.changes === 1;
    });
  }
  const store = readJsonStore();
  const target = store.tokens.find((t) => t.token_id === tokenId);
  if (!target || target.used_at !== null) return false;
  writeJsonStore({
    ...store,
    tokens: store.tokens.map((t) => (t.token_id === tokenId ? { ...t, used_at: usedAt } : t)),
  });
  return true;
}

/** 回滚占用（设密写库失败时恢复令牌可用，避免用户白白烧掉令牌） */
export async function unmarkActivationTokenUsed(tokenId: string): Promise<void> {
  if (useSqlite()) {
    const mod = await ensureStateDb();
    mod.withTransaction((db) => {
      db.prepare('UPDATE activation_tokens SET used_at = NULL WHERE token_id = ?').run(tokenId);
    });
    return;
  }
  const store = readJsonStore();
  writeJsonStore({
    ...store,
    tokens: store.tokens.map((t) => (t.token_id === tokenId ? { ...t, used_at: null } : t)),
  });
}

/** 测试 helper：清空 JSON 存储文件（backend=json 测试隔离用） */
export function _deleteActivationStoreForTest(): void {
  const p = getActivationTokenStorePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
