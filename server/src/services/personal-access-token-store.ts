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

function toSqlTimestampOrNull(iso: string | null): string {
  if (!iso) return 'NULL';
  const sql = new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
  return `TIMESTAMP '${sql}'`;
}

function toSqlStringOrNull(v: string | null): string {
  return v === null ? 'NULL' : `'${escapeSqlValue(v)}'`;
}

/**
 * 把当前 DuckDB ApiToken 表全量导出到 JSON 文件。
 * 单 PM2 fork 下进程内串行调用安全，无并发竞争。
 */
export async function saveApiTokens(): Promise<void> {
  try {
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
  } catch (err) {
    // 持久化失败不应阻塞热路径，但必须告警
    console.error('[PAT] 持久化 api_tokens.json 失败:', err);
  }
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

  const values = parsed.tokens.map((t) => `(
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

  await duckdbService.query(`
    INSERT INTO ApiToken
      (token_id, token_hash, user_id, username, name,
       expires_at, last_used_at, last_used_ip, created_at, revoked_at)
    VALUES
    ${values}
  `);

  console.log(`[PAT] 从 api_tokens.json 加载了 ${parsed.tokens.length} 条 ApiToken`);
  return parsed.tokens.length;
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
