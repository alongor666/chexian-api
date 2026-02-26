import { Router, Request, Response } from 'express';
import { wecomService } from '../services/wecom.js';
import { authService } from '../services/auth.js';

const router = Router();

const ACCESS_COOKIE = 'cx_access_token';
const REFRESH_COOKIE = 'cx_refresh_token';

function parseDurationToMs(duration: string | undefined, fallbackMs: number): number {
    if (!duration) return fallbackMs;
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return fallbackMs;
    const value = Number(match[1]);
    const unit = match[2];
    const factors: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * (factors[unit] || 1000);
}

/**
 * GET /api/auth/wecom/config
 * 获取企微配置供前端生成二维码
 */
router.get('/config', (req: Request, res: Response) => {
    const config = wecomService.getConfig();
    // We need to provide the callback URL the frontend should redirect to after WeCom OAuth
    // In production, this should be the full HTTPS URL
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = req.get('host');
    const callbackUrl = `${protocol}://${host}/api/auth/wecom/callback`;

    res.json({
        success: true,
        data: {
            corpId: config.corpId,
            agentId: config.agentId,
            callbackUrl,
        }
    });
});

/**
 * GET /api/auth/wecom/callback
 * 企微扫码登录回调
 */
router.get('/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
        return res.redirect('/#/?error=missing_wecom_code');
    }

    try {
        // 1. 获取企微用户信息 (UserId)
        const userInfo = await wecomService.getUserInfo(code);
        const userId = userInfo.UserId || userInfo.userid; // WeCom returns UserId

        if (!userId) {
            console.warn('[WeCom Auth] Could not extract UserId from WeCom response', userInfo);
            return res.redirect('/#/?error=wecom_not_enterprise_user');
        }

        // 2. 解析权限 (匹配白名单和业务员表)
        // 企微 userinfo 接口不直接返回 name，如果有需要可根据业务进一步增强。
        // 这里我们传入 userId 和 name（假设 undefined）
        const userCredential = await wecomService.resolvePermission(userId);

        if (!userCredential) {
            console.warn(`[WeCom Auth] User ${userId} not in admin list or salesman mapping.`);
            return res.redirect('/#/?error=wecom_auth_denied');
        }

        // 3. 签发 cookie 会话（access+refresh）
        const secure = process.env.NODE_ENV === 'production';
        const accessMaxAge = parseDurationToMs(process.env.JWT_EXPIRES_IN || '4h', 4 * 60 * 60 * 1000);
        const refreshMaxAge = parseDurationToMs(process.env.JWT_REFRESH_EXPIRES_IN || '7d', 7 * 24 * 60 * 60 * 1000);
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

        // 4. 重定向回前端页面（不再在 URL 暴露 token）
        res.redirect('/#/?wecom=success');

    } catch (error: any) {
        console.error('[WeCom Auth] Callback error:', error.message);
        res.redirect('/#/?error=wecom_auth_failed');
    }
});

export default router;
