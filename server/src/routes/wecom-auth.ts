import { Router, Request, Response } from 'express';
import { wecomService } from '../services/wecom.js';
import { authConfig } from '../config/auth.js';
import jwt, { SignOptions } from 'jsonwebtoken';
import { JwtPayload } from '../middleware/auth.js';

const router = Router();

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

        // 3. 签发同格式的 JWT Token
        const payload: JwtPayload = {
            userId: userCredential.username,
            username: userCredential.username,
            role: userCredential.role,
            organization: userCredential.organization,
        };

        const token = jwt.sign(
            payload as object,
            authConfig.jwtSecret,
            { expiresIn: authConfig.jwtExpiresIn } as SignOptions
        );

        // 4. 重定向回前端页面，携带 token
        // 根据需求: 302 跳回前端 /#/?wecom_token=xxx 
        res.redirect(`/#/?wecom_token=${token}`);

    } catch (error: any) {
        console.error('[WeCom Auth] Callback error:', error.message);
        res.redirect('/#/?error=wecom_auth_failed');
    }
});

export default router;
