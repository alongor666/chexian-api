/**
 * 一次性设密令牌服务（全员密码体系改造 · 阶段一激活 + 阶段二找回/重置）
 *
 * 两类用途共用同一套设施（同一持久层，kind 列隔离）：
 *   - activation（阶段一）：管理员为账号签发的一次性激活令牌，前缀 cx_act_
 *   - reset（阶段二）：找回/重置令牌，前缀 cx_rst_——飞书扫码找回（短 TTL，自助）
 *     与管理员一次性重置（24h）两条链路共用
 * 共同语义：
 *   - 令牌格式：<prefix><token_id8>.<secret43>（与 PAT cx_pat_ 前缀区分）
 *   - 服务端只存 bcrypt(secret)，明文仅创建响应返回一次（禁入日志/审计）
 *   - 一次性；同账号同 kind 重发即作废旧的未使用令牌
 *   - 消费端点未认证：按 kind 统一错误消息防枚举 + 独立限流桶
 *   - kind 严格隔离：activation 令牌打不了 reset 端点，反之亦然（前缀 + kind 双重校验）
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
  type PasswordTokenKind,
} from './activation-token-store.js';
import { assertPasswordAllowed } from './credential-policy.js';

export type { PasswordTokenKind };

const TOKEN_ID_LEN = 8;
const SECRET_BYTES = 32;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h（用户拍板口径；飞书找回链路显式传短 TTL）
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 按 kind 的前缀与统一错误消息（防枚举）：格式非法 / 令牌不存在 / 已使用 / 已过期 /
 * secret 不符 / kind 不符 / 账号不可用一律回同一句，未认证调用方无法借错误差异探测状态。
 */
const KIND_CONFIG: Record<PasswordTokenKind, { prefix: string; unifiedMessage: string }> = {
  activation: { prefix: 'cx_act_', unifiedMessage: '激活令牌无效或已过期' },
  reset: { prefix: 'cx_rst_', unifiedMessage: '重置令牌无效或已过期' },
};

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

/** 解析 raw token 为 {tokenId, secret}（按 kind 前缀）；任何形态异常返回 null（不泄漏原因） */
function splitRawToken(raw: string, kind: PasswordTokenKind): { tokenId: string; secret: string } | null {
  const prefix = KIND_CONFIG[kind].prefix;
  if (!raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
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
 * 签发一次性设密令牌（内部通用实现）。
 * 重发即取代：先作废该账号同 kind 旧的未使用令牌，保证同一账号同一用途同时只有一张有效令牌。
 */
async function createPasswordToken(
  input: { userId: string; username: string; createdBy: string; ttlMs?: number },
  kind: PasswordTokenKind
): Promise<CreatedActivationToken> {
  await assertPasswordAllowed(input.userId);
  const tokenId = encodeCrockfordBase32(crypto.randomBytes(8), TOKEN_ID_LEN);
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const tokenHash = await bcrypt.hash(secret, authConfig.bcryptSaltRounds);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));

  await deleteUnusedTokensForUser(input.userId, kind);
  await insertActivationToken({
    token_id: tokenId,
    token_hash: tokenHash,
    user_id: input.userId,
    username: input.username,
    created_by: input.createdBy,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    used_at: null,
    kind,
  });

  return {
    plaintext: `${KIND_CONFIG[kind].prefix}${tokenId}.${secret}`,
    tokenId,
    username: input.username,
    expiresAt,
  };
}

/** 为指定账号签发激活令牌（管理员链路，阶段一，24h） */
export async function createActivationToken(input: {
  userId: string;
  username: string;
  createdBy: string;
}): Promise<CreatedActivationToken> {
  return createPasswordToken(input, 'activation');
}

/**
 * 为指定账号签发找回/重置令牌（阶段二）。
 * 管理员链路默认 24h；飞书扫码找回链路传短 ttlMs（令牌随回调即时消费，无需长有效期）。
 */
export async function createPasswordResetToken(input: {
  userId: string;
  username: string;
  createdBy: string;
  ttlMs?: number;
}): Promise<CreatedActivationToken> {
  return createPasswordToken(input, 'reset');
}

export interface ConsumedPasswordToken {
  /** 设密成功的 username（审计用；响应体不回传敏感信息） */
  username: string;
  /** 签发者（管理员 username / 'feishu-reset'）——找回通知按此区分「飞书找回」vs「管理员重置」 */
  createdBy: string;
  /** 令牌 ID（非明文，可入审计） */
  tokenId: string;
}

/**
 * 消费一次性设密令牌并为账号写入新密码（内部通用实现，未认证链路）。
 *
 * 顺序：令牌校验（统一错误，含 kind 隔离）→ 账号可用性（统一错误）→
 *       密码策略（具体错误，令牌未烧）→ 一次性占用 → 写密码（置 password_changed_at）；
 *       写库失败回滚占用，令牌可重试。
 */
async function consumeTokenAndSetPassword(
  rawToken: string,
  newPassword: string,
  kind: PasswordTokenKind
): Promise<ConsumedPasswordToken> {
  const unified = KIND_CONFIG[kind].unifiedMessage;
  const parts = splitRawToken(rawToken, kind);
  if (!parts) {
    throw new AppError(400, unified);
  }
  const { tokenId, secret } = parts;

  const record = await getActivationTokenById(tokenId);
  if (!record || record.used_at !== null) {
    throw new AppError(400, unified);
  }
  // kind 隔离（前缀之外的第二道闸）：activation 令牌打不了 reset 端点，反之亦然
  if (record.kind !== kind) {
    throw new AppError(400, unified);
  }
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    throw new AppError(400, unified);
  }
  const secretOk = await bcrypt.compare(secret, record.token_hash);
  if (!secretOk) {
    throw new AppError(400, unified);
  }

  const user = await getUserById(record.user_id);
  if (!user || !user.active || user.username !== record.username) {
    throw new AppError(400, unified);
  }
  await assertPasswordAllowed(user.id);

  // 策略校验放在令牌占用之前：弱密码被拒时令牌不烧，用户换个密码可直接重试
  const normalizedNew = newPassword.normalize('NFKC').trim();
  const policyViolation = validatePasswordPolicy(normalizedNew, { username: user.username });
  if (policyViolation) {
    throw new AppError(400, policyViolation);
  }

  const claimed = await markActivationTokenUsed(tokenId, new Date().toISOString());
  if (!claimed) {
    throw new AppError(400, unified);
  }

  try {
    const newHash = await bcrypt.hash(normalizedNew, authConfig.bcryptSaltRounds);
    await setUserPasswordByUsername(user.username, newHash);
  } catch (err) {
    // 写库失败：回滚占用，令牌保持可用（否则用户白白烧掉令牌还没设上密码）
    await unmarkActivationTokenUsed(tokenId).catch(() => {});
    throw err;
  }

  return { username: user.username, createdBy: record.created_by, tokenId };
}

/**
 * 消费激活令牌并为账号自设密码（未认证链路，/api/auth/activate）。
 * @returns 激活成功的 username（保持阶段一签名不变）
 */
export async function activateWithToken(rawToken: string, newPassword: string): Promise<string> {
  const consumed = await consumeTokenAndSetPassword(rawToken, newPassword, 'activation');
  return consumed.username;
}

/**
 * 消费找回/重置令牌并为账号写入新密码（未认证链路，/api/auth/reset-password）。
 * 成功即置 password_changed_at（新密码立即生效为长期密码，旧密码/临时凭据全部失效）。
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string
): Promise<ConsumedPasswordToken> {
  return consumeTokenAndSetPassword(rawToken, newPassword, 'reset');
}
