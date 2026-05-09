/**
 * HTML 报告托管路由
 * Reports HTML Hosting Route
 *
 * GET /api/reports/:filename — 鉴权后返回 server/data/reports/<filename>.html
 * （前缀 /api/reports 是为了避开前端 SPA 的 /reports 保费达成页路由）
 *
 * 使用场景：
 *   - 数据管理/integrations/wecom_bot/push_html.py 把 HTML 复制到 server/data/reports/
 *     并把链接写到企微智能表格 URL 字段
 *   - 用户在企微 App 点击链接 → 浏览器打开 → JWT cookie 自动带 → 鉴权通过 → 渲染 HTML
 *
 * 安全：
 *   - authMiddleware（拒绝未登录）
 *   - sanitizeFilename（拒绝路径遍历/特殊字符）
 *   - validatePathWithinDirectory（拒绝符号链接逃逸）
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import {
  sanitizeFilename,
  validatePathWithinDirectory,
} from '../utils/security.js';
import { getReportsDir } from '../config/paths.js';

const router = Router();

const REPORTS_DIR = getReportsDir();
const REPORT_HTML_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "sandbox allow-popups allow-popups-to-escape-sandbox",
].join('; ');

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

router.get(
  '/:filename',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const safe = sanitizeFilename(req.params.filename);

    if (!/\.html?$/i.test(safe)) {
      throw new AppError(400, '仅支持 .html / .htm 文件');
    }

    const fullPath = path.join(REPORTS_DIR, safe);
    validatePathWithinDirectory(fullPath, REPORTS_DIR);

    if (!fs.existsSync(fullPath)) {
      throw new AppError(404, '报告不存在或已过期');
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'private, max-age=0, must-revalidate');
    res.set('Content-Security-Policy', REPORT_HTML_CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');

    fs.createReadStream(fullPath).pipe(res);
  })
);

export default router;
