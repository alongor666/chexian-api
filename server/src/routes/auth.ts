/**
 * 认证路由
 * Authentication Routes
 *
 * POST /api/auth/login - 用户登录
 * POST /api/auth/refresh - 刷新Token
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { checkAccountLock, recordLoginFailure, resetLoginAttempts } from '../middleware/rateLimiter.js';
import { auditAuthEvent } from '../middleware/audit.js';
import { authConfig } from '../config/auth.js';

const router = Router();

const ACCESS_COOKIE = 'cx_access_token';
const REFRESH_COOKIE = 'cx_refresh_token';

function parseCookieValue(req: Request, key: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const pairs = raw.split(';').map(part => part.trim());
  for (const pair of pairs) {
    if (!pair.startsWith(`${key}=`)) continue;
    return decodeURIComponent(pair.slice(key.length + 1));
  }
  return null;
}

function parseDurationToMs(duration: string | undefined, fallbackMs: number): number {
  if (!duration) return fallbackMs;
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return fallbackMs;
  const value = Number(match[1]);
  const unit = match[2];
  const factors: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (factors[unit] || 1000);
}

function setSessionCookies(res: Response, accessToken: string, refreshToken: string): void {
  const secure = process.env.NODE_ENV === 'production';
  const accessMaxAge = parseDurationToMs(authConfig.jwtExpiresIn, 4 * 60 * 60 * 1000);
  const refreshMaxAge = parseDurationToMs(authConfig.jwtRefreshExpiresIn, 7 * 24 * 60 * 60 * 1000);

  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: accessMaxAge,
    path: '/',
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: refreshMaxAge,
    path: '/',
  });
}

function clearSessionCookies(res: Response): void {
  const secure = process.env.NODE_ENV === 'production';
  const clearOptions = {
    httpOnly: true as const,
    secure,
    sameSite: 'lax' as const,
    path: '/',
  };
  res.clearCookie(ACCESS_COOKIE, clearOptions);
  res.clearCookie(REFRESH_COOKIE, clearOptions);
}

/**
 * 登录请求验证Schema
 */
const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /api/auth/login
 * 用户登录，返回JWT Token
 */
router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    // 1. 验证请求体
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { username, password } = parseResult.data;

    // 2. 检查 IP + 用户名双键锁定状态
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    checkAccountLock(clientIp, username);

    // 3. 调用认证服务
    let result;
    try {
      result = await authService.login(username, password, clientIp);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 403 && err.message === 'IP not allowed') {
        auditAuthEvent({ event: 'login_ip_denied', username, ip: clientIp });
        throw err;
      }
      recordLoginFailure(clientIp, username);
      auditAuthEvent({ event: 'login_failure', username, ip: clientIp });
      throw err;
    }

    // 4. 登录成功：重置失败计数（IP + 用户名） + 审计日志
    resetLoginAttempts(clientIp, username);
    auditAuthEvent({
      event: 'login_success',
      username,
      ip: clientIp,
      role: result.user.role,
      organization: result.user.organization,
    });

    // 5. 生成 cookie 会话并回写
    const session = authService.issueCookieSession(result.user);
    setSessionCookies(res, session.accessToken, session.refreshToken);

    // 6. 返回用户信息（保留 token 字段用于兼容旧链路，但前端不再持久化）
    res.json({
      success: true,
      data: {
        ...result,
        token: session.accessToken,
      },
    });
  })
);

/**
 * POST /api/auth/refresh
 * 刷新JWT Token
 */
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const cookieRefreshToken = parseCookieValue(req, REFRESH_COOKIE);
    const fallbackBodyToken = req.body?.token;
    const refreshToken = cookieRefreshToken || fallbackBodyToken;
    if (!refreshToken) throw new AppError(401, 'Refresh token is required');
    const nextSession = authService.refreshCookieSession(refreshToken);
    setSessionCookies(res, nextSession.accessToken, nextSession.refreshToken);

    res.json({
      success: true,
      data: {
        token: nextSession.accessToken,
      },
    });
  })
);

/**
 * POST /api/auth/logout
 * 注销会话并清理 cookie
 */
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = parseCookieValue(req, REFRESH_COOKIE) || req.body?.token;
    authService.revokeCookieSession(refreshToken);
    clearSessionCookies(res);
    res.json({ success: true, data: { loggedOut: true } });
  })
);

/**
 * GET /api/auth/me
 * 返回当前登录用户（基于 access cookie 或 bearer）
 */
router.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const cookieToken = parseCookieValue(req, ACCESS_COOKIE);
    const accessToken = bearer || cookieToken;
    if (!accessToken) throw new AppError(401, 'No token provided');

    const payload = authService.verifyToken(accessToken);
    res.json({
      success: true,
      data: {
        username: payload.username,
        displayName: payload.username === 'admin' ? '系统管理员' : payload.username,
        role: payload.role,
        organization: payload.organization,
      },
    });
  })
);

export default router;
