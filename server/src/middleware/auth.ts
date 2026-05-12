/**
 * JWT + PAT 认证中间件
 * Authentication Middleware
 *
 * 支持三种来源：
 *   1) Bearer JWT      → jwt.verify
 *   2) Bearer PAT      → cx_pat_ 前缀，走 verifyPat
 *   3) Cookie JWT      → cx_access_token，浏览器会话
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth.js';
import { AppError } from './error.js';
import { verifyPat } from '../services/personal-access-token.js';

/**
 * JWT Payload 类型
 */
export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  organization?: string;
}

/**
 * Express Request 扩展
 *  - user: 认证后的身份（JWT 或 PAT 注入）
 *  - pat:  仅当来源是 PAT 时存在；readonlyMiddleware 依赖此字段
 */
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      pat?: { tokenId: string; name: string };
    }
  }
}

const PAT_PREFIX = 'cx_pat_';

/**
 * 主认证中间件。
 * 异步（PAT 校验涉及 DB + bcrypt），错误一律走 next(err) 由 errorHandler 统一处理。
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    // 1) PAT 优先于 JWT：识别前缀
    if (bearerToken && bearerToken.startsWith(PAT_PREFIX)) {
      const clientIp = req.ip || req.socket.remoteAddress || undefined;
      const verified = await verifyPat(bearerToken, clientIp);
      req.user = {
        userId: verified.user.id,
        username: verified.user.username,
        role: verified.user.role,
        organization: verified.user.organization,
      };
      req.pat = { tokenId: verified.tokenId, name: verified.name };
      return next();
    }

    // 2) Cookie token（浏览器会话）
    const cookieToken = (() => {
      const raw = req.headers.cookie;
      if (!raw) return null;
      const pairs = raw.split(';').map(part => part.trim());
      for (const pair of pairs) {
        if (pair.startsWith('cx_access_token=')) {
          return decodeURIComponent(pair.slice('cx_access_token='.length));
        }
      }
      return null;
    })();

    const token = bearerToken || cookieToken;
    if (!token) {
      throw new AppError(401, 'No token provided');
    }

    // 3) JWT 校验
    const decoded = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'Token expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError(401, 'Invalid token'));
    } else {
      next(error);
    }
  }
}

/**
 * 可选认证中间件（用于部分公开的路由）
 * Token 存在则验证，不存在则跳过
 */
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const hasBearer = !!(authHeader && authHeader.startsWith('Bearer '));
  const hasCookie = !!req.headers.cookie?.includes('cx_access_token=');
  if (!hasBearer && !hasCookie) {
    return next();
  }
  await authMiddleware(req, res, next);
}
