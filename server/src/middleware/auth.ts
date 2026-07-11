/**
 * JWT + PAT 认证中间件
 * Authentication Middleware
 *
 * 支持三种来源：
 *   1) Bearer JWT      → jwt.verify
 *   2) Bearer PAT      → cx_pat_ 前缀，走 verifyPat
 *   3) Cookie JWT      → cx_access_token，浏览器会话
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth.js';
import { AppError } from './error.js';
import { verifyPat } from '../services/personal-access-token.js';
import { isUsernameActive } from '../services/user-activation-cache.js';
import { getPresetVisibleBranches } from '../config/preset-users.js';

/**
 * 统一注入全国超管「可见省集合」到 req.user（codex 闸-1 P1-3 单点收口）。
 *
 * 在 JWT / PAT / cookie 全部身份出口之后调用：按已验证 token 的 username 从 PRESET_USERS 派生
 * visibleBranches，覆盖所有授权请求路径。visibleBranches 不进签名 token（单一事实源在 preset），
 * 故存量旧会话**免重登**即获能力，且不依赖 access-control store 是否落该字段。
 */
function decorateVisibleBranches(user: JwtPayload): void {
  user.visibleBranches = getPresetVisibleBranches(user.username);
}

/**
 * JWT Payload 类型
 */
export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  organization?: string;
  /** 分公司编码（'SC' / 'SX'）。undefined → 系统级超管看全国 */
  branchCode?: string;
  /**
   * 全国超管可切换/可合并的省集合（如 `['SC','SX']`）。
   * undefined / [] → 普通用户（仅 branchCode 单省，行为不变）。
   * 由 auth 中间件按 username 从 PRESET_USERS 派生注入（见 decorateVisibleBranches），
   * 不进签名 token —— 免重登即对存量会话生效，且单一事实源在 preset 配置（codex 闸-1 P1-3）。
   */
  visibleBranches?: string[];
  /**
   * pns（password-not-set）：该账号尚未自设专属密码（password_changed_at 为空且非豁免账号），
   * 本会话须先设密。密码登录（authService.login）与飞书扫码（feishu-auth callback）两条链路
   * 都会注入；authMiddleware 据此拦截非设密白名单路由；设密成功后重发不含 pns 的会话即解锁。
   */
  pns?: boolean;
}

/**
 * Express Request 扩展
 *  - user: 认证后的身份（JWT 或 PAT 注入）
 *  - pat:  仅当来源是 PAT 时存在；readonlyMiddleware 依赖此字段
 */
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      pat?: { tokenId: string; name: string };
    }
  }
}

const PAT_PREFIX = 'cx_pat_';

/**
 * 携带 pns 声明（尚未自设密码）的会话唯一可访问的路由白名单。
 * 设密本体 + 激活 + 会话生命周期（查身份/登出/刷新）放行，其余业务路由一律 403；
 * refresh 在 authService.refreshCookieSession 内透传 pns，防「刷新一次洗白」绕过。
 * 匹配用 req.originalUrl（ESM 部署三坑之一：勿用 req.url，router 挂载后会被截断）。
 *
 * 精确匹配路径本体或其子路径（path === p || path 以 p+'/' 开头），先剥掉 query string；
 * 刻意不用裸 `startsWith(prefix)`——否则未来新增 `/api/auth/change-password-history`、
 * `/api/auth/mentions` 之类以白名单项为前缀的路由会被静默纳入白名单，让未设密会话越权访问，
 * 且无测试/governance 能拦住这种回归（对抗性评审 MEDIUM 修复）。
 */
const PNS_ALLOWED_PATHS = [
  '/api/auth/change-password',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/activate',
];

function isPnsAllowedPath(originalUrl: string): boolean {
  const path = originalUrl.split('?')[0];
  return PNS_ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * 主认证中间件。
 * 异步（PAT 校验涉及 DB + bcrypt），错误一律走 next(err) 由 errorHandler 统一处理。
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    // 1) PAT 优先于 JWT：识别前缀
    if (bearerToken && bearerToken.startsWith(PAT_PREFIX)) {
      const clientIp = req.ip || req.socket.remoteAddress || undefined;
      const verified = await verifyPat(bearerToken, clientIp);
      req.user = {
        userId: verified.user.id,
        username: verified.user.username,
        role: verified.user.role,
        organization: verified.user.organization,
        branchCode: verified.user.branchCode,
      };
      decorateVisibleBranches(req.user); // 全国超管能力按 username 派生（PAT 出口）
      req.pat = { tokenId: verified.tokenId, name: verified.name };
      return next();
    }

    // 2) Cookie token（浏览器会话）
    const cookieToken = (() => {
      const raw = req.headers.cookie;
      if (!raw) return null;
      const pairs = raw.split(';').map(part => part.trim());
      for (const pair of pairs) {
        if (pair.startsWith('cx_access_token=')) {
          return decodeURIComponent(pair.slice('cx_access_token='.length));
        }
      }
      return null;
    })();

    const token = bearerToken || cookieToken;
    if (!token) {
      throw new AppError(401, 'No token provided');
    }

    // 3) JWT 校验
    const decoded = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    // 实时吊销：jwt.verify 只验签名/过期，无法感知账号已被禁用/删除。查内存态 active 集合
    // （O(1)，非每请求 DB），令被禁用/删除账号的未过期旧 JWT 立即失效，对齐 PAT 的 active 语义。
    // 缓存未就绪时 isUsernameActive fail-open（不误锁），正常运行期恒就绪。
    if (!isUsernameActive(decoded.username)) {
      throw new AppError(401, 'Account is disabled or removed. Please contact an administrator.');
    }
    // 尚未自设密码的会话（pns 声明）：除设密/会话生命周期白名单外一律 403，
    // 防止前端拦截被绕过后直接持 token 调业务 API（prompt 禁令须代码兜底）。
    if (decoded.pns && !isPnsAllowedPath(req.originalUrl)) {
      throw new AppError(403, 'PASSWORD_NOT_SET');
    }
    req.user = decoded;
    decorateVisibleBranches(req.user); // 全国超管能力按 username 派生（JWT/cookie 出口）；旧 token 免重登生效
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'Token expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError(401, 'Invalid token'));
    } else {
      next(error);
    }
  }
}

/**
 * 可选认证中间件（用于部分公开的路由）
 * Token 存在则验证，不存在则跳过
 */
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const hasBearer = !!(authHeader && authHeader.startsWith('Bearer '));
  const hasCookie = !!req.headers.cookie?.includes('cx_access_token=');
  if (!hasBearer && !hasCookie) {
    return next();
  }
  await authMiddleware(req, res, next);
}
