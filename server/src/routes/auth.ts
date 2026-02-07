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

const router = Router();

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

    // 2. 调用认证服务
    const result = await authService.login(username, password);

    // 3. 返回Token和用户信息
    res.json({
      success: true,
      data: result,
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
    const { token } = req.body;

    if (!token) {
      throw new AppError(400, 'Token is required');
    }

    // 刷新Token
    const newToken = authService.refreshToken(token);

    res.json({
      success: true,
      data: {
        token: newToken,
      },
    });
  })
);

export default router;
