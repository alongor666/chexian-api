/**
 * PAT 持久层 — 镜像 DuckDB ApiToken 表到 server/data/api_tokens.json
 *
 * 背景：DuckDB 主库是 :memory:（Parquet 派生缓存），PM2 reload 即重建。
 * ApiToken 是 user state，必须独立持久化，参考 access-control 的 user_store.json 模式。
 *
 * 写入策略：
 *   create / revoke / lastUsed flush 完成后调用 saveApiTokens()
 *   单 PM2 fork（ecosystem.config.cjs: instances=1）内进程内串行无 race
 *   原子写：fs.writeFileSync(tmp) + fs.renameSync(tmp → final)
 *
 * 读取策略：
 *   启动时 duckdb-init-tables 建空表后调用 loadApiTokensIntoTable()
 *   文件缺失/损坏 → 空表（首次启动正常情况，警告日志）
 */

import fs from 'fs';
import path from 'path';
import { duckdbService } from './duckdb.js';
import { getApiTokenStorePath, getDataDir } from '../config/paths.js';
import { escapeSqlValue } from '../utils/security.js';

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

  const store: ApiTokenStoreFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tokens,
  };

  ensureDataDir();
  const finalPath = getApiTokenStorePath();
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpPath, finalPath);
}

/**
 * 把当前 DuckDB ApiToken 表全量导出到 JSON 文件。
 * 通过串行队列保证多个并发调用按 SQL 完成顺序落盘，避免旧快照覆盖新快照。
 * 单次失败不阻塞后续调用（catch 在链上吞掉，仅打 error 日志）。
 */
export async function saveApiTokens(): Promise<void> {
  writeQueue = writeQueue
    .catch(() => {})  // 阻止前一次失败传染下一次
    .then(() => doSaveApiTokens())
    .catch((err) => {
      // 持久化失败不应阻塞热路径，但必须告警
      console.error('[PAT] 持久化 api_tokens.json 失败:', err);
    });
  await writeQueue;
}

/** 启动时调用：把 JSON 重新加载回 DuckDB 内存表。缺失/损坏 → 跳过，保持空表。 */
export async function loadApiTokensIntoTable(): Promise<number> {
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

  // 按条校验：NOT NULL 字段失效 → 跳过整条；可空字段失效 → toSqlTimestampOrNull 自然降级 NULL
  const validTokens: PersistedTokenRow[] = [];
  for (const t of parsed.tokens) {
    if (!t.token_id || !t.token_hash || !t.user_id || !t.username || !t.name) {
      console.warn('[PAT] 跳过缺失必填字段的 token 记录:', t.token_id || '(no id)');
      continue;
    }
    if (!isValidIsoTime(t.expires_at) || !isValidIsoTime(t.created_at)) {
      console.warn('[PAT] 跳过时间字段非法的 token 记录:', t.token_id);
      continue;
    }
    validTokens.push(t);
  }
  if (validTokens.length === 0) {
    console.warn('[PAT] api_tokens.json 中没有合法 token 记录');
    return 0;
  }

  const values = validTokens.map((t) => `(
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

  try {
    await duckdbService.query(`
      INSERT INTO ApiToken
        (token_id, token_hash, user_id, username, name,
         expires_at, last_used_at, last_used_ip, created_at, revoked_at)
      VALUES
      ${values}
    `);
  } catch (err) {
    // INSERT 失败也不应阻塞 app 启动（codex P2 兜底）
    console.error('[PAT] api_tokens.json 加载失败，PAT 表保持空:', err);
    return 0;
  }

  const skipped = parsed.tokens.length - validTokens.length;
  if (skipped > 0) {
    console.log(`[PAT] 从 api_tokens.json 加载了 ${validTokens.length} 条 ApiToken（跳过 ${skipped} 条非法记录）`);
  } else {
    console.log(`[PAT] 从 api_tokens.json 加载了 ${validTokens.length} 条 ApiToken`);
  }
  return validTokens.length;
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
