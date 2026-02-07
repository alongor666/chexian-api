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
    // 1. 从Authorization头获取Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'No token provided');
    }

    const token = authHeader.split(' ')[1];

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

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // 没有Token，跳过认证
    return next();
  }

  // 有Token，执行验证
  authMiddleware(req, res, next);
}
