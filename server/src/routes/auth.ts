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
import { authMiddleware } from '../middleware/auth.js';
import { readonlyMiddleware } from '../middleware/readonly.js';
import {
  requireRole,
  UserRole,
  getManageableBranchScope,
  canManageBranch,
  isValidBranchCode,
  isNationalAdmin,
} from '../middleware/permission.js';
import { checkAccountLock, recordLoginFailure, resetLoginAttempts } from '../middleware/rateLimiter.js';
import { auditAuthEvent } from '../middleware/audit.js';
import { authConfig } from '../config/auth.js';
import {
  listUsers,
  listRoles,
  createUser,
  updateUser,
  deleteUser,
  createRole,
  updateRole,
  deleteRole,
  getUserByUsername,
  getUserById,
  ensurePresetUser,
} from '../services/access-control.js';
import {
  createPat,
  listPatsByUser,
  revokePat,
  type TtlDays,
} from '../services/personal-access-token.js';
import { createActivationToken, activateWithToken } from '../services/activation-token.js';
import { QUERY_ROUTE_METADATA } from '../config/query-routes-metadata.js';
import { assertStaticReportAccess, shouldEnforceStaticReportPolicy } from './reports.js';

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

// branchCode 校验：大写 CHAR(2)（SC/SX…）。可选——多分公司 RLS 下由路由处理器据调用者
// 可管理范围补默认/强校验（见 POST/PUT /users）；RLS 关时保持历史行为（可缺省）。
const branchCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'branchCode 必须为大写 CHAR(2)（如 SC/SX）')
  .optional();

const userCreateSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  displayName: z.string().min(1, 'Display name is required'),
  password: z.string().min(1, 'Password is required'),
  role: z.string().min(1, 'Role is required'),
  organization: z.string().optional(),
  branchCode: branchCodeSchema,
  allowedRoutes: z.array(z.string().min(1)).optional().default([]),
  defaultRoute: z.string().optional(),
  allowedIps: z.array(z.string().min(1)).optional().default([]),
  specialFeatures: z.array(z.string().min(1)).optional().default([]),
  active: z.boolean().optional().default(true),
});

const userUpdateSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  password: z.string().optional(),
  role: z.string().min(1, 'Role is required'),
  organization: z.string().optional(),
  branchCode: branchCodeSchema,
  allowedRoutes: z.array(z.string().min(1)).optional().default([]),
  defaultRoute: z.string().optional(),
  allowedIps: z.array(z.string().min(1)).optional().default([]),
  specialFeatures: z.array(z.string().min(1)).optional().default([]),
  active: z.boolean().optional().default(true),
});

const roleSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  name: z.string().min(1, 'Name is required'),
  dataScope: z.enum(['all', 'org', 'telemarketing']),
  allowedRoutes: z.array(z.string().min(1)).optional().default([]),
  defaultRoute: z.string().optional(),
});

const tokenCreateSchema = z.object({
  name: z.string().min(1, 'Token name is required').max(64, 'Token name too long'),
  ttlDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).default(90),
});

/** PAT 不能管理 PAT — 任何 tokens 端点都强制要求 JWT/Cookie 来源 */
function requireSessionAuth(req: Request): void {
  if (req.pat) {
    throw new AppError(403, 'Cannot manage tokens via PAT. Use browser session.');
  }
}

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
 * POST /api/auth/change-password
 * 用户本人设密/改密。未设密账号（会话带 pns 声明）被 authMiddleware 拦在本端点白名单内，
 * 设密成功后重发不含 pns 的会话即解锁业务路由。
 *   - 账号已有可用密码凭据（存量账号）→ 必须验旧密（旧密码即一次性激活凭据）；
 *   - 无任何可用凭据（tombstone 账号飞书首登）→ oldPassword 可缺省，会话本身是身份凭据。
 * 仅浏览器会话可调（PAT 强制只读且不涉密码）；旧密码错误计入登录失败锁定（防爆破）。
 */
const changePasswordSchema = z.object({
  oldPassword: z.string().optional(),
  newPassword: z.string().min(1, 'New password is required'),
});

router.post(
  '/change-password',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    requireSessionAuth(req);
    if (!req.user) throw new AppError(401, 'No token provided');

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const { oldPassword, newPassword } = parseResult.data;
    const username = req.user.username;
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';

    // 与登录共用 IP+用户名双键锁定：防止持有效会话爆破旧密码
    checkAccountLock(clientIp, username);
    try {
      await authService.changePassword(username, oldPassword, newPassword);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 401) {
        recordLoginFailure(clientIp, username);
      }
      auditAuthEvent({ event: 'password_change_failure', username, ip: clientIp });
      throw err;
    }
    resetLoginAttempts(clientIp, username);
    auditAuthEvent({ event: 'password_changed', username, ip: clientIp, role: req.user.role });

    // 重发不含 pns 声明的会话（cookie + token 双通道），前端无需重新登录
    const session = authService.issueCookieSession({
      username,
      displayName: username,
      role: req.user.role,
      organization: req.user.organization,
      branchCode: req.user.branchCode,
    });
    setSessionCookies(res, session.accessToken, session.refreshToken);
    res.json({
      success: true,
      data: { changed: true, token: session.accessToken },
    });
  })
);

/**
 * POST /api/auth/activate
 * 消费激活令牌自设密码（管理员发放的一次性 cx_act_ 令牌，不依赖飞书的备份激活通道）。
 * 未认证端点：app.ts 挂独立限流桶（5/min/IP），服务层统一错误消息防枚举；
 * 成功即写密码 + 置 password_changed_at + 令牌作废，之后用新密码正常登录。
 */
const activateSchema = z.object({
  token: z.string().min(1, 'Activation token is required'),
  newPassword: z.string().min(1, 'New password is required'),
});

router.post(
  '/activate',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = activateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const { token, newPassword } = parseResult.data;
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';

    let username: string;
    try {
      username = await activateWithToken(token, newPassword);
    } catch (err) {
      // 审计不落令牌明文，只记事件与 IP（防枚举的统一错误已由服务层保证）
      auditAuthEvent({ event: 'activation_failure', username: 'unknown', ip: clientIp });
      throw err;
    }
    auditAuthEvent({ event: 'activation_success', username, ip: clientIp });
    res.json({ success: true, data: { activated: true } });
  })
);

/**
 * POST /api/auth/users/:id/activation-token
 * 管理员为账号签发一次性激活令牌（24h；明文仅本响应返回一次，禁入日志/审计）。
 * 鉴权与账号管理面同级：branch_admin + 目标账号须在调用者可管理省范围内。
 * 重发即作废该账号旧的未使用令牌。
 */
router.post(
  '/users/:id/activation-token',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    requireSessionAuth(req);
    if (!req.user) throw new AppError(401, 'Authentication required');

    const target = await getUserById(req.params.id);
    if (!target) throw new AppError(404, '用户不存在');
    if (!target.active) throw new AppError(400, '账号已停用，无法签发激活令牌');
    // 管理面按省收敛：只能给可管理范围内的账号发令牌（与 PUT /users/:id 同一闸）
    const scope = getManageableBranchScope(req.user ?? {});
    if (scope !== null && !canManageBranch(scope, target.branchCode)) {
      throw new AppError(403, '无权管理其他分公司的账号');
    }

    const created = await createActivationToken({
      userId: target.id,
      username: target.username,
      createdBy: req.user.username,
    });
    auditAuthEvent({
      event: 'activation_token_created',
      username: target.username,
      ip: req.ip,
      role: req.user.role,
      tokenId: created.tokenId,
    });

    res.json({
      success: true,
      data: {
        token: created.plaintext, // 明文，仅此次返回
        tokenId: created.tokenId,
        username: created.username,
        expiresAt: created.expiresAt.toISOString(),
      },
    });
  })
);

router.get(
  '/users',
  authMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const users = await listUsers();
    // 管理面按省收敛：单省 branch_admin 只列本省账号，全国超管列全部（RLS 关时 scope=null 列全部）。
    const scope = getManageableBranchScope(req.user ?? {});
    const visible =
      scope === null ? users : users.filter((u) => canManageBranch(scope, u.branchCode));
    res.json({
      success: true,
      data: visible.map(({ passwordHash, ...rest }) => rest),
    });
  })
);

router.post(
  '/users',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = userCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const data = parseResult.data;
    // 管理面按省收敛：新账号 branchCode 必须落在调用者可管理范围内。
    // 单省 admin 未显式指定则默认其本省；多省超管必须显式指定（否则歧义）。
    // RLS 关（scope=null）保持历史行为：branchCode 原样透传（可缺省）。
    const scope = getManageableBranchScope(req.user ?? {});
    let branchCode = data.branchCode;
    if (scope !== null) {
      if (branchCode) {
        if (!canManageBranch(scope, branchCode)) {
          throw new AppError(403, `无权在分公司 ${branchCode} 下创建账号`);
        }
      } else if (scope.length === 1) {
        branchCode = scope[0];
      } else {
        throw new AppError(400, '请显式指定新账号的 branchCode（多分公司超管创建账号需指定 SC/SX）');
      }
    }
    const passwordHash = await authService.hashPassword(data.password);
    const created = await createUser({
      username: data.username,
      displayName: data.displayName,
      passwordHash,
      role: data.role,
      organization: data.organization,
      branchCode,
      allowedRoutes: data.allowedRoutes,
      defaultRoute: data.defaultRoute,
      allowedIps: data.allowedIps,
      specialFeatures: data.specialFeatures,
      active: data.active,
    });
    const { passwordHash: _pw, ...rest } = created;
    res.json({ success: true, data: rest });
  })
);

router.put(
  '/users/:id',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = userUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const data = parseResult.data;
    // 管理面按省收敛：先据 id 载入目标账号，核对其 branchCode 在调用者可管理范围内；
    // 若本次要迁移 branchCode，新省也必须在范围内（防把账号「搬」出本省再操纵）。
    const scope = getManageableBranchScope(req.user ?? {});
    if (scope !== null) {
      const target = await getUserById(req.params.id);
      if (!target) throw new AppError(404, '用户不存在');
      if (!canManageBranch(scope, target.branchCode)) {
        throw new AppError(403, '无权管理其他分公司的账号');
      }
      if (data.branchCode !== undefined && !canManageBranch(scope, data.branchCode)) {
        throw new AppError(403, `无权将账号迁移到分公司 ${data.branchCode}`);
      }
    }
    const passwordHash = data.password ? await authService.hashPassword(data.password) : undefined;
    const updated = await updateUser(req.params.id, {
      displayName: data.displayName,
      passwordHash,
      role: data.role,
      organization: data.organization,
      branchCode: data.branchCode,
      allowedRoutes: data.allowedRoutes,
      defaultRoute: data.defaultRoute,
      allowedIps: data.allowedIps,
      specialFeatures: data.specialFeatures,
      active: data.active,
    });
    const { passwordHash: _pw, ...rest } = updated;
    res.json({ success: true, data: rest });
  })
);

router.delete(
  '/users/:id',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    // 管理面按省收敛：只能删本可管理范围内的账号（RLS 关时 scope=null 放行）。
    const scope = getManageableBranchScope(req.user ?? {});
    if (scope !== null) {
      const target = await getUserById(req.params.id);
      if (!target) throw new AppError(404, '用户不存在');
      if (!canManageBranch(scope, target.branchCode)) {
        throw new AppError(403, '无权删除其他分公司的账号');
      }
    }
    await deleteUser(req.params.id);
    res.json({ success: true, data: { deleted: true } });
  })
);

router.get(
  '/roles',
  authMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (_req: Request, res: Response) => {
    const roles = await listRoles();
    res.json({ success: true, data: roles });
  })
);

router.post(
  '/roles',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    // 角色表是全局单表：单省 admin 改角色定义会跨省影响其他省账号，写操作收敛到系统级超管
    if (!isNationalAdmin(req.user ?? {})) {
      throw new AppError(403, '角色定义为全局资产，仅系统级管理员可修改');
    }
    const parseResult = roleSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const created = await createRole(parseResult.data);
    res.json({ success: true, data: created });
  })
);

router.put(
  '/roles/:role',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isNationalAdmin(req.user ?? {})) {
      throw new AppError(403, '角色定义为全局资产，仅系统级管理员可修改');
    }
    const parseResult = roleSchema.safeParse({ ...req.body, role: req.params.role });
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const updated = await updateRole(parseResult.data);
    res.json({ success: true, data: updated });
  })
);

router.delete(
  '/roles/:role',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    if (!isNationalAdmin(req.user ?? {})) {
      throw new AppError(403, '角色定义为全局资产，仅系统级管理员可修改');
    }
    await deleteRole(req.params.role);
    res.json({ success: true, data: { deleted: true } });
  })
);

/**
 * GET /api/auth/tokens
 * 列出当前用户的所有 PAT（不含明文/哈希）
 */
router.get(
  '/tokens',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    requireSessionAuth(req);
    if (!req.user) throw new AppError(401, 'Authentication required');
    const tokens = await listPatsByUser(req.user.userId);
    res.json({
      success: true,
      data: tokens.map((t) => ({
        tokenId: t.tokenId,
        name: t.name,
        createdAt: t.createdAt.toISOString(),
        expiresAt: t.expiresAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        lastUsedIp: t.lastUsedIp ?? null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
      })),
    });
  })
);

/**
 * POST /api/auth/tokens
 * 生成新 PAT。明文 token 仅此次返回，之后无法再取回。
 */
router.post(
  '/tokens',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    requireSessionAuth(req);
    if (!req.user) throw new AppError(401, 'Authentication required');

    const parseResult = tokenCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { name, ttlDays } = parseResult.data;
    const result = await createPat({
      userId: req.user.userId,
      username: req.user.username,
      name,
      ttlDays: ttlDays as TtlDays,
    });

    auditAuthEvent({
      event: 'pat_created',
      username: req.user.username,
      ip: req.ip,
      role: req.user.role,
      organization: req.user.organization,
    });

    res.json({
      success: true,
      data: {
        token: result.plaintext, // 明文，仅此次返回
        tokenId: result.token.tokenId,
        name: result.token.name,
        createdAt: result.token.createdAt.toISOString(),
        expiresAt: result.token.expiresAt.toISOString(),
      },
    });
  })
);

/**
 * DELETE /api/auth/tokens/:id
 * 吊销指定 PAT（软删 revoked_at）。只允许吊销自己的 token。
 */
router.delete(
  '/tokens/:id',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    requireSessionAuth(req);
    if (!req.user) throw new AppError(401, 'Authentication required');

    await revokePat(req.user.userId, req.params.id);
    auditAuthEvent({
      event: 'pat_revoked',
      username: req.user.username,
      ip: req.ip,
      role: req.user.role,
      organization: req.user.organization,
    });
    res.json({ success: true, data: { revoked: true, tokenId: req.params.id } });
  })
);

/**
 * GET /api/auth/route-catalog
 * 返回 /api/query/* 路由元数据，供 CLI / MCP 命令枚举使用。
 * 鉴权：JWT 或 PAT 均可（这是只读元数据，PAT 可访问）。
 */
router.get(
  '/route-catalog',
  authMiddleware,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        version: 1,
        routes: QUERY_ROUTE_METADATA.map((r) => ({
          ...r,
          fullPath: `/api/query${r.path}`,
        })),
      },
    });
  })
);

/**
 * GET /api/auth/report-access — Nginx auth_request 专用（B346 静态报告机构级授权）。
 *
 * Nginx `location /reports/` 的 auth_request 子请求打到这里，携带
 * X-Original-URI（$request_uri）。按静态报告路径约定做角色 + 机构归属授权：
 *   - 省级全量报告（/reports/<slug>/<file>）→ 仅 branch_admin
 *   - 机构级报告（/reports/<slug>/orgs/<branch>/<org>/<file>）→ org_user 本机构放行
 * 缺 X-Original-URI（Nginx 配置漂移）→ fail-closed 403，禁止静默放行。
 * 通过返回 204（auth_request 只认 2xx=放行、401/403=拒绝）。
 */
router.get(
  '/report-access',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const originalUri = req.header('x-original-uri');
    if (!originalUri) throw new AppError(403, '无权访问报告');
    assertStaticReportAccess(req, originalUri);
    res.status(204).end();
  })
);

/**
 * GET /api/auth/me
 * 返回当前登录用户（基于 access cookie / JWT bearer / PAT bearer）
 * tokenType: 'session' 来自 cookie/JWT, 'pat' 来自 PAT。
 *
 * B346 过渡强化：现网 Nginx 的 /reports/* auth_request 指向本端点（B336 模板），
 * 并透传 X-Original-URI。在 Nginx conf 切换到 /api/auth/report-access 之前，
 * 这里检测到 auth_request 子请求语境（携带指向 /reports/ 的 X-Original-URI）时
 * 执行同一套机构级授权 —— 后端一部署即封住「org_user 看全省报告」的洞，
 * 不依赖 Nginx 变更。普通前端调用不带该头，行为不变。
 */
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError(401, 'No token provided');

    const originalUri = req.header('x-original-uri');
    if (originalUri && shouldEnforceStaticReportPolicy(originalUri)) {
      assertStaticReportAccess(req, originalUri);
    }
    const { username, role, organization, visibleBranches } = req.user;
    const tokenType = req.pat ? 'pat' : 'session';

    let user = await getUserByUsername(username);
    if (!user) {
      user = await ensurePresetUser(username);
    }
    // mustChangePassword 按会话声明（pns）回传而非按 store 重算：
    // 会话签发时点已判定（密码登录/飞书扫码两条链路都会置位），设密成功换发会话即消失。
    const mustChangePassword = req.user.pns === true || undefined;
    // hasPassword：账号当前是否存在可验证的密码凭据 —— 前端设密页据此决定
    // 显示「改密模式」（要求输入当前密码）还是「首次设密模式」（tombstone 账号免验旧密）。
    const hasPassword = user ? authService.hasUsablePassword(username, user) : true;
    if (user) {
      const { passwordHash: _pw, ...rest } = user;
      // visibleBranches 由 auth 中间件按 username 从 PRESET_USERS 派生（store 不持久化该字段），
      // 随 /me 回前端，保证刷新/恢复会话后切省下拉仍可见（codex 闸-1 P1-3）。
      res.json({
        success: true,
        data: { ...rest, visibleBranches, tokenType, mustChangePassword, hasPassword },
      });
      return;
    }
    res.json({
      success: true,
      data: {
        username,
        displayName: username === 'admin' ? '系统管理员' : username,
        role,
        organization,
        visibleBranches,
        tokenType,
        mustChangePassword,
        hasPassword,
      },
    });
  })
);

export default router;
