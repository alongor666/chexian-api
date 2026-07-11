/**
 * API 限流中间件
 * Rate Limiting Middleware
 *
 * 防止恶意用户高频请求，保护服务器资源
 *
 * 限流策略：
 * - 通用 API: 100 次/分钟
 * - 登录接口: 5 次/分钟（严格）
 * - 查询接口: 200 次/分钟（仪表盘多面板并发）
 */

import { rateLimit } from 'express-rate-limit';
import { AppError } from './error.js';
import { testEnv } from '../config/env.js';

/**
 * 429 响应体：与全局 errorHandler 的统一信封对齐
 * （{ success:false, error:{ message, statusCode } }，见 error.ts /
 * .claude/rules/api-routes.md）。此前 error 是裸字符串，前端 client-core
 * 按 data.error?.message 解析得 undefined，用户只看到兜底文案"请求失败"、
 * 不知道是限流也不知道等多久（BACKLOG 2026-07-03-claude-77f992）。
 * retryAfter 保留在顶层：与 Retry-After 响应头语义一致，CLI 走响应头不受影响。
 */
export function rateLimitBody(message: string, retryAfterSec = 60) {
  return {
    success: false,
    error: { message, statusCode: 429 },
    retryAfter: retryAfterSec,
  };
}

/**
 * 从 Authorization 头嗅探请求是否为 PAT 调用（不依赖 req.pat）。
 *
 * 关键：限流器挂在 `/api`、`/api/query` 等前缀上（app.ts），执行时机在
 * 路由级 authMiddleware **之前**，此刻 req.pat / req.user 尚未注入。若只看
 * req.pat，PAT 调用永远走不进 60/min 加严分支（桶失效）。故这里直接解析
 * header 里的明文 token 前缀判定是否 PAT-shaped。
 *
 * 安全（Codex PR #455 P1）：**绝不**用 token 里攻击者可控的 tokenId 作为限流
 * key——否则未认证客户端轮换 8 位 ID 即可为每个假 ID 各拿 60/min 配额，绕过
 * 按 IP 的基线保护洪泛下游。这里只返回布尔「是否 PAT」，分桶一律按 IP（见
 * keyByPatOrUser）。pre-auth 无法可信识别具体 token，per-token 粒度只能放到
 * authMiddleware 之后（验证后的 req.pat.tokenId 才可信，见 BACKLOG 后续项）。
 *
 * PAT 格式：`cx_pat_<tokenId>.<secret>`，tokenId 为 8 位 [0-9A-Z]
 * （与 personal-access-token.ts splitRawToken 同源）。
 */
const PAT_PREFIX = 'cx_pat_';
const PAT_TOKEN_ID_LEN = 8;

export function isPatShapedAuth(req: {
  headers?: Record<string, unknown>;
  pat?: { tokenId: string };
}): boolean {
  // 快路径：少数挂在 auth 之后的限流器，req.pat 已注入（已验证可信）
  if (req.pat?.tokenId) return true;
  const authHeader = req.headers?.authorization;
  if (typeof authHeader !== 'string') return false;
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token.startsWith(PAT_PREFIX)) return false;
  const tokenId = token.slice(PAT_PREFIX.length, PAT_PREFIX.length + PAT_TOKEN_ID_LEN);
  return /^[0-9A-Z]{8}$/.test(tokenId);
}

/** 请求是否来自 PAT（基于 header 嗅探，供 limit 选择加严上限用） */
function isPatRequest(req: { headers?: Record<string, unknown>; pat?: { tokenId: string } }): boolean {
  return isPatShapedAuth(req);
}

/**
 * 限流 key 生成器（PAT → pat:<ip> 独立桶 → IP+userId → 纯 IP）
 *
 * PAT 调用走独立桶 `pat:<ip>`（与 IP+userId、纯 IP 不混淆），加严上限 60/min
 * 只作用于 PAT 调用方，不影响浏览器/JWT 用户。
 *
 * 安全（Codex PR #455 P1）：PAT 桶按 **IP** 分，而非按 token 里攻击者可控的
 * tokenId——否则未认证客户端轮换 8 位 ID 即可为每个假 ID 各拿 60/min，绕过 IP
 * 基线洪泛。按 IP 分桶后，同一 IP 的所有（真/假）PAT 请求坍缩到一个 60/min 桶。
 */
export function keyByPatOrUser(req: { ip?: string; connection?: any; headers?: Record<string, unknown>; pat?: { tokenId: string }; user?: { userId?: string } }): string {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (isPatShapedAuth(req)) return `pat:${ip}`;
  const userId = req.user?.userId || '';
  return userId ? `${ip}:${userId}` : ip;
}

/** PAT 加严上限：在原有三级基线之外，PAT 调用每分钟最多 60 次 */
const PAT_LIMIT_PER_MIN = 60;

/**
 * 限流 skip 判定（C4 组合策略，通用于所有限流器）
 * 顺序：生产硬拒 → E2E 显式开关 → 本地 localhost 默认跳过
 * 生产环境永远不会走到后两个分支（env.ts 启动时已拦截 E2E_TEST_MODE=1）
 */
function shouldSkipRateLimit(req: { ip?: string }): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (testEnv.E2E_TEST_MODE === '1') return true;
  const ip = req.ip ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

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
  // 三级基线 100/min 保持不变；PAT 调用单独加严到 60/min
  limit: (req) => (isPatRequest(req as any) ? PAT_LIMIT_PER_MIN : 100),
  message: rateLimitBody('请求过于频繁，请 1 分钟后再试'),
  standardHeaders: true,
  legacyHeaders: false,
  // 跳过健康检查 + C4 组合策略（生产硬拒 + E2E 显式开关 + 本地 localhost 默认跳过）
  skip: (req) => req.path === '/health' || shouldSkipRateLimit(req),
  keyGenerator: (req) => keyByPatOrUser(req as any),
});

/**
 * 登录接口限流器（严格）
 * 5 次/分钟
 */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟
  limit: 5,              // 5 次尝试
  message: rateLimitBody('登录尝试次数过多，请 1 分钟后再试'),
  standardHeaders: true,
  legacyHeaders: false,
  // C4 组合策略：生产硬拒 + E2E 显式开关 + 本地 localhost 默认跳过
  skip: shouldSkipRateLimit,
  // 使用 IP 作为键
  keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
  // 登录成功后重置计数（需要配合登录逻辑）
  handler: (req, res) => {
    res.status(429).json(rateLimitBody('登录尝试次数过多，请 1 分钟后再试'));
  },
});

/**
 * 查询接口限流器
 * 200 次/分钟（仪表盘多面板并发加载，单次页面加载即触发 8-10 请求）
 */
export const queryLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟
  // 三级基线 200/min 保持不变；PAT 调用单独加严到 60/min（避免脚本失控）
  limit: (req) => (isPatRequest(req as any) ? PAT_LIMIT_PER_MIN : 200),
  message: rateLimitBody('查询请求过于频繁，请 1 分钟后再试'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipRateLimit,
  keyGenerator: (req) => keyByPatOrUser(req as any),
});

/**
 * 激活令牌消费接口限流器（严格，独立桶）
 * 5 次/分钟 · 按 IP。/api/auth/activate 是未认证端点（持一次性激活令牌设密），
 * 与 login 同级加严防爆破/枚举；不动三级基线（100/5/200 不变，仅新增独立桶）。
 */
export const activateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  message: rateLimitBody('激活尝试次数过多，请 1 分钟后再试'),
  standardHeaders: true,
  legacyHeaders: false,
  // C4 组合策略：生产硬拒 + E2E 显式开关 + 本地 localhost 默认跳过
  skip: shouldSkipRateLimit,
  keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
  handler: (req, res) => {
    res.status(429).json(rateLimitBody('激活尝试次数过多，请 1 分钟后再试'));
  },
});

/**
 * AI 接口限流器（最严格）
 * 10 次/分钟
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟
  max: 10,               // 10 次 AI 调用（最严格）
  message: rateLimitBody('AI 调用次数过多，请 1 分钟后再试'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipRateLimit,
  keyGenerator: (req) => keyByPatOrUser(req as any),
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
    message: rateLimitBody('请求过于频繁，请稍后再试'),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => keyByPatOrUser(req as any),
  });
}

// ============================================
// 账户锁定机制（登录暴力破解防护）
// ============================================

interface LockRecord {
  failCount: number;
  lockedUntil?: number;
  updatedAt: number;
}

const loginAttempts = new Map<string, LockRecord>();
/** 30 分钟未更新的记录自动清理 */
const STALE_RECORD_MS = 30 * 60 * 1000;

/** 定期清理过期/陈旧的 loginAttempts 记录，防止长期运行内存泄漏 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts) {
    const isExpiredLock = record.lockedUntil && now >= record.lockedUntil;
    const isStale = now - record.updatedAt > STALE_RECORD_MS;
    if (isExpiredLock || isStale) loginAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref(); // 5 分钟一次，unref 不阻止进程退出

const LOCK_CONFIG = {
  MAX_ATTEMPTS: 30,                    // 连续失败超过30次触发锁定
  LOCK_DURATION_MS: 2 * 60 * 1000,    // 锁定2分钟
};

/**
 * 内部：检查单个 key 是否锁定
 */
function _checkKeyLock(key: string): void {
  const record = loginAttempts.get(key);
  if (!record) return;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    // 锁定已过期，清理记录
    loginAttempts.delete(key);
    return;
  }
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000 / 60);
    throw new AppError(429, `登录失败次数过多，请 ${remaining} 分钟后再试`);
  }
}

/**
 * 内部：记录单个 key 的失败次数
 */
function _recordKeyFailure(key: string): void {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  // 若已解锁（锁定期已过），重置计数
  if (existing?.lockedUntil && now >= existing.lockedUntil) {
    loginAttempts.set(key, { failCount: 1, updatedAt: now });
    return;
  }
  const base = existing ?? { failCount: 0, updatedAt: now };
  const updated: LockRecord = {
    ...base,
    failCount: base.failCount + 1,
    updatedAt: now,
  };
  if (updated.failCount >= LOCK_CONFIG.MAX_ATTEMPTS) {
    updated.lockedUntil = now + LOCK_CONFIG.LOCK_DURATION_MS;
  }
  loginAttempts.set(key, updated);
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
