/**
 * PAT 只读约束中间件
 *
 * 关键不变量（红线，禁止任何路由级配置覆盖）：
 *   PAT 调用方仅允许 GET。任何非 GET 请求若来自 PAT，必须 403。
 *
 * 挂载顺序：authMiddleware → readonlyMiddleware → 业务中间件
 * 必须挂在 router 级别（router.use），不可只挂在个别路由上。
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';

export function readonlyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.pat && req.method !== 'GET' && req.method !== 'HEAD') {
    return next(new AppError(403, 'PAT is read-only. Use a session token for write operations.'));
  }
  next();
}
