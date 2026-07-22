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
  revokeActivePatsForUser,
  type TtlDays,
} from '../services/personal-access-token.js';
import {
  createActivationToken,
  activateWithToken,
  createPasswordResetToken,
  resetPasswordWithToken,
} from '../services/activation-token.js';
import { notifyPasswordEvent } from '../services/notify.js';
import { QUERY_ROUTE_METADATA } from '../config/query-routes-metadata.js';
import {
  resolveAllowedRoutes,
  canAccessRestrictedModule,
  getDeniedModules,
  ACCESS_CONTROL_PAGE,
} from '../config/preset-users.js';
import { assertStaticReportAccess, shouldEnforceStaticReportPolicy } from './reports.js';
import { getAuthMethods } from '../services/credential-policy.js';
import { buildBranchScope } from '../utils/branch-scope.js';

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
 * 权限管理模块门禁（模块负面清单 · 2026-07-15）：
 * 用户/角色管理端点在 requireRole(BRANCH_ADMIN) 之上再收一层——调用者 username 必须在
 * RESTRICTED_MODULES['/admin/access-control'] 白名单内（仅 薛成龙/杨杰/林霞 三人；
 * admin 的"运维兜底"席位属规格外扩权，2026-07-17 评审 P1 收口移除）。
 * 其余 branch_admin（总经理室/车险部员工）保留全部业务板块与 PAT 自助，但无权限管理面。
 * fail-closed：白名单外一律 403，与前端导航隐藏/页面守卫同源（preset-users.ts SSOT）。
 */
function requireAccessControlModule(req: Request, _res: Response, next: (err?: unknown) => void): void {
  if (!req.user) {
    return next(new AppError(401, 'Authentication required'));
  }
  if (!canAccessRestrictedModule(req.user.username, ACCESS_CONTROL_PAGE)) {
    return next(new AppError(403, '无访问权限：权限管理模块仅限指定管理员使用'));
  }
  next();
}

/**
 * 凭据轮换（改密 / 激活 / 找回 / 管理员重置）后联动吊销该用户全部 active PAT（安全审查 M4）。
 * PAT.user_id 存的是会话 JWT userId（= 用户名），故按 username 吊销。
 * best-effort：吊销失败不回滚已完成的密码变更（密码已换更重要），仅告警 + 审计，运维可手动补吊销。
 * @param username 目标账号用户名（= 其 PAT 的 user_id）
 */
async function revokePatsOnCredentialRotation(
  username: string,
  ip: string | undefined,
  role?: string,
): Promise<void> {
  try {
    const { revokedCount } = await revokeActivePatsForUser(username);
    if (revokedCount > 0) {
      auditAuthEvent({ event: 'pat_revoked_on_password_change', username, ip, role });
    }
  } catch (err) {
    console.warn(
      `[Auth] 凭据轮换后 PAT 批量吊销失败 (user=${username}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 统一的「用户名或密码错误」响应（安全审查 M6）：未知用户 / 密码错误 / 账号禁用 / IP 不允许
 * 四种登录拒绝场景，对客户端一律返回相同的状态码 + 文案，禁止通过响应差异枚举账号存在性
 * 或账号状态。真实原因只落审计日志（auditAuthEvent），不进 HTTP 响应体。
 */
const GENERIC_LOGIN_FAILURE_MESSAGE = 'Invalid username or password';
function genericLoginFailure(): AppError {
  return new AppError(401, GENERIC_LOGIN_FAILURE_MESSAGE);
}

/**
 * POST /api/auth/login
 * 用户登录，返回JWT Token
 *
 * 对外响应统一化（安全审查 M6，2026-07-12 loop 823570）：
 *   authService.login() 服务层保留原有内部错误契约（403 Account disabled / 403 IP not allowed /
 *   401 Invalid username or password），供审计记录真实原因、供其他服务层测试锁死行为；
 *   本路由层是唯一把「真实原因」收窄为「对外统一 401 通用文案」的收口点——未知用户、密码错误、
 *   账号禁用、IP 不允许四种场景，客户端拿到的响应必须字节级一致，防止通过状态码/文案枚举
 *   账号是否存在或账号状态。计时侧信道防护（哑 bcrypt 比对 / 先验密码再判定禁用与 IP）
 *   已在服务层 authService.login() 完成，见 services/auth.ts。
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
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
      // IP 不允许：真实原因入审计（login_ip_denied），对外统一 401 通用文案，
      // 且计入登录失败锁定（代码审查 P1 修正 2026-07-12：单次响应已四场景字节级一致后，
      // 若仅此分支不计锁定次数，会残留一条「该用户名从被拒 IP 反复试探永不 429」的多请求
      // 行为侧信道，可用来区分「IP 受限的真实账号」与「无限制的未知/任意账号」，
      // 故与账号禁用/密码错误同等对待）。
      recordLoginFailure(clientIp, username);
      auditAuthEvent({ event: 'login_ip_denied', username, ip: clientIp });
      throw genericLoginFailure();
    }
    if (err instanceof AppError && err.statusCode === 403 && err.message === 'Account disabled') {
      // 账号禁用：真实原因入审计（login_account_disabled），对外统一 401 通用文案，
      // 且计入登录失败锁定（与密码错误同等对待，防止通过锁定行为差异反推账号已被禁用）。
      recordLoginFailure(clientIp, username);
      auditAuthEvent({ event: 'login_account_disabled', username, ip: clientIp });
      throw genericLoginFailure();
    }
    if (err instanceof AppError && err.statusCode === 403 && err.message === 'AUTH_METHOD_NOT_ALLOWED') {
      // 无密码凭据账号（如飞书专属个人账号）尝试密码登录（M6 残余面收口，2026-07-18）：
      // 若把服务层的 403 AUTH_METHOD_NOT_ALLOWED 原样透传，响应差异会泄露「该用户名存在
      // 且是飞书专属/无密码账号」——与账号禁用/IP 拒绝同类的枚举面。真实原因入审计
      // （login_password_not_allowed），对外统一 401 通用文案，并计入登录失败锁定。
      recordLoginFailure(clientIp, username);
      auditAuthEvent({ event: 'login_password_not_allowed', username, ip: clientIp });
      throw genericLoginFailure();
    }
    // 未知用户 / 密码错误：服务层本就返回统一的 401 Invalid username or password，原样透传。
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
}

router.post('/login', asyncHandler(loginHandler));

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
    // 凭据轮换联动：吊销该用户全部 active PAT（防改密后旧 PAT 仍是只读后门，M4）
    await revokePatsOnCredentialRotation(req.user.userId, clientIp, req.user.role);
    // webhook 群播（静默失败不阻塞主流程；审计已独立落盘）
    void notifyPasswordEvent({ username, method: 'self_change' });

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
    // 凭据轮换联动：吊销该用户全部 active PAT（M4）
    await revokePatsOnCredentialRotation(username, clientIp);
    // webhook 群播（静默失败不阻塞主流程；审计已独立落盘）
    void notifyPasswordEvent({ username, method: 'activation' });
    res.json({ success: true, data: { activated: true } });
  })
);

/**
 * POST /api/auth/reset-password
 * 消费找回/重置令牌重设密码（阶段二找回双通道的统一消费端点，activate 风格）。
 * 令牌来源两条链路：
 *   - 飞书扫码找回：callback 种下的 httpOnly cookie cx_reset_token（path 收窄到本端点）；
 *   - 管理员一次性重置令牌：管理员线下交付明文，用户在设新密页粘贴（body.token）。
 * 未认证端点：app.ts 挂独立限流桶 resetPasswordLimiter（5/min/IP），服务层统一错误防枚举；
 * 成功即写密码 + 置 password_changed_at + 令牌作废，之后用新密码正常登录。
 */
const resetPasswordSchema = z.object({
  token: z.string().min(1).optional(),
  newPassword: z.string().min(1, 'New password is required'),
});

/** 与服务层 KIND_CONFIG.reset 一致的统一错误（缺令牌也回同一句，防枚举） */
const RESET_UNIFIED_MESSAGE = '重置令牌无效或已过期';
const RESET_TOKEN_COOKIE = 'cx_reset_token';

router.post(
  '/reset-password',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const { token, newPassword } = parseResult.data;
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';

    // body 令牌（管理员链路，用户粘贴）优先；否则取飞书找回种下的 cookie
    const rawToken = token || parseCookieValue(req, RESET_TOKEN_COOKIE);
    if (!rawToken) {
      throw new AppError(400, RESET_UNIFIED_MESSAGE);
    }

    let consumed;
    try {
      consumed = await resetPasswordWithToken(rawToken, newPassword);
    } catch (err) {
      // 审计不落令牌明文，只记事件与 IP（防枚举的统一错误已由服务层保证）
      auditAuthEvent({ event: 'password_reset_failure', username: 'unknown', ip: clientIp });
      throw err;
    }

    // 消费成功即清掉找回 cookie（一次性语义在服务层已保证，这里是浏览器侧收尾）
    res.clearCookie(RESET_TOKEN_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/reset-password',
    });
    auditAuthEvent({
      event: 'password_reset',
      username: consumed.username,
      ip: clientIp,
      tokenId: consumed.tokenId,
    });
    // 凭据轮换联动：吊销该用户全部 active PAT（M4）
    await revokePatsOnCredentialRotation(consumed.username, clientIp);
    // webhook 群播：按签发来源区分「飞书找回」vs「管理员重置」（静默失败不阻塞）
    void notifyPasswordEvent({
      username: consumed.username,
      method: consumed.createdBy === 'feishu-reset' ? 'feishu_reset' : 'admin_reset',
    });
    res.json({ success: true, data: { reset: true } });
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
  requireAccessControlModule,
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

/**
 * POST /api/auth/users/:id/reset-token
 * 管理员为账号签发一次性重置令牌（找回双通道之二，不依赖飞书；24h；明文仅本响应
 * 返回一次，禁入日志/审计）。用户凭令牌走 POST /api/auth/reset-password 重设密码。
 * 鉴权/省域收敛与激活令牌端点同闸；重发即作废该账号旧的未使用重置令牌（kind 隔离，
 * 不影响在途激活令牌）。
 */
router.post(
  '/users/:id/reset-token',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  requireAccessControlModule,
  asyncHandler(async (req: Request, res: Response) => {
    requireSessionAuth(req);
    if (!req.user) throw new AppError(401, 'Authentication required');

    const target = await getUserById(req.params.id);
    if (!target) throw new AppError(404, '用户不存在');
    if (!target.active) throw new AppError(400, '账号已停用，无法签发重置令牌');
    const scope = getManageableBranchScope(req.user ?? {});
    if (scope !== null && !canManageBranch(scope, target.branchCode)) {
      throw new AppError(403, '无权管理其他分公司的账号');
    }

    const created = await createPasswordResetToken({
      userId: target.id,
      username: target.username,
      createdBy: req.user.username,
    });
    auditAuthEvent({
      event: 'reset_token_created',
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
  requireAccessControlModule,
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
  requireAccessControlModule,
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
  requireAccessControlModule,
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
    // 管理员重置密码：updateUser 已置空 password_changed_at（新哈希只是一次性临时凭据，
    // 用户下次登录被 pns 拦截强制自设专属密码）——审计 + webhook 群播留痕
    if (passwordHash) {
      auditAuthEvent({
        event: 'password_admin_reset',
        username: updated.username,
        ip: req.ip,
        role: req.user?.role,
      });
      // 凭据轮换联动：吊销被重置账号全部 active PAT（疑似账号被盗时防旧 PAT 残留只读后门，M4）
      await revokePatsOnCredentialRotation(updated.username, req.ip, req.user?.role);
      void notifyPasswordEvent({ username: updated.username, method: 'admin_reset' });
    }
    const { passwordHash: _pw, ...rest } = updated;
    res.json({ success: true, data: rest });
  })
);

router.delete(
  '/users/:id',
  authMiddleware,
  readonlyMiddleware,
  requireRole(UserRole.BRANCH_ADMIN),
  requireAccessControlModule,
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
  requireAccessControlModule,
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
  requireAccessControlModule,
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
  requireAccessControlModule,
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
  requireAccessControlModule,
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
    const { username, role, organization, visibleBranches, branchCode } = req.user;
    const tokenType = req.pat ? 'pat' : 'session';
    const branchScope = buildBranchScope({ role, branchCode, visibleBranches });

    let user = await getUserByUsername(username);
    if (!user) {
      user = await ensurePresetUser(username);
    }
    // mustChangePassword 按会话声明（pns）回传而非按 store 重算：
    // 会话签发时点已判定（密码登录/飞书扫码两条链路都会置位），设密成功换发会话即消失。
    const mustChangePassword = req.user.pns === true;
    const credentialUserId = user?.id ?? req.user.userId;
    // hasPassword 必须与 changePassword 的验旧密闸同源（authService.hasUsablePassword）：
    // 前端据此决定是否显示「当前密码」框并回传 oldPassword。曾用 PasswordCredential.state
    // === 'active' 判定，它只表示「已自设密码」，漏掉 USER_PASSWORDS 覆盖 / 非 tombstone
    // store 哈希这两种「有旧密可验」的账号 —— 前端因此藏掉输入框、后端却仍验旧密，
    // 这些账号（存量临时密码 + 首登强制改密路径）被永久锁死在设密页。
    const [authMethods, hasPassword] = await Promise.all([
      getAuthMethods(credentialUserId),
      authService.hasUsablePasswordForUsername(username),
    ]);
    const canChangePassword = authMethods.includes('password');
    if (user) {
      const { passwordHash: _pw, ...rest } = user;
      // visibleBranches 由 auth 中间件按 username 从 PRESET_USERS 派生（store 不持久化该字段），
      // 随 /me 回前端，保证刷新/恢复会话后切省下拉仍可见（codex 闸-1 P1-3）。
      res.json({
        success: true,
        data: {
          ...rest,
          // allowedRoutes 为空/未定义时按角色回填，避免前端回退到本地兜底清单（前后端口径漂移根因）。
          allowedRoutes: resolveAllowedRoutes(rest.role, rest.allowedRoutes),
          visibleBranches,
          branchScope,
          // 模块负面清单按 username 派生（SSOT: RESTRICTED_MODULES），刷新/恢复会话后导航隐藏仍生效。
          deniedModules: getDeniedModules(username),
          tokenType,
          mustChangePassword,
          hasPassword,
          authMethods,
          canChangePassword,
        },
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
        branchCode: req.user.branchCode,
        visibleBranches,
        branchScope,
        deniedModules: getDeniedModules(username),
        tokenType,
        mustChangePassword,
        hasPassword,
        authMethods,
        canChangePassword,
      },
    });
  })
);

export default router;
