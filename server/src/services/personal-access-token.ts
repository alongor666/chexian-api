/**
 * Personal Access Token (PAT) Service
 *
 * 只读、长期、按用户继承权限的 Bearer Token。
 *
 * Token 格式：cx_pat_<token_id>.<secret>
 *   - token_id: 8 字符 Crockford base32 前缀，对应 ApiToken.token_id（PK）
 *   - secret:   43 字符 base64url（32 字节随机），仅在创建时返回明文一次
 *   - 服务端只存 token_hash = bcrypt(secret)
 *
 * 权限继承：verifyPat 返回时挂载 AccessUser 完整记录，
 * 下游 permissionMiddleware/req.permissionFilter 注入逻辑零改动即可工作。
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { LRUCache } from 'lru-cache';

import { duckdbService } from './duckdb.js';
import { getUserByUsername, type AccessUser } from './access-control.js';
import { authConfig } from '../config/auth.js';
import { escapeSqlValue } from '../utils/security.js';
import { AppError } from '../middleware/error.js';
import { saveApiTokens } from './personal-access-token-store.js';

const TOKEN_PREFIX = 'cx_pat_';
const TOKEN_ID_LEN = 8;
const SECRET_BYTES = 32;
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type TtlDays = 30 | 90 | 180 | 365;

export interface ApiTokenRow {
  tokenId: string;
  userId: string;
  username: string;
  name: string;
  expiresAt: Date;
  lastUsedAt?: Date;
  lastUsedIp?: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface CreatedToken {
  /** 明文 token（仅此次返回，无法再次取回） */
  plaintext: string;
  token: ApiTokenRow;
}

export interface VerifiedPat {
  user: AccessUser;
  tokenId: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────

function encodeCrockfordBase32(buf: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
    if (output.length >= length) break;
  }
  if (output.length < length && bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output.slice(0, length);
}

function generateTokenId(): string {
  return encodeCrockfordBase32(crypto.randomBytes(8), TOKEN_ID_LEN);
}

function generateSecret(): string {
  return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

function parseRow(row: any): ApiTokenRow {
  return {
    tokenId: String(row.token_id),
    userId: String(row.user_id),
    username: String(row.username),
    name: String(row.name),
    expiresAt: new Date(row.expires_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    lastUsedIp: row.last_used_ip ? String(row.last_used_ip) : undefined,
    createdAt: new Date(row.created_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : undefined,
  };
}

/**
 * 解析 raw token 为 {tokenId, secret}
 * 严格校验前缀、长度、字符集，不抛业务异常（返回 null）
 */
function splitRawToken(raw: string): { tokenId: string; secret: string } | null {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const rest = raw.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot !== TOKEN_ID_LEN) return null;
  const tokenId = rest.slice(0, TOKEN_ID_LEN);
  const secret = rest.slice(TOKEN_ID_LEN + 1);
  if (!/^[0-9A-Z]{8}$/.test(tokenId)) return null;
  if (secret.length < 32 || secret.length > 64) return null;
  return { tokenId, secret };
}

// ─────────────────────────────────────────────────────────────
// 校验缓存：避免 bcrypt 在热路径上反复运行（~10ms/次）
// key = `${tokenId}:${secretFingerprint}`
// secretFingerprint = sha256(secret).slice(0,16)，避免把明文 secret 放进 cache key
// ─────────────────────────────────────────────────────────────
const verifyCache = new LRUCache<string, true>({
  max: 200,
  ttl: 5 * 60 * 1000,
});

function fingerprintSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────
// last_used_at 批量写入：避免热路径阻塞
// ─────────────────────────────────────────────────────────────
interface PendingUpdate {
  tokenId: string;
  ip: string;
  ts: number;
}
let pendingBuffer: PendingUpdate[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingUpdates();
  }, 500);
}

async function flushPendingUpdates(): Promise<void> {
  if (pendingBuffer.length === 0) return;
  // 同 tokenId 只保留最新一条
  const byToken = new Map<string, PendingUpdate>();
  for (const item of pendingBuffer) {
    const existing = byToken.get(item.tokenId);
    if (!existing || existing.ts < item.ts) {
      byToken.set(item.tokenId, item);
    }
  }
  pendingBuffer = [];
  let anyUpdated = false;
  for (const update of byToken.values()) {
    try {
      await duckdbService.query(`
        UPDATE ApiToken
        SET last_used_at = TIMESTAMP '${new Date(update.ts).toISOString().slice(0, 19).replace('T', ' ')}',
            last_used_ip = '${escapeSqlValue(update.ip)}'
        WHERE token_id = '${escapeSqlValue(update.tokenId)}'
      `);
      anyUpdated = true;
    } catch (err) {
      console.warn(`[PAT] last_used_at update failed for ${update.tokenId}:`, err);
    }
  }
  // batch flush 完后一次性落盘（受 500ms throttle + 100 buffer 节流，写盘频率可控）
  if (anyUpdated) await saveApiTokens();
}

function scheduleLastUsedUpdate(tokenId: string, ip: string): void {
  pendingBuffer.push({ tokenId, ip, ts: Date.now() });
  if (pendingBuffer.length >= 100) {
    void flushPendingUpdates();
  } else {
    scheduleFlush();
  }
}

// ─────────────────────────────────────────────────────────────
// 对外 API
// ─────────────────────────────────────────────────────────────

const VALID_TTL_DAYS: ReadonlySet<TtlDays> = new Set([30, 90, 180, 365]);

export async function createPat(input: {
  userId: string;
  username: string;
  name: string;
  ttlDays: TtlDays;
}): Promise<CreatedToken> {
  if (!VALID_TTL_DAYS.has(input.ttlDays)) {
    throw new AppError(400, 'Invalid ttlDays');
  }
  const trimmed = input.name.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new AppError(400, 'Token name must be 1-64 characters');
  }

  const tokenId = generateTokenId();
  const secret = generateSecret();
  const tokenHash = await bcrypt.hash(secret, authConfig.bcryptSaltRounds);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlDays * 86_400_000);

  const expiresAtSql = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
  const createdAtSql = now.toISOString().slice(0, 19).replace('T', ' ');

  await duckdbService.query(`
    INSERT INTO ApiToken
      (token_id, token_hash, user_id, username, name, expires_at, created_at)
    VALUES (
      '${escapeSqlValue(tokenId)}',
      '${escapeSqlValue(tokenHash)}',
      '${escapeSqlValue(input.userId)}',
      '${escapeSqlValue(input.username)}',
      '${escapeSqlValue(trimmed)}',
      TIMESTAMP '${expiresAtSql}',
      TIMESTAMP '${createdAtSql}'
    )
  `);
  await saveApiTokens();

  return {
    plaintext: `${TOKEN_PREFIX}${tokenId}.${secret}`,
    token: {
      tokenId,
      userId: input.userId,
      username: input.username,
      name: trimmed,
      expiresAt,
      createdAt: now,
    },
  };
}

export async function listPatsByUser(userId: string): Promise<ApiTokenRow[]> {
  const rows = await duckdbService.query(`
    SELECT token_id, user_id, username, name, expires_at, last_used_at, last_used_ip, created_at, revoked_at
    FROM ApiToken
    WHERE user_id = '${escapeSqlValue(userId)}'
    ORDER BY created_at DESC
  `);
  return rows.map(parseRow);
}

/**
 * 吊销 PAT。
 * 鉴权：只允许吊销 user_id 匹配的 token（防越权）。
 * 若 token 不存在或不属于该用户，抛 404。
 */
export async function revokePat(userId: string, tokenId: string): Promise<void> {
  const rows = await duckdbService.query(`
    SELECT token_id FROM ApiToken
    WHERE token_id = '${escapeSqlValue(tokenId)}'
      AND user_id = '${escapeSqlValue(userId)}'
      AND revoked_at IS NULL
    LIMIT 1
  `);
  if (rows.length === 0) {
    throw new AppError(404, 'Token not found or already revoked');
  }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await duckdbService.query(`
    UPDATE ApiToken
    SET revoked_at = TIMESTAMP '${now}'
    WHERE token_id = '${escapeSqlValue(tokenId)}'
  `);
  verifyCache.delete(`${tokenId}:*`);
  // 简单粗暴：吊销时清空与该 tokenId 相关的所有缓存条目
  for (const key of verifyCache.keys()) {
    if (key.startsWith(`${tokenId}:`)) verifyCache.delete(key);
  }
  await saveApiTokens();
}

/**
 * 校验 PAT。成功返回 {user, tokenId, name}；失败抛 AppError。
 * 调用方收到结果后将 user 注入 req.user，将 {tokenId,name} 注入 req.pat。
 * 同时异步更新 last_used_at（不阻塞）。
 */
export async function verifyPat(rawToken: string, clientIp?: string): Promise<VerifiedPat> {
  const parts = splitRawToken(rawToken);
  if (!parts) {
    throw new AppError(401, 'Invalid PAT format');
  }
  const { tokenId, secret } = parts;

  const rows = await duckdbService.query(`
    SELECT token_id, token_hash, user_id, username, name, expires_at, revoked_at
    FROM ApiToken
    WHERE token_id = '${escapeSqlValue(tokenId)}'
    LIMIT 1
  `);
  if (rows.length === 0) {
    throw new AppError(401, 'Invalid PAT');
  }
  const row = rows[0];
  if (row.revoked_at) {
    throw new AppError(401, 'PAT has been revoked');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, 'PAT expired');
  }

  // 校验 secret（命中缓存则跳过 bcrypt）
  const cacheKey = `${tokenId}:${fingerprintSecret(secret)}`;
  if (!verifyCache.has(cacheKey)) {
    const ok = await bcrypt.compare(secret, String(row.token_hash));
    if (!ok) {
      throw new AppError(401, 'Invalid PAT');
    }
    verifyCache.set(cacheKey, true);
  }

  // 拉用户元数据：失活立即拒绝
  const user = await getUserByUsername(String(row.username));
  if (!user) {
    throw new AppError(401, 'Token owner no longer exists');
  }
  if (!user.active) {
    throw new AppError(403, 'Account disabled');
  }

  if (clientIp) {
    scheduleLastUsedUpdate(tokenId, clientIp);
  }

  return {
    user,
    tokenId,
    name: String(row.name),
  };
}

/**
 * 测试 helper：等待挂起的 last_used_at 写入完成。
 * 仅供单元/集成测试使用，生产代码不应调用。
 */
export async function _flushPendingForTest(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushPendingUpdates();
}

/**
 * 测试 helper：清空验证缓存。
 */
export function _clearVerifyCacheForTest(): void {
  verifyCache.clear();
}
