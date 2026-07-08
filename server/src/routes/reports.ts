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
 * 安全（行级安全 B328）：
 *   - authMiddleware（拒绝未登录）
 *   - assertReportRoleAllowed（粗闸：仅 branch_admin/org_user，前置防枚举）
 *   - sanitizeFilename / validateReportSubPath（拒绝路径遍历/特殊字符）
 *   - validatePathWithinDirectory（拒绝符号链接逃逸）
 *   - report_id 白名单 + snapshot 日期格式校验
 *   - resolveReportOwner + assertReportAccess（org 归属校验：org_user 仅读本机构报告，跨机构 fail-closed）
 *   - normalizeReportError（org_user 枚举防护：非 403 的 4xx 统一收敛为 403）
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
import { dbEnv } from '../config/env.js';

const router = Router();

const REPORTS_DIR = getReportsDir();

// 多文件报告的 report_id 白名单（v2.1+）
// 新增报告类型时只需在此追加；目录布局：REPORTS_DIR/{reportId}/{snapshot}/...
const ALLOWED_REPORT_IDS = new Set<string>([
  'diagnose-loss-development',
]);

/**
 * 报告的机构归属（行级安全的可信归属源）。
 * 由生产方在报告旁写入 sidecar JSON（约定见 resolveReportOwner），handler 侧只信最小 schema。
 */
export interface ReportOwner {
  /** 归属机构（org_level_3，与 org_user.organization 严格等值匹配） */
  org: string;
  /** 归属分公司（branch_code，多分公司租户判别；null = sidecar 未声明） */
  branch: string | null;
}

/** 仅当 BRANCH_RLS_ENABLED === 'true' 时返回 true（与 permission.ts 同一 env 语义）。 */
function isBranchRlsEnabled(): boolean {
  return dbEnv.BRANCH_RLS_ENABLED === 'true';
}

/**
 * B328：报告托管的行级安全（org 归属校验·细粒度）。
 *
 * 历史漏洞（phase-1 已堵）：两个 GET handler 仅挂 authMiddleware，无归属校验 →
 * 任意已登录用户可凭文件名/reportId 读取**跨机构** HTML 诊断报告（含保费/赔付/出险敏感数据）。
 *
 * phase-2（本次）：在 phase-1 fail-closed 基础上，放行 org_user 读**归属本机构**的报告。
 * - branch_admin（分公司管理员）：放行全部报告（phase-1 行为不变）
 * - org_user（三级机构用户）：仅放行归属本机构（org_level_3 等值）且 branch 不冲突的报告，否则 403
 * - 其他角色（telemarketing / 未知 / 未认证）：报告为机构级敏感数据，fail-closed 403
 *
 * branch 语义（精确 mirror permission.ts 多分公司 RLS）：
 * - RLS 开启：branch_code 是租户判别，必须 sidecar 声明 ownerBranch 且 === user.branchCode，
 *   任一缺失 → fail-closed 403（同名 org_level_3 可能跨分公司，漏写 ownerBranch 不得放行）
 * - RLS 关闭（单租户兼容期）：退回 org 等值；防御纵深——双方都声明 branch 且不等仍拒
 *
 * @param owner 报告归属（resolveReportOwner 解析自 sidecar）；null = 无法判定归属 → org_user fail-closed
 */
export function assertReportAccess(req: Request, owner: ReportOwner | null): void {
  const role = req.user?.role as UserRole | undefined;
  // branch_admin（分公司管理员）：放行全部报告
  if (role === UserRole.BRANCH_ADMIN) return;
  // org_user（三级机构用户）：仅放行归属本机构的报告
  if (role === UserRole.ORG_USER) {
    const userOrg = req.user?.organization;
    const userBranch = req.user?.branchCode;
    if (owner && userOrg && owner.org === userOrg) {
      if (isBranchRlsEnabled()) {
        // RLS 开启：branch_code 是省份/租户判别（同名 org_level_3 可能跨分公司存在）。
        // 必须 sidecar 声明 ownerBranch 且与 user.branchCode 严格相等，任一缺失即 fail-closed
        // （防 sidecar 漏写 ownerBranch 导致 SC 用户读 SX 同名机构报告 —— codex 闸-2 P1）。
        if (owner.branch && userBranch && owner.branch === userBranch) return;
        throw new AppError(403, '无权访问其他机构的报告');
      }
      // RLS 关闭（单租户兼容期）：退回 org 等值；防御纵深——双方都声明 branch 且不等仍拒
      if (owner.branch && userBranch && owner.branch !== userBranch) {
        throw new AppError(403, '无权访问其他机构的报告');
      }
      return;
    }
    throw new AppError(403, '无权访问其他机构的报告');
  }
  // telemarketing_user / 未知角色 / 未认证：fail-closed 403
  throw new AppError(403, '无权访问报告');
}

/**
 * 粗粒度角色闸：仅 branch_admin / org_user 可访问报告路由；其余角色（含未认证）fail-closed 403。
 * 必须置于路径/白名单/快照解析**之前**调用，避免低权限角色借 404/400 差异枚举报告类型 / 快照日期
 * （保留 phase-1 「归属校验前置」的枚举防护语义）。
 */
export function assertReportRoleAllowed(req: Request): void {
  const role = req.user?.role as UserRole | undefined;
  if (role === UserRole.BRANCH_ADMIN || role === UserRole.ORG_USER) return;
  throw new AppError(403, '无权访问报告');
}

/**
 * org_user 枚举防护归一：把 org_user 遇到的**所有 4xx**（坏路径 400 / 不存在 404 / 跨机构·无归属 403）
 * 统一收敛为同一条 403（同状态码 + 同消息），使「不存在 / 跨机构存在 / 坏归属 / 无归属」对 org_user
 * 完全不可区分（消除跨机构存在性侧信道 —— codex 闸-2 P2；与 phase-1「org_user 恒 403」一致）。
 * branch_admin 保留精确错误码（400/404），便于其排障（其本就放行全部，无枚举收益）。
 */
export function normalizeReportError(req: Request, err: unknown): unknown {
  if (
    req.user?.role === UserRole.ORG_USER &&
    err instanceof AppError &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    return new AppError(403, '无权访问报告');
  }
  return err;
}

/**
 * 解析报告的机构归属（org_level_3 + branch_code），来源是报告旁的 sidecar JSON。
 *
 * 约定（⚠ 生产方 diagnose-* skills / push_html.py 待补齐 emit —— 见 BACKLOG 缺口登记）：
 *   - 单文件 foo.html              → 旁路 foo.html.meta.json
 *   - 多文件 {reportId}/{snapshot}/ → {reportId}/{snapshot}/.report-meta.json
 *   - 内容：{ "ownerOrg": "<org_level_3>", "ownerBranch": "<branch_code, 可选>" }
 *
 * 安全（只信最小 schema，不做模糊匹配 / 不从文件名反推机构）：
 *   - metaPath 必须从已校验的报告路径派生，并再次 validatePathWithinDirectory（防符号链接 / 拼接逃逸）
 *   - ownerOrg 必须非空 string，否则 → null
 *   - ownerBranch 若声明必须匹配 ^[A-Z]{2}$，否则整体 → null（fail-closed，坏 schema 不放行）
 *   - 文件缺失 / 读失败 / JSON 解析失败 → null
 * 返回 null 时 org_user fail-closed（读不到）；生产方未补 sidecar 前不回归 phase-1 行为。
 */
export function resolveReportOwner(metaPath: string, baseDir: string): ReportOwner | null {
  try {
    validatePathWithinDirectory(metaPath, baseDir);
    if (!fs.existsSync(metaPath)) return null;
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;

    const orgRaw = record.ownerOrg;
    const org = typeof orgRaw === 'string' ? orgRaw.trim() : '';
    if (!org) return null;

    let branch: string | null = null;
    if (record.ownerBranch !== undefined && record.ownerBranch !== null) {
      if (typeof record.ownerBranch === 'string' && /^[A-Z]{2}$/.test(record.ownerBranch)) {
        branch = record.ownerBranch;
      } else {
        return null; // 声明了 branch 但 schema 非法 → fail-closed
      }
    }
    return { org, branch };
  } catch {
    return null; // 路径逃逸 / 读失败 / JSON 错误 → fail-closed
  }
}

/**
 * B346：Nginx 静态托管 `/reports/*` 的机构级授权（auth_request 细闸）。
 *
 * 背景（本次治理的根因）：B336 只把静态 /reports/* 的 auth_request 接到「登录态」校验，
 * 任何已登录用户（含 org_user / telemarketing）都能读**全省**诊断报告
 * （如 /reports/diagnose-period-trend/<cutoff>-dashboard.html，含全部二三级机构的
 * 保费/赔付/出险敏感数据）——报告没有随用户所属机构而不同。
 *
 * 路径约定（授权粒度的唯一依据，生成端/manifest/前端共同遵守）：
 *   - 省级全量报告：/reports/<slug>/<file>                        → 仅 branch_admin
 *   - 机构级报告：  /reports/<slug>/orgs/<branch>/<org>/<file>    → org 归属校验
 *     （owner = { org: <org>, branch: <branch> }，语义与 sidecar 版 assertReportAccess 完全一致）
 *
 * fail-closed：URI 缺失/解码失败/含遍历或残留编码/branch 段非法 → 一律按「省级」处理
 * （org_user 403，branch_admin 放行——branch_admin 本就全放行，不构成放大）。
 *
 * @param originalUri Nginx auth_request 透传的 X-Original-URI（$request_uri，含 query、未解码）
 */
export function assertStaticReportAccess(req: Request, originalUri: string): void {
  // 粗粒度角色闸先行（与 /api/reports 两个 handler 同序：先拒 telemarketing/未知角色，防枚举）
  assertReportRoleAllowed(req);
  // branch_admin 全放行（与 assertReportAccess 一致），无需解析路径
  if ((req.user?.role as UserRole | undefined) === UserRole.BRANCH_ADMIN) return;

  const owner = parseStaticReportOwner(originalUri);
  // org_user：owner=null（省级/坏路径）fail-closed 403；机构路径走既有归属矩阵
  assertReportAccess(req, owner);
}

/**
 * 判定 X-Original-URI 是否应执行静态报告授权策略（/me 过渡强化用）。
 * - 单次解码 + 多重斜杠归一后以 /reports/ 开头 → true（percent-encoding / `//reports`
 *   变体无法绕过：Nginx location 按解码归一后的 $uri 匹配，这里对齐同一语义）
 * - 解码失败 → true（fail-closed，交给 assertStaticReportAccess 按坏路径拒绝）
 */
export function shouldEnforceStaticReportPolicy(originalUri: string): boolean {
  if (!originalUri || typeof originalUri !== 'string') return false;
  const pathOnly = originalUri.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return true; // 非法编码 → 按报告策略 fail-closed 处理
  }
  return decoded.replace(/\/{2,}/g, '/').startsWith('/reports/');
}

/**
 * 从静态报告 URI 解析机构归属。仅识别 /reports/<slug>/orgs/<branch>/<org>/... 形态；
 * 其余（省级文件 / manifest.json / 坏路径 / 解码失败 / 遍历字符）一律返回 null（fail-closed）。
 *
 * 解码语义对齐 Nginx：$request_uri 是原始未解码 URI，Nginx 伺服前对 $uri 做**单次**解码 +
 * 路径归一。这里同样单次 decodeURIComponent；解码后若仍残留 %2e/%2f/%5c 编码（双重编码
 * 探测）或包含 `..`/`\`/null byte → null。
 */
export function parseStaticReportOwner(originalUri: string): ReportOwner | null {
  if (!originalUri || typeof originalUri !== 'string') return null;
  // 去 query / fragment（$request_uri 带 query）
  const pathOnly = originalUri.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return null; // 非法编码 → fail-closed
  }
  // 归一多重斜杠（Nginx merge_slashes 语义），去 null byte
  decoded = decoded.replace(/\/{2,}/g, '/').replace(/\x00/g, '');
  if (
    decoded.includes('..') ||
    decoded.includes('\\') ||
    /%2e|%2f|%5c/i.test(decoded) // 双重编码残留
  ) {
    return null;
  }
  if (!decoded.startsWith('/reports/')) return null;

  // 形态：/reports/<slug>/orgs/<branch>/<org>/<file...>（file 至少一段）
  const segments = decoded.split('/').filter((s) => s.length > 0);
  // segments[0]='reports'，机构路径至少 6 段：reports/<slug>/orgs/<branch>/<org>/<file>
  if (segments.length < 6 || segments[2] !== 'orgs') return null;
  const branch = segments[3];
  const org = segments[4].trim();
  // branch 段 schema 与 sidecar ownerBranch 同：^[A-Z]{2}$，非法即 fail-closed
  if (!/^[A-Z]{2}$/.test(branch)) return null;
  if (!org) return null;
  return { org, branch };
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
    // B328 phase-2：粗粒度角色闸前置（先于白名单/路径解析），保留枚举防护
    assertReportRoleAllowed(req);

    try {
      const { reportId, snapshot } = req.params;
      const relativePath = (req.params as Record<string, string>)[0] || '';

      if (!ALLOWED_REPORT_IDS.has(reportId)) {
        throw new AppError(404, '报告类型不存在');
      }
      validateSnapshotName(snapshot);
      const safeRel = validateReportSubPath(relativePath);

      const baseDir = path.join(REPORTS_DIR, reportId, snapshot);
      // baseDir 本身必须真实落在 REPORTS_DIR 内（防中间目录 symlink 逃逸 —— codex 闸-2 P1）
      validatePathWithinDirectory(baseDir, REPORTS_DIR);
      const fullPath = path.join(baseDir, safeRel);
      validatePathWithinDirectory(fullPath, baseDir);

      // 归属解析（sidecar 在 snapshot 目录下）+ 细粒度授权。
      // 现有白名单报告 diagnose-loss-development 为跨机构聚合，无 sidecar → owner=null → 仅 branch_admin。
      const owner = resolveReportOwner(path.join(baseDir, '.report-meta.json'), baseDir);
      assertReportAccess(req, owner);

      // serveReportFile 的 404 纳入 try：org_user 经归一也变 403（防存在性枚举），branch_admin 保留精确 404
      serveReportFile(res, fullPath);
    } catch (err) {
      throw normalizeReportError(req, err); // org_user：所有 4xx → 统一 403（防枚举）
    }
  })
);

// 单文件报告（v1）：兼容已有推送链路（push_html.py 写入到 REPORTS_DIR 根目录）
router.get(
  '/:filename',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    // B328 phase-2：粗粒度角色闸前置，保留枚举防护
    assertReportRoleAllowed(req);

    try {
      const safe = sanitizeFilename(req.params.filename);

      if (!/\.html?$/i.test(safe)) {
        throw new AppError(400, '仅支持 .html / .htm 文件');
      }

      const fullPath = path.join(REPORTS_DIR, safe);
      validatePathWithinDirectory(fullPath, REPORTS_DIR);

      // 归属解析（单文件 sidecar = <报告路径>.meta.json）+ 细粒度授权。
      // 生产方补齐 sidecar 前，平铺报告无归属 → owner=null → org_user fail-closed（不回归 phase-1）。
      const owner = resolveReportOwner(`${fullPath}.meta.json`, REPORTS_DIR);
      assertReportAccess(req, owner);

      // serveReportFile 的 404 纳入 try：org_user 经归一也变 403（防存在性枚举），branch_admin 保留精确 404
      serveReportFile(res, fullPath);
    } catch (err) {
      throw normalizeReportError(req, err); // org_user：所有 4xx → 统一 403（防枚举）
    }
  })
);

export default router;
