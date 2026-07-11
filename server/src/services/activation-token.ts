/**
 * 激活令牌服务（全员密码体系改造 · 阶段一）
 *
 * 管理员为账号签发一次性激活令牌（不依赖飞书的备份激活通道）：
 *   - 令牌格式：cx_act_<token_id8>.<secret43>（与 PAT cx_pat_ 前缀区分）
 *   - 服务端只存 bcrypt(secret)，明文仅创建响应返回一次
 *   - 24h 有效、一次性；重发即作废该账号旧的未使用令牌
 *   - 消费端点 /api/auth/activate 未认证：统一错误消息防枚举 + 独立限流桶
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { authConfig } from '../config/auth.js';
import { validatePasswordPolicy } from '../config/password-policy.js';
import { AppError } from '../middleware/error.js';
import { getUserById, setUserPasswordByUsername } from './access-control.js';
import {
  insertActivationToken,
  deleteUnusedTokensForUser,
  getActivationTokenById,
  markActivationTokenUsed,
  unmarkActivationTokenUsed,
} from './activation-token-store.js';

const TOKEN_PREFIX = 'cx_act_';
const TOKEN_ID_LEN = 8;
const SECRET_BYTES = 32;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h（用户拍板口径）
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 统一错误消息（防枚举）：格式非法 / 令牌不存在 / 已使用 / 已过期 / secret 不符 / 账号不可用
 * 一律回同一句，未认证调用方无法借错误差异探测令牌或账号状态。
 */
const UNIFIED_INVALID_MESSAGE = '激活令牌无效或已过期';

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

/** 解析 raw token 为 {tokenId, secret}；任何形态异常返回 null（不泄漏原因） */
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

export interface CreatedActivationToken {
  /** 明文令牌（仅此次返回，之后无法再取回；禁入日志/审计） */
  plaintext: string;
  tokenId: string;
  username: string;
  expiresAt: Date;
}

/**
 * 为指定账号签发激活令牌（管理员链路）。
 * 重发即取代：先作废该账号旧的未使用令牌，保证同一账号同时只有一张有效令牌。
 */
export async function createActivationToken(input: {
  userId: string;
  username: string;
  createdBy: string;
}): Promise<CreatedActivationToken> {
  const tokenId = encodeCrockfordBase32(crypto.randomBytes(8), TOKEN_ID_LEN);
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const tokenHash = await bcrypt.hash(secret, authConfig.bcryptSaltRounds);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);

  await deleteUnusedTokensForUser(input.userId);
  await insertActivationToken({
    token_id: tokenId,
    token_hash: tokenHash,
    user_id: input.userId,
    username: input.username,
    created_by: input.createdBy,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    used_at: null,
  });

  return {
    plaintext: `${TOKEN_PREFIX}${tokenId}.${secret}`,
    tokenId,
    username: input.username,
    expiresAt,
  };
}

/**
 * 消费激活令牌并为账号自设密码（未认证链路，/api/auth/activate）。
 *
 * 顺序：令牌校验（统一错误）→ 账号可用性（统一错误）→ 密码策略（具体错误，令牌未烧）
 *       → 一次性占用 → 写密码（置 password_changed_at）；写库失败回滚占用，令牌可重试。
 * @returns 激活成功的 username（审计用；响应体不回传敏感信息）
 */
export async function activateWithToken(rawToken: string, newPassword: string): Promise<string> {
  const parts = splitRawToken(rawToken);
  if (!parts) {
    throw new AppError(400, UNIFIED_INVALID_MESSAGE);
  }
  const { tokenId, secret } = parts;

  const record = await getActivationTokenById(tokenId);
  if (!record || record.used_at !== null) {
    throw new AppError(400, UNIFIED_INVALID_MESSAGE);
  }
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    throw new AppError(400, UNIFIED_INVALID_MESSAGE);
  }
  const secretOk = await bcrypt.compare(secret, record.token_hash);
  if (!secretOk) {
    throw new AppError(400, UNIFIED_INVALID_MESSAGE);
  }

  const user = await getUserById(record.user_id);
  if (!user || !user.active || user.username !== record.username) {
    throw new AppError(400, UNIFIED_INVALID_MESSAGE);
  }

  // 策略校验放在令牌占用之前：弱密码被拒时令牌不烧，用户换个密码可直接重试
  const normalizedNew = newPassword.normalize('NFKC').trim();
  const policyViolation = validatePasswordPolicy(normalizedNew, { username: user.username });
  if (policyViolation) {
    throw new AppError(400, policyViolation);
  }

  const claimed = await markActivationTokenUsed(tokenId, new Date().toISOString());
  if (!claimed) {
    throw new AppError(400, UNIFIED_INVALID_MESSAGE);
  }

  try {
    const newHash = await bcrypt.hash(normalizedNew, authConfig.bcryptSaltRounds);
    await setUserPasswordByUsername(user.username, newHash);
  } catch (err) {
    // 写库失败：回滚占用，令牌保持可用（否则用户白白烧掉令牌还没设上密码）
    await unmarkActivationTokenUsed(tokenId).catch(() => {});
    throw err;
  }

  return user.username;
}
