import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { feishuService } from '../services/feishu.js';
import { authService } from '../services/auth.js';
import { authEnv, feishuEnv } from '../config/env.js';
import { getUserByUsername, ensurePresetUser } from '../services/access-control.js';
import { createPasswordResetToken } from '../services/activation-token.js';
import { auditAuthEvent } from '../middleware/audit.js';
import { resetInitLimiter } from '../middleware/rateLimiter.js';
import { findFeishuAccount, findOrCreateFeishuAccount } from '../services/auth-identity.js';

const router = Router();

const ACCESS_COOKIE = 'cx_access_token';
const REFRESH_COOKIE = 'cx_refresh_token';
/** 飞书扫码 state 防 CSRF cookie（10 分钟有效，callback 校验后即清除）；值 = `<state>.<intent>` */
const STATE_COOKIE = 'cx_feishu_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
/**
 * 找回重置令牌 cookie（阶段二）：飞书找回 callback 把一次性 cx_rst_ 令牌种进 httpOnly cookie，
 * path 收窄到消费端点本身——浏览器只会向 /api/auth/reset-password 携带，前端 JS 不可读，
 * 令牌明文不出现在 URL / 日志 / 前端存储。
 */
const RESET_TOKEN_COOKIE = 'cx_reset_token';
const RESET_TOKEN_COOKIE_PATH = '/api/auth/reset-password';
/** 飞书找回签发的重置令牌 TTL：回调后即时消费，10 分钟足够（管理员链路才用默认 24h） */
const FEISHU_RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * OAuth 意图（B 阶段二）：同一套飞书扫码链路承载两种语义——
 *   login = 登录（签发全权会话）；reset = 找回密码（只签发一次性重置令牌，绝不发会话）。
 * 意图只存于服务端下发的 state cookie（httpOnly），callback 从 cookie 读取，
 * 不信任 query 参数——防止把 reset 流当登录流换取全权会话（或反向）。
 */
export type FeishuAuthIntent = 'login' | 'reset';

/** state cookie 值 = `<state>.<intent>`（state 为 hex，无 '.'，可安全分隔） */
export function buildStateCookieValue(state: string, intent: FeishuAuthIntent): string {
    return `${state}.${intent}`;
}

/**
 * 解析 state cookie 值。兼容旧格式（无 intent 后缀的存量 cookie，升级窗口内）→ login。
 * 非法 intent 一律按 login 处理（fail-safe：宁可走登录校验链也不进 reset 分支）。
 */
export function parseStateCookieValue(raw: string): { state: string; intent: FeishuAuthIntent } {
    const dot = raw.lastIndexOf('.');
    if (dot < 0) return { state: raw, intent: 'login' };
    const intent = raw.slice(dot + 1);
    if (intent !== 'login' && intent !== 'reset') return { state: raw, intent: 'login' };
    return { state: raw.slice(0, dot), intent };
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

function buildCallbackUrl(req: Request): string {
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = req.get('host');
    return `${protocol}://${host}/api/auth/feishu/callback`;
}

/**
 * 回调后浏览器回跳的前端地址。
 * 生产：同源部署（nginx 托管 SPA），用相对路径；
 * 开发：后端(3000)不托管 SPA，相对重定向会落在 404 页（cookie 已种但观感像登录失败），
 *       故回跳 FEISHU_DEV_FRONTEND_ORIGIN（默认 vite dev server 5173）。
 */
function buildFrontendRedirect(hashPath: string): string {
    const base = process.env.NODE_ENV === 'production' ? '' : feishuEnv.FEISHU_DEV_FRONTEND_ORIGIN;
    return `${base}${hashPath}`;
}

/**
 * GET /api/auth/feishu/config
 * 获取飞书配置供前端跳转扫码授权页；同时下发 state 防 CSRF cookie（值内嵌 intent）。
 * intent=reset（发起找回）走独立限流桶 resetInitLimiter（5/min/IP），登录取配置不受影响。
 */
export function feishuConfigHandler(req: Request, res: Response): Response | void {
    if (!feishuService.isConfigured()) {
        return res.status(503).json({
            success: false,
            error: 'Feishu login not configured (FEISHU_APP_ID / FEISHU_APP_SECRET)',
        });
    }

    const intent: FeishuAuthIntent = req.query.intent === 'reset' ? 'reset' : 'login';
    const config = feishuService.getConfig();
    const state = crypto.randomBytes(16).toString('hex');
    const secure = process.env.NODE_ENV === 'production';

    res.cookie(STATE_COOKIE, buildStateCookieValue(state, intent), {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: STATE_MAX_AGE_MS,
        path: '/api/auth/feishu',
    });

    res.json({
        success: true,
        data: {
            appId: config.appId,
            callbackUrl: buildCallbackUrl(req),
            state,
        },
    });
}

router.get('/config', resetInitLimiter, feishuConfigHandler);

/**
 * 找回分支（intent=reset）：按飞书身份（open_id/手机号，经既有 resolvePermission 三层映射）
 * 定位账号 → 签发一次性重置令牌（10 分钟）→ 种 httpOnly cookie → 跳前端设新密页。
 *
 * 安全语义：
 *   - 绝不签发登录会话（reset 流不能换取全权会话）；
 *   - 防枚举：租户不符 / 无映射 / 账号不存在 / 账号停用，一律统一重定向
 *     /#/login?error=feishu_reset_failed，不泄漏差异；
 *   - 用户全程不输入用户名（按飞书身份定位）。
 */
async function handleResetIntent(req: Request, res: Response, code: string): Promise<void> {
    const unifiedFail = () => res.redirect(buildFrontendRedirect('/#/login?error=feishu_reset_failed'));
    try {
        const userAccessToken = await feishuService.exchangeUserAccessToken(code, buildCallbackUrl(req));
        const userInfo = await feishuService.getUserInfo(userAccessToken);

        if (!feishuService.isTenantAllowed(userInfo.tenant_key)) {
            console.warn('[Feishu Reset] Tenant denied');
            return unifiedFail();
        }

        const userCredential = await feishuService.resolvePermission(userInfo);
        if (!userCredential) {
            console.warn('[Feishu Reset] User not in role mapping / admin list.');
            return unifiedFail();
        }

        // 定位 store 账号实体（与登录链路同一归一化口径）；preset 未落库则先物化。
        // 纯飞书裸 ID 身份（无账号实体）没有可重置的密码 → 统一失败。
        const identityAccount = userInfo.user_id ? await findFeishuAccount(userInfo.user_id) : null;
        const normalizedUsername = userCredential.username.normalize('NFKC').trim().toLowerCase();
        let user = identityAccount?.user ?? await getUserByUsername(normalizedUsername);
        if (!user && !userCredential.authProvisioning) user = await ensurePresetUser(normalizedUsername);
        if (!user || !user.active) {
            console.warn('[Feishu Reset] No active store account for mapped identity.');
            return unifiedFail();
        }

        const created = await createPasswordResetToken({
            userId: user.id,
            username: user.username,
            createdBy: 'feishu-reset',
            ttlMs: FEISHU_RESET_TOKEN_TTL_MS,
        });
        // 审计只落 tokenId（非明文）；重置令牌明文禁入日志/审计
        auditAuthEvent({
            event: 'reset_token_created',
            username: user.username,
            ip: req.ip,
            tokenId: created.tokenId,
        });

        const secure = process.env.NODE_ENV === 'production';
        res.cookie(RESET_TOKEN_COOKIE, created.plaintext, {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            maxAge: FEISHU_RESET_TOKEN_TTL_MS,
            path: RESET_TOKEN_COOKIE_PATH,
        });
        res.redirect(buildFrontendRedirect('/#/reset-password?feishu=ready'));
    } catch (error) {
        console.error('[Feishu Reset] Callback error occurred');
        unifiedFail();
    }
}

/**
 * GET /api/auth/feishu/callback
 * 飞书扫码回调：校验 state → 按 cookie 内嵌 intent 分流：
 *   login → 换 user_access_token → 拉用户信息 → 解析权限 → 签发会话（原有流程不变）
 *   reset → 定位账号 → 签发一次性重置令牌 → 跳设新密页（绝不签发会话）
 */
export async function feishuCallbackHandler(req: Request, res: Response): Promise<void> {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
        return res.redirect(buildFrontendRedirect('/#/login?error=missing_feishu_code'));
    }

    // state 防 CSRF：必须与 /config 下发的 cookie 一致；intent 只信 cookie（服务端签发），不信 query
    const stateCookieRaw = parseCookieValue(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/feishu' });
    const parsed = stateCookieRaw ? parseStateCookieValue(stateCookieRaw) : null;
    if (!parsed || !state || state !== parsed.state) {
        console.warn('[Feishu Auth] State mismatch, possible CSRF or expired state cookie');
        return res.redirect(buildFrontendRedirect('/#/login?error=feishu_state_mismatch'));
    }

    if (parsed.intent === 'reset') {
        return handleResetIntent(req, res, code);
    }

    try {
        // 1. 授权码换 user_access_token，再拉飞书用户信息
        const userAccessToken = await feishuService.exchangeUserAccessToken(code, buildCallbackUrl(req));
        const userInfo = await feishuService.getUserInfo(userAccessToken);

        // 2. 组织（租户）门禁：仅授权组织成员可登录，其他人一律拒绝（fail-closed）
        if (!feishuService.isTenantAllowed(userInfo.tenant_key)) {
            console.warn(`[Feishu Auth] Tenant denied: tenant_key=${userInfo.tenant_key ?? 'unknown'}`);
            return res.redirect(buildFrontendRedirect('/#/login?error=feishu_org_denied'));
        }

        // 3. 解析权限（管理员白名单 + 业务员映射表，均不命中则拒绝）
        const userCredential = await feishuService.resolvePermission(userInfo);

        if (!userCredential) {
            console.warn('[Feishu Auth] User not in admin list or salesman mapping.');
            return res.redirect(buildFrontendRedirect('/#/login?error=feishu_auth_denied'));
        }

        let sessionCredential = userCredential;
        if (userCredential.authProvisioning === 'personal_feishu') {
            if (!userInfo.user_id || userCredential.role !== 'org_user' || !userCredential.organization || !userCredential.branchCode) {
                return res.redirect(buildFrontendRedirect('/#/login?error=feishu_auth_denied'));
            }
            const account = await findOrCreateFeishuAccount({
                feishuUserId: userInfo.user_id,
                displayName: userCredential.displayName,
                role: 'org_user',
                organization: userCredential.organization,
                branchCode: userCredential.branchCode,
            });
            sessionCredential = {
                ...userCredential,
                username: account.user.username,
                displayName: account.user.displayName,
                subjectUserId: account.user.id,
                authMethod: 'feishu',
                identityId: account.identity.id,
            };
        } else {
            const mustChangePassword = await authService.isPasswordNotSetForUsername(userCredential.username);
            sessionCredential = { ...userCredential, mustChangePassword: mustChangePassword || undefined };
        }

        // 5. 签发 cookie 会话（access+refresh）
        const secure = process.env.NODE_ENV === 'production';
        const accessMaxAge = parseDurationToMs(authEnv.JWT_EXPIRES_IN, 4 * 60 * 60 * 1000);
        const refreshMaxAge = parseDurationToMs(authEnv.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000);
        const session = authService.issueCookieSession({
            ...sessionCredential,
        });

        res.cookie(ACCESS_COOKIE, session.accessToken, {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            maxAge: accessMaxAge,
            path: '/',
        });
        res.cookie(REFRESH_COOKIE, session.refreshToken, {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            maxAge: refreshMaxAge,
            path: '/',
        });

        // 6. 重定向回前端页面（不在 URL 暴露 token）；pns 由前端 /me 拉取后引导设密页
        res.redirect(buildFrontendRedirect('/#/login?feishu=success'));

    } catch (error: any) {
        console.error('[Feishu Auth] Callback error occurred');
        res.redirect(buildFrontendRedirect('/#/login?error=feishu_auth_failed'));
    }
}

router.get('/callback', feishuCallbackHandler);

export default router;
