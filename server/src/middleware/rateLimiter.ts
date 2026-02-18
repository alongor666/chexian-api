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
// 导出
// ============================================

export default {
  apiLimiter,
  loginLimiter,
  queryLimiter,
  aiLimiter,
  createDynamicLimiter,
};
