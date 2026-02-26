/**
 * JWT 认证中间件
 * JWT Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth.js';
import { AppError } from './error.js';

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
 * 扩展Express Request类型，添加user字段
 */
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * JWT认证中间件
 * 验证请求头中的 Bearer Token
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. 从 Authorization 头或 HttpOnly Cookie 获取 Token
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;
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

    // 2. 验证Token
    const decoded = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;

    // 3. 将用户信息注入到request
    req.user = decoded;

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError(401, 'Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'Token expired'));
    } else {
      next(error);
    }
  }
}

/**
 * 可选认证中间件（用于部分公开的路由）
 * Token存在则验证，不存在则跳过
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const hasBearer = !!(authHeader && authHeader.startsWith('Bearer '));
  const hasCookie = !!req.headers.cookie?.includes('cx_access_token=');
  if (!hasBearer && !hasCookie) {
    // 没有Token，跳过认证
    return next();
  }

  // 有Token，执行验证
  authMiddleware(req, res, next);
}
