/**
 * PAT 持久层 — 镜像 DuckDB ApiToken 表到 server/data/api_tokens.json
 * + v5 状态持久层 Phase 3（B298）SQLite 双写
 *
 * ⚠️ 访问契约（RED LINE，沿用 state-db.ts 头注释）：
 *   ONLY personal-access-token.ts may import this module.
 *   CLI / MCP / routes 走 HTTP API。
 *
 * 背景：DuckDB 主库是 :memory:（Parquet 派生缓存），PM2 reload 即重建。
 * ApiToken 是 user state，必须独立持久化。
 *
 * 写入策略（v5 Phase 3）：
 *   - backend=sqlite：state.db api_tokens 表是主权威，JSON 是 transition 期可读 backup
 *   - backend=json（默认）：行为完全等于 Phase 2 之前（除 throw 替代吞错）
 *   - saveApiTokens() 做 snapshot 模式（DELETE + bulk INSERT 单事务），与 row-level CRUD
 *     双轨并存：CRUD 路径在 personal-access-token.ts 做 row-level 双写保证最小延迟一致；
 *     snapshot 是兜底，保证整表与 DuckDB :memory: 完全等价
 *   - 单 PM2 fork（ecosystem.config.cjs: instances=1）内进程内串行无 race
 *   - 原子写：fs.writeFileSync(tmp) + fs.renameSync(tmp → final)
 *
 * 读取策略：
 *   启动时 duckdb-init-tables 建空表后调用 loadApiTokensIntoTable()
 *   backend=sqlite 时优先从 state.db 加载，失败降级 JSON
 *   文件缺失/损坏 → 空表（首次启动正常情况，警告日志）
 */

import fs from 'fs';
import { duckdbService } from './duckdb.js';
import { getApiTokenStorePath, getDataDir } from '../config/paths.js';
import { dbEnv } from '../config/env.js';
import { escapeSqlValue } from '../utils/security.js';

// state-db dynamic import — 防止默认 backend=json 模式下意外加载 better-sqlite3
// 触发 Bun NAPI 错误（同 access-control.ts 的 ensureAccessControlStore 模式）。
type StateDbModule = typeof import('./state-db.js');
let stateDb: StateDbModule | null = null;

async function ensureStateDb(): Promise<StateDbModule> {
  if (stateDb) return stateDb;
  stateDb = await import('./state-db.js');
  if (!stateDb.isInitialized()) stateDb.init();
  return stateDb;
}

export interface PatRecord {
  token_id: string;
  token_hash: string;
  user_id: string;
  username: string;
  name: string;
  expires_at: string;       // ISO string
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;       // ISO string
  revoked_at: string | null;
}

interface PersistedTokenRow {
  token_id: string;
  token_hash: string;
  user_id: string;
  username: string;
  name: string;
  expires_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface ApiTokenStoreFile {
  version: 1;
  exportedAt: string;
  tokens: PersistedTokenRow[];
}

function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * 把 ISO 字符串转为 DuckDB TIMESTAMP 字面量。
 * 非法值（脏数据/手工编辑出错）→ 返回 'NULL' 而非抛 RangeError；
 * 否则会让 loadApiTokensIntoTable 失败、中断 app 启动（codex P2）。
 */
function toSqlTimestampOrNull(iso: string | null): string {
  if (!iso) return 'NULL';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 'NULL';
  const sql = date.toISOString().slice(0, 19).replace('T', ' ');
  return `TIMESTAMP '${sql}'`;
}

/** 时间字符串是否合法。用于过滤 NOT NULL 字段失效的整条记录。 */
function isValidIsoTime(v: string | null | undefined): boolean {
  if (!v) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

function toSqlStringOrNull(v: string | null): string {
  return v === null ? 'NULL' : `'${escapeSqlValue(v)}'`;
}

// ─────────────────────────────────────────────────────────────
// SQLite Repository（row-level + snapshot 兼用）
// ─────────────────────────────────────────────────────────────

/**
 * Row-level upsert：createPat 双写路径调用。
 * ON CONFLICT 用于异常重试（理论上 token_id 全局唯一）。
 */
export async function upsertPatToSqlite(record: PatRecord): Promise<void> {
  const mod = await ensureStateDb();
  mod.withTransaction((db) => {
    db.prepare(`
      INSERT INTO api_tokens
        (token_id, token_hash, user_id, username, name,
         expires_at, last_used_at, last_used_ip, created_at, revoked_at)
      VALUES
        (@token_id, @token_hash, @user_id, @username, @name,
         @expires_at, @last_used_at, @last_used_ip, @created_at, @revoked_at)
      ON CONFLICT(token_id) DO UPDATE SET
        token_hash   = excluded.token_hash,
        user_id      = excluded.user_id,
        username     = excluded.username,
        name         = excluded.name,
        expires_at   = excluded.expires_at,
        last_used_at = excluded.last_used_at,
        last_used_ip = excluded.last_used_ip,
        created_at   = excluded.created_at,
        revoked_at   = excluded.revoked_at
    `).run(record);
  });
}

/** Row-level revoke：revokePat 双写路径调用 */
export async function revokePatInSqlite(tokenId: string, revokedAt: string): Promise<void> {
  const mod = await ensureStateDb();
  mod.withTransaction((db) => {
    db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE token_id = ?').run(revokedAt, tokenId);
  });
}

/** Row-level un-revoke：revokePat mirror 失败时回滚用 */
export async function unrevokePatInSqlite(tokenId: string): Promise<void> {
  const mod = await ensureStateDb();
  mod.withTransaction((db) => {
    db.prepare('UPDATE api_tokens SET revoked_at = NULL WHERE token_id = ?').run(tokenId);
  });
}

/** Row-level delete：createPat mirror 失败时回滚用 */
export async function deletePatFromSqlite(tokenId: string): Promise<void> {
  const mod = await ensureStateDb();
  mod.withTransaction((db) => {
    db.prepare('DELETE FROM api_tokens WHERE token_id = ?').run(tokenId);
  });
}

/** Batch update last_used_at（flush 路径，fire-and-forget warn） */
export async function updateLastUsedBatchInSqlite(
  updates: Array<{ tokenId: string; lastUsedAt: string; lastUsedIp: string }>,
): Promise<void> {
  if (updates.length === 0) return;
  const mod = await ensureStateDb();
  mod.withTransaction((db) => {
    const stmt = db.prepare(
      'UPDATE api_tokens SET last_used_at = ?, last_used_ip = ? WHERE token_id = ?',
    );
    for (const u of updates) stmt.run(u.lastUsedAt, u.lastUsedIp, u.tokenId);
  });
}

/** 读取全表（启动 reload / mirror reload / 一次性 CLI 用） */
export async function readAllPatsFromSqlite(): Promise<PatRecord[]> {
  const mod = await ensureStateDb();
  const db = mod.getDb();
  const rows = db
    .prepare(`
      SELECT token_id, token_hash, user_id, username, name,
             expires_at, last_used_at, last_used_ip, created_at, revoked_at
      FROM api_tokens
      ORDER BY created_at
    `)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    token_id: String(r.token_id),
    token_hash: String(r.token_hash),
    user_id: String(r.user_id),
    username: String(r.username),
    name: String(r.name),
    expires_at: String(r.expires_at),
    last_used_at: r.last_used_at === null || r.last_used_at === undefined ? null : String(r.last_used_at),
    last_used_ip: r.last_used_ip === null || r.last_used_ip === undefined ? null : String(r.last_used_ip),
    created_at: String(r.created_at),
    revoked_at: r.revoked_at === null || r.revoked_at === undefined ? null : String(r.revoked_at),
  }));
}

/** admin-import-pat-from-json 用：判断 state.db api_tokens 表是否已有数据 */
export async function hasPatDataInSqlite(): Promise<boolean> {
  const mod = await ensureStateDb();
  const db = mod.getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM api_tokens').get() as { n: number };
  return row.n > 0;
}

/** Snapshot 全量替换：admin-import-pat-from-json + doSaveApiTokens 内部用 */
export async function replaceAllPatsInSqlite(records: PatRecord[]): Promise<void> {
  const mod = await ensureStateDb();
  mod.withTransaction((db) => {
    db.exec('DELETE FROM api_tokens');
    const stmt = db.prepare(`
      INSERT INTO api_tokens
        (token_id, token_hash, user_id, username, name,
         expires_at, last_used_at, last_used_ip, created_at, revoked_at)
      VALUES
        (@token_id, @token_hash, @user_id, @username, @name,
         @expires_at, @last_used_at, @last_used_ip, @created_at, @revoked_at)
    `);
    for (const r of records) stmt.run(r);
  });
}

// ─────────────────────────────────────────────────────────────
// JSON snapshot（保留 transition 期 fallback / backup）
// + SQLite snapshot first（v5 Phase 3）
// ─────────────────────────────────────────────────────────────

/**
 * 串行化队列：单进程内 saveApiTokens 内部 `await duckdbService.query` 会让出事件循环，
 * 两个并发调用可能交错执行，导致旧快照覆盖新快照（codex P1）。
 * 用 promise chain 强制每次写入完整跑完 SELECT→write→rename 后再开始下一次。
 */
let writeQueue: Promise<void> = Promise.resolve();

async function doSaveApiTokens(): Promise<void> {
  const rows = await duckdbService.query(`
    SELECT token_id, token_hash, user_id, username, name,
           expires_at, last_used_at, last_used_ip, created_at, revoked_at
    FROM ApiToken
    ORDER BY created_at
  `);
  const tokens: PersistedTokenRow[] = rows.map((r: any) => ({
    token_id: String(r.token_id),
    token_hash: String(r.token_hash),
    user_id: String(r.user_id),
    username: String(r.username),
    name: String(r.name),
    expires_at: toIsoOrNull(r.expires_at) as string,
    last_used_at: toIsoOrNull(r.last_used_at),
    last_used_ip: r.last_used_ip ? String(r.last_used_ip) : null,
    created_at: toIsoOrNull(r.created_at) as string,
    revoked_at: toIsoOrNull(r.revoked_at),
  }));

  // SQLite first（snapshot pattern）—— v5 Phase 3 B298
  // 仅 backend=sqlite 启用。replaceAllPatsInSqlite 内部单事务 DELETE+bulk INSERT。
  if (dbEnv.STATE_STORE_BACKEND === 'sqlite') {
    try {
      // PatRecord 字段与 PersistedTokenRow 等价，直接复用
      await replaceAllPatsInSqlite(tokens);
    } catch (err) {
      throw new Error(
        `[PAT] state.db 写入失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // JSON 总是写（保留 transition 期 fallback）
  const store: ApiTokenStoreFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tokens,
  };

  ensureDataDir();
  const finalPath = getApiTokenStorePath();
  const tmpPath = finalPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    const inconsistency = dbEnv.STATE_STORE_BACKEND === 'sqlite'
      ? ' [INCONSISTENCY] SQLite 已写入但 JSON backup 失败，需运营介入修复 JSON。'
      : '';
    throw new Error(
      `[PAT] api_tokens.json 写入失败:${inconsistency} ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 把当前 DuckDB ApiToken 表全量导出到持久层（SQLite + JSON）。
 *
 * 通过串行队列保证多个并发调用按 SQL 完成顺序落盘，避免旧快照覆盖新快照。
 * v5 Phase 3 变更：失败 throw（含 [INCONSISTENCY] 标记），由调用方决定是否传播。
 * 旧行为（吞错 console.error）会导致 SQLite 已写 / JSON 陈旧 / 用户改动 reload 后丢失。
 */
export async function saveApiTokens(): Promise<void> {
  // 当前调用方拿到的 promise — 真实结果（含 throw）
  const myPromise = writeQueue
    .catch(() => {})              // 防前一次失败传染下一次
    .then(() => doSaveApiTokens());
  // queue 吞错（仅用于串行化下一次调用，不影响 myPromise）
  writeQueue = myPromise.catch(() => {});
  await myPromise;
}

/** 启动时调用：把持久层重新加载回 DuckDB 内存表。
 *  backend=sqlite 时优先从 state.db 加载，失败降级 JSON。
 *  缺失/损坏 → 跳过，保持空表。
 */
export async function loadApiTokensIntoTable(): Promise<number> {
  // backend=sqlite 优先：state.db api_tokens 表是主权威
  if (dbEnv.STATE_STORE_BACKEND === 'sqlite') {
    try {
      const records = await readAllPatsFromSqlite();
      if (records.length === 0) {
        console.log('[PAT] state.db api_tokens 表为空，首次启动以空 ApiToken 表运行');
        // 不 fall through 到 JSON：sqlite 模式下 state.db 是事实源
        return 0;
      }
      const inserted = await insertRecordsIntoDuckDb(records);
      console.log(`[PAT] 从 state.db 加载了 ${inserted} 条 ApiToken`);
      return inserted;
    } catch (err) {
      // 启动期降级到 JSON（不阻塞 app 启动）
      console.warn('[PAT] state.db 加载失败，降级到 api_tokens.json:', err);
      // fall through
    }
  }

  // JSON 加载路径（backend=json 默认 / sqlite 降级）
  return loadFromJsonFile();
}

async function insertRecordsIntoDuckDb(records: PatRecord[]): Promise<number> {
  const validTokens = filterValidRecords(records);
  if (validTokens.length === 0) return 0;

  await duckdbService.query(`
    INSERT INTO ApiToken
      (token_id, token_hash, user_id, username, name,
       expires_at, last_used_at, last_used_ip, created_at, revoked_at)
    VALUES
    ${buildInsertValues(validTokens)}
  `);
  return validTokens.length;
}

function filterValidRecords(records: PatRecord[]): PatRecord[] {
  const valid: PatRecord[] = [];
  for (const t of records) {
    if (!t.token_id || !t.token_hash || !t.user_id || !t.username || !t.name) {
      console.warn('[PAT] 跳过缺失必填字段的 token 记录:', t.token_id || '(no id)');
      continue;
    }
    if (!isValidIsoTime(t.expires_at) || !isValidIsoTime(t.created_at)) {
      console.warn('[PAT] 跳过时间字段非法的 token 记录:', t.token_id);
      continue;
    }
    valid.push(t);
  }
  return valid;
}

async function loadFromJsonFile(): Promise<number> {
  const storePath = getApiTokenStorePath();
  if (!fs.existsSync(storePath)) {
    console.log('[PAT] api_tokens.json 不存在，首次启动以空 ApiToken 表运行');
    return 0;
  }

  let parsed: ApiTokenStoreFile;
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    parsed = JSON.parse(raw) as ApiTokenStoreFile;
    if (!parsed || !Array.isArray(parsed.tokens)) {
      console.warn('[PAT] api_tokens.json 格式异常（tokens 非数组），跳过加载');
      return 0;
    }
  } catch (err) {
    console.warn('[PAT] api_tokens.json 解析失败，跳过加载:', err);
    return 0;
  }

  if (parsed.tokens.length === 0) return 0;

  try {
    const inserted = await insertRecordsIntoDuckDb(parsed.tokens);
    const skipped = parsed.tokens.length - inserted;
    if (skipped > 0) {
      console.log(`[PAT] 从 api_tokens.json 加载了 ${inserted} 条 ApiToken（跳过 ${skipped} 条非法记录）`);
    } else {
      console.log(`[PAT] 从 api_tokens.json 加载了 ${inserted} 条 ApiToken`);
    }
    return inserted;
  } catch (err) {
    // INSERT 失败也不应阻塞 app 启动（codex P2 兜底）
    console.error('[PAT] api_tokens.json 加载失败，PAT 表保持空:', err);
    return 0;
  }
}

/**
 * createPat / revokePat 内部用：mirror INSERT/UPDATE 失败后从 SQLite 重灌 DuckDB :memory:。
 * 仅 backend=sqlite 模式调用。
 *
 * codex P1 (PR #389) 修复：不能先 DELETE 再 INSERT，否则 readAll/insert 任一步
 * 失败就把镜像永久清空到下次重启（verifyPat 仅查 DuckDB 镜像，全实例 PAT 立刻失效）。
 * 修复策略：
 *   1. 先读 SQLite + 预构造 INSERT VALUES → 任何失败都不动镜像（旧状态保留）
 *   2. 用 DuckDB BEGIN ... COMMIT 单次 SQL 把 DELETE + INSERT 包成原子事务 →
 *      INSERT 失败时 DuckDB 自动回滚 DELETE，镜像保持旧状态
 *   3. 空表场景独立处理（单 DELETE，不需事务）
 */
export async function reloadApiTokenMirrorFromSqlite(): Promise<void> {
  // Step 1: 先读 SQLite + 预构造 INSERT 子句 — 任何失败不动镜像
  const records = await readAllPatsFromSqlite();
  const validRecords = filterValidRecords(records);

  if (validRecords.length === 0) {
    // 空表：单 DELETE，失败直接抛（不会让镜像处于"部分清空"中间态）
    await duckdbService.query('DELETE FROM ApiToken');
    return;
  }

  const values = buildInsertValues(validRecords);

  // Step 2: 原子事务 DELETE + INSERT；任一失败 DuckDB 自动 ROLLBACK
  await duckdbService.query(`
    BEGIN TRANSACTION;
    DELETE FROM ApiToken;
    INSERT INTO ApiToken
      (token_id, token_hash, user_id, username, name,
       expires_at, last_used_at, last_used_ip, created_at, revoked_at)
    VALUES
    ${values};
    COMMIT;
  `);
}

function buildInsertValues(records: PatRecord[]): string {
  return records.map((t) => `(
    '${escapeSqlValue(t.token_id)}',
    '${escapeSqlValue(t.token_hash)}',
    '${escapeSqlValue(t.user_id)}',
    '${escapeSqlValue(t.username)}',
    '${escapeSqlValue(t.name)}',
    ${toSqlTimestampOrNull(t.expires_at)},
    ${toSqlTimestampOrNull(t.last_used_at)},
    ${toSqlStringOrNull(t.last_used_ip)},
    ${toSqlTimestampOrNull(t.created_at)},
    ${toSqlTimestampOrNull(t.revoked_at)}
  )`).join(',\n');
}

/** 测试 helper：清空磁盘文件 */
export function _deleteStoreForTest(): void {
  const p = getApiTokenStorePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** 测试 helper：返回磁盘文件路径 */
export function _getStorePathForTest(): string {
  return getApiTokenStorePath();
}

/** 测试 helper：重置 stateDb dynamic import 缓存（隔离测试间状态） */
export function _resetStateDbModuleForTest(): void {
  stateDb = null;
}
