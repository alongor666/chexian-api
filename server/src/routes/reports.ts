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
import { UserRole } from '../middleware/permission.js';
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
 * B328：报告托管的行级安全（org 归属校验）。
 *
 * 历史漏洞：两个 GET handler 仅挂 authMiddleware，无 permissionMiddleware / 归属校验 →
 * 任意已登录用户（含三级机构 org_user）可凭文件名/reportId 读取**跨机构** HTML 诊断报告
 * （含保费/赔付/出险敏感数据），违反 §10 行级安全。
 *
 * 现有报告以「业务名+hash」单文件 / 「{reportId}/{snapshot}/...」多文件平铺存储，
 * 路径不含机构归属信息。在生产方（diagnose-* skills / push_html.py）补齐机构归属约定之前，
 * 本校验对非 branch_admin **fail-closed**，彻底封堵跨机构越权读取。
 *
 * @param ownerOrg 报告归属机构（org_level_3）；null = 无法判定归属
 *                 （跨机构聚合报告 / 未带归属约定的平铺报告）→ 仅 branch_admin 可读
 */
export function assertReportAccess(req: Request, ownerOrg: string | null): void {
  const role = req.user?.role as UserRole | undefined;
  // branch_admin（分公司管理员）：放行全部报告
  if (role === UserRole.BRANCH_ADMIN) return;
  // org_user（三级机构用户）：仅放行归属本机构的报告，跨机构 → 403
  if (role === UserRole.ORG_USER) {
    if (ownerOrg !== null && ownerOrg === req.user?.organization) return;
    throw new AppError(403, '无权访问其他机构的报告');
  }
  // telemarketing_user / 未知角色：报告为机构级敏感数据，fail-closed 403
  throw new AppError(403, '无权访问报告');
}

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

export function isValidSnapshotDate(snapshot: string): boolean {
  const match = snapshot.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const normalized = new Date(Date.UTC(year, month - 1, day));
  return (
    normalized.getUTCFullYear() === year &&
    normalized.getUTCMonth() === month - 1 &&
    normalized.getUTCDate() === day
  );
}

function validateSnapshotName(snapshot: string): void {
  // 仅允许真实存在的 YYYY-MM-DD 日期（与项目 cutoff 数据日期对齐）
  if (!isValidSnapshotDate(snapshot)) {
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
  // 允许同源 iframe：多视图报告用一个壳页（含顶部 Tab）内嵌同源的驾驶舱/叙事/超表子报告，
  // 实现「一个链接、登录一次、页面内切换」。frame-src 不写则回落 default-src 'none' 会拦截 iframe。
  "frame-src 'self'",
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

    // B328：归属校验前置（先于白名单），避免低权限用户用 404/403 差异枚举有效 reportId。
    // 多文件白名单报告（diagnose-loss-development）为跨机构聚合报告，无单一机构归属
    // → ownerOrg=null → 仅 branch_admin 可读
    assertReportAccess(req, null);

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
    // B328：归属校验前置。单文件报告平铺存储（业务名+hash），文件名不含机构归属
    // → ownerOrg=null → 仅 branch_admin 可读（生产方补齐归属约定前 fail-closed，封堵跨机构越权）
    assertReportAccess(req, null);

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
