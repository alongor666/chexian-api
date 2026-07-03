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
import { QUERY_ROUTE_METADATA } from '../config/query-routes-metadata.js';

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
 * GET /api/auth/me
 * 返回当前登录用户（基于 access cookie / JWT bearer / PAT bearer）
 * tokenType: 'session' 来自 cookie/JWT, 'pat' 来自 PAT。
 */
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError(401, 'No token provided');
    const { username, role, organization, visibleBranches } = req.user;
    const tokenType = req.pat ? 'pat' : 'session';

    let user = await getUserByUsername(username);
    if (!user) {
      user = await ensurePresetUser(username);
    }
    if (user) {
      const { passwordHash: _pw, ...rest } = user;
      // visibleBranches 由 auth 中间件按 username 从 PRESET_USERS 派生（store 不持久化该字段），
      // 随 /me 回前端，保证刷新/恢复会话后切省下拉仍可见（codex 闸-1 P1-3）。
      res.json({
        success: true,
        data: { ...rest, visibleBranches, tokenType },
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
      },
    });
  })
);

export default router;
