/**
 * HTML 报告托管路由
 * Reports HTML Hosting Route
 *
 * GET /api/reports/:filename                          — 单文件报告（兼容旧推送链路）
 * GET /api/reports/:reportId/:snapshot/*              — 多文件报告（v2.1 下钻页等目录树）
 * （前缀 /api/reports 是为了避开前端 SPA 的 /reports 保费达成页路由）
 *
 * 使用场景：
 *   - 数据管理/integrations/wecom_bot/push_html.py 把单 HTML 复制到 server/data/reports/
 *   - diagnose-loss-development skill 把整个 v2.1 输出目录复制到
 *     server/data/reports/{reportId}/{snapshot}/{preview-mvp,drill/...}.html
 *   - 用户在企微 App 点击链接 → 浏览器打开 → JWT cookie 自动带 → 鉴权通过 → 渲染 HTML
 *
 * 安全：
 *   - authMiddleware（拒绝未登录）
 *   - sanitizeFilename / validateReportSubPath（拒绝路径遍历/特殊字符）
 *   - validatePathWithinDirectory（拒绝符号链接逃逸）
 *   - report_id 白名单 + snapshot 日期格式校验
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

// 多文件报告的 report_id 白名单（v2.1+）
// 新增报告类型时只需在此追加；目录布局：REPORTS_DIR/{reportId}/{snapshot}/...
const ALLOWED_REPORT_IDS = new Set<string>([
  'diagnose-loss-development',
]);

/**
 * 校验多文件报告的相对子路径（不能用 sanitizeFilename，因为它拒绝 `/`）
 * - 解码 URL 编码 + 去 null byte
 * - 拒绝 `..` `\` 和绝对路径前缀
 * - 仅允许 .html / .htm 后缀
 * - 长度限制 200
 */
function validateReportSubPath(relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new AppError(400, '路径不能为空');
  }
  let decoded = relPath;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    // ignore decode failures, fall through to validators below
  }
  decoded = decoded.replace(/\x00/g, '');

  if (decoded.length > 200) {
    throw new AppError(400, '路径过长');
  }
  if (decoded.includes('..') || decoded.includes('\\')) {
    throw new AppError(400, '路径包含非法字符');
  }
  if (decoded.startsWith('/')) {
    throw new AppError(400, '禁止绝对路径');
  }
  if (!/\.html?$/i.test(decoded)) {
    throw new AppError(400, '仅支持 .html / .htm 文件');
  }
  return decoded;
}

function validateSnapshotName(snapshot: string): void {
  // 仅允许 YYYY-MM-DD（与项目 cutoff 数据日期对齐）
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot)) {
    throw new AppError(400, '快照名格式应为 YYYY-MM-DD');
  }
}
// CSP：托管的是 magazine-style HTML deck（含内联翻页 JS、ESM 动态 import motion CDN、lucide UMD、Google Fonts）
// 必须放开：内联 script + jsdelivr/unpkg/Google Fonts 白名单。HTML 来源是开发者主动入库的报告，inline-script 可信。
// 移除原 sandbox 指令——它缺 allow-scripts 会无声禁用 JS（导致 deck 只显示首页、无法翻页）。
const REPORT_HTML_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
  "script-src-elem 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function serveReportFile(res: Response, fullPath: string): void {
  if (!fs.existsSync(fullPath)) {
    throw new AppError(404, '报告不存在或已过期');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');
  res.set('Content-Security-Policy', REPORT_HTML_CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  fs.createReadStream(fullPath).pipe(res);
}

// 多文件报告（v2.1+）：GET /api/reports/:reportId/:snapshot/path/to/file.html
// 注意：Express 路由顺序敏感——更具体的多段路径必须在 /:filename 之前注册
router.get(
  '/:reportId/:snapshot/*',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId, snapshot } = req.params;
    const relativePath = (req.params as Record<string, string>)[0] || '';

    if (!ALLOWED_REPORT_IDS.has(reportId)) {
      throw new AppError(404, '报告类型不存在');
    }
    validateSnapshotName(snapshot);
    const safeRel = validateReportSubPath(relativePath);

    const baseDir = path.join(REPORTS_DIR, reportId, snapshot);
    const fullPath = path.join(baseDir, safeRel);
    validatePathWithinDirectory(fullPath, baseDir);

    serveReportFile(res, fullPath);
  })
);

// 单文件报告（v1）：兼容已有推送链路（push_html.py 写入到 REPORTS_DIR 根目录）
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

    serveReportFile(res, fullPath);
  })
);

export default router;
