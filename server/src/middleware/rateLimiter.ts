/**
 * API 限流中间件
 * Rate Limiting Middleware
 *
 * 防止恶意用户高频请求，保护服务器资源
 *
 * 限流策略：
 * - 通用 API: 100 次/分钟
 * - 登录接口: 5 次/分钟（严格）
 * - 查询接口: 30 次/分钟
 */

import { rateLimit } from 'express-rate-limit';
import { AppError } from './error.js';

// ============================================
// 限流配置
// ============================================

interface RateLimitConfig {
  windowMs: number;      // 时间窗口（毫秒）
  max: number;           // 最大请求数
  message: string;       // 超限提示
  standardHeaders: boolean;
  legacyHeaders: boolean;
}

// 通用限流配置
const defaultConfig: RateLimitConfig = {
  windowMs: 60 * 1000,   // 1 分钟
  max: 100,              // 100 次请求
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
};

// ============================================
// 限流器实例
// ============================================

/**
 * 通用 API 限流器
 * 100 次/分钟
 */
export const apiLimiter = rateLimit({
  windowMs: defaultConfig.windowMs,
  limit: 100,
  message: {
    success: false,
    error: '请求过于频繁，请 1 分钟后再试',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  // 跳过健康检查
  skip: (req) => req.path === '/health',
  // 使用 IP + 用户 ID 作为键（已登录用户更宽松）
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = (req as any).user?.userId || '';
    return userId ? `${ip}:${userId}` : ip;
  },
});

/**
 * 登录接口限流器（严格）
 * 5 次/分钟
 */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟
  limit: 5,              // 5 次尝试
  message: {
    success: false,
    error: '登录尝试次数过多，请 1 分钟后再试',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  // 使用 IP 作为键
  keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
  // 登录成功后重置计数（需要配合登录逻辑）
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: '登录尝试次数过多，请 1 分钟后再试',
      retryAfter: 60,
    });
  },
});

/**
 * 查询接口限流器
 * 30 次/分钟
 */
export const queryLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟
  limit: 30,             // 30 次查询
  message: {
    success: false,
    error: '查询请求过于频繁，请 1 分钟后再试',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = (req as any).user?.userId || '';
    return userId ? `${ip}:${userId}` : ip;
  },
});

/**
 * AI 接口限流器（最严格）
 * 10 次/分钟
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟
  max: 10,               // 10 次 AI 调用
  message: {
    success: false,
    error: 'AI 调用次数过多，请 1 分钟后再试',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = (req as any).user?.userId || '';
    return userId ? `${ip}:${userId}` : ip;
  },
});

// ============================================
// 自定义限流中间件
// ============================================

/**
 * 动态限流（根据用户角色调整）
 */
export function createDynamicLimiter(
  defaultMax: number,
  adminMax: number = defaultMax * 3
) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: (req) => {
      const user = (req as any).user;
      // 管理员享有更高配额
      if (user?.role === 'branch_admin') {
        return adminMax;
      }
      return defaultMax;
    },
    message: {
      success: false,
      error: '请求过于频繁，请稍后再试',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userId = (req as any).user?.userId || '';
      return userId ? `${ip}:${userId}` : ip;
    },
  });
}

// ============================================
// 账户锁定机制（登录暴力破解防护）
// ============================================

interface LockRecord {
  failCount: number;
  lockedUntil?: number;
}

const loginAttempts = new Map<string, LockRecord>();

const LOCK_CONFIG = {
  MAX_ATTEMPTS: 10,                    // 连续失败超过10次触发锁定
  LOCK_DURATION_MS: 15 * 60 * 1000,   // 锁定15分钟
};

/**
 * 内部：检查单个 key 是否锁定
 */
function _checkKeyLock(key: string): void {
  const record = loginAttempts.get(key);
  if (record?.lockedUntil && Date.now() < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000 / 60);
    throw new AppError(429, `登录失败次数过多，请 ${remaining} 分钟后再试`);
  }
}

/**
 * 内部：记录单个 key 的失败次数
 */
function _recordKeyFailure(key: string): void {
  const existing = loginAttempts.get(key);
  // 若已解锁（锁定期已过），重置计数
  if (existing?.lockedUntil && Date.now() >= existing.lockedUntil) {
    loginAttempts.set(key, { failCount: 1 });
    return;
  }
  const record = existing ?? { failCount: 0 };
  record.failCount += 1;
  if (record.failCount >= LOCK_CONFIG.MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_CONFIG.LOCK_DURATION_MS;
  }
  loginAttempts.set(key, record);
}

/**
 * 检查 IP 和用户名双键锁定状态（登录前调用）
 * IP 锁定：同一 IP 高频失败
 * 用户名锁定：同一用户名跨 IP 高频失败
 * 若任一锁定则抛出 AppError(429)
 */
export function checkAccountLock(ip: string, username?: string): void {
  _checkKeyLock(ip);
  if (username) {
    _checkKeyLock(`user:${username}`);
  }
}

/**
 * 记录一次登录失败（登录失败后调用）
 * 同时累计 IP 和用户名两个维度的失败次数
 * 累计达到阈值后锁定对应 key 15 分钟
 */
export function recordLoginFailure(ip: string, username?: string): void {
  _recordKeyFailure(ip);
  if (username) {
    _recordKeyFailure(`user:${username}`);
  }
}

/**
 * 登录成功后重置失败计数（IP 和用户名两个 key）
 */
export function resetLoginAttempts(ip: string, username?: string): void {
  loginAttempts.delete(ip);
  if (username) {
    loginAttempts.delete(`user:${username}`);
  }
}

// ============================================
// 导出
// ============================================

export default {
  apiLimiter,
  loginLimiter,
  queryLimiter,
  aiLimiter,
  createDynamicLimiter,
};
