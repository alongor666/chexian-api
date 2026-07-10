import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { feishuService } from '../services/feishu.js';
import { authService } from '../services/auth.js';
import { authEnv, feishuEnv } from '../config/env.js';

const router = Router();

const ACCESS_COOKIE = 'cx_access_token';
const REFRESH_COOKIE = 'cx_refresh_token';
/** 飞书扫码登录 state 防 CSRF cookie（10 分钟有效，callback 校验后即清除） */
const STATE_COOKIE = 'cx_feishu_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

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
 * 获取飞书配置供前端跳转扫码授权页；同时下发 state 防 CSRF cookie
 */
router.get('/config', (req: Request, res: Response) => {
    if (!feishuService.isConfigured()) {
        return res.status(503).json({
            success: false,
            error: 'Feishu login not configured (FEISHU_APP_ID / FEISHU_APP_SECRET)',
        });
    }

    const config = feishuService.getConfig();
    const state = crypto.randomBytes(16).toString('hex');
    const secure = process.env.NODE_ENV === 'production';

    res.cookie(STATE_COOKIE, state, {
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
});

/**
 * GET /api/auth/feishu/callback
 * 飞书扫码登录回调：校验 state → 换 user_access_token → 拉用户信息 → 解析权限 → 签发会话
 */
router.get('/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
        return res.redirect(buildFrontendRedirect('/#/login?error=missing_feishu_code'));
    }

    // state 防 CSRF：必须与 /config 下发的 cookie 一致
    const expectedState = parseCookieValue(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/feishu' });
    if (!expectedState || !state || state !== expectedState) {
        console.warn('[Feishu Auth] State mismatch, possible CSRF or expired state cookie');
        return res.redirect(buildFrontendRedirect('/#/login?error=feishu_state_mismatch'));
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

        // 4. 签发 cookie 会话（access+refresh）
        const secure = process.env.NODE_ENV === 'production';
        const accessMaxAge = parseDurationToMs(authEnv.JWT_EXPIRES_IN, 4 * 60 * 60 * 1000);
        const refreshMaxAge = parseDurationToMs(authEnv.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000);
        const session = authService.issueCookieSession(userCredential);

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

        // 5. 重定向回前端页面（不在 URL 暴露 token）
        res.redirect(buildFrontendRedirect('/#/login?feishu=success'));

    } catch (error: any) {
        console.error('[Feishu Auth] Callback error occurred');
        res.redirect(buildFrontendRedirect('/#/login?error=feishu_auth_failed'));
    }
});

export default router;
