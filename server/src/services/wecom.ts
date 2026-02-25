import fs from 'fs/promises';
import { UserCredential } from './auth.js';
import path from 'path';

export interface WeComConfig {
    corpId: string;
    agentId: string;
    secret: string;
}

interface WeComUserInfo {
    userid?: string;
    name?: string;
    [key: string]: any;
}

class WeComService {
    private config: WeComConfig;
    private accessToken: string | null = null;
    private tokenExpiresAt: number = 0;
    private tokenFetchPromise: Promise<string> | null = null;

    constructor() {
        this.config = {
            corpId: process.env.WECOM_CORP_ID || '',
            agentId: process.env.WECOM_AGENT_ID || '',
            secret: process.env.WECOM_SECRET || '',
        };
    }

    getConfig() {
        return {
            corpId: this.config.corpId,
            agentId: this.config.agentId,
        };
    }

    /**
     * 获取或刷新 Access Token (并发安全)
     */
    async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        if (this.tokenFetchPromise) {
            return this.tokenFetchPromise;
        }

        this.tokenFetchPromise = (async () => {
            try {
                const { corpId, secret } = this.config;
                if (!corpId || !secret) {
                    throw new Error('WeCom configuration missing: WECOM_CORP_ID or WECOM_SECRET');
                }

                const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`;
                const response = await fetch(url);
                const data = await response.json() as { errcode: number; errmsg: string; access_token: string; expires_in: number };

                if (data.errcode !== 0) {
                    throw new Error(`Failed to get WeCom access token: ${data.errmsg}`);
                }

                this.accessToken = data.access_token;
                // 过期时间提前 200 秒，避免临界点失效
                this.tokenExpiresAt = Date.now() + (data.expires_in - 200) * 1000;
                return this.accessToken!;
            } finally {
                this.tokenFetchPromise = null;
            }
        })();

        return this.tokenFetchPromise;
    }

    /**
     * 通过 code 获取企微用户信息
     */
    async getUserInfo(code: string): Promise<WeComUserInfo> {
        const token = await this.getAccessToken();
        const url = `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${token}&code=${code}`;

        const response = await fetch(url);
        const data = await response.json() as WeComUserInfo & { errcode: number; errmsg: string };

        if (data.errcode !== 0) {
            throw new Error(`WeCom getUserInfo failed: ${data.errmsg}`);
        }

        return data;
    }

    /**
     * 解析权限，返回用户信息 (如果不在白名单或通讯录中抛出错误)
     */
    async resolvePermission(userId: string, name?: string): Promise<Omit<UserCredential, 'passwordHash'> | null> {
        // 1. 检查超级管理员白名单
        const adminUserIds = (process.env.WECOM_ADMIN_USERIDS || '').split(',').map(id => id.trim());
        if (adminUserIds.includes(userId)) {
            return {
                username: userId,
                displayName: name || userId,
                role: 'branch_admin',
            };
        }

        // 2. 检查业务员映射
        try {
            // JSON 文件路径：数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json
            // 由于 server 从 src/ 启动，需向上跳出 server 并在项目根目录找
            const mappingPath = path.resolve(process.cwd(), '../数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json');
            const data = await fs.readFile(mappingPath, 'utf8');
            const root = JSON.parse(data);
            const mappingList = root.salesman_mapping || [];

            const orgData = mappingList.find((item: any) => item.business_no === userId || (name && item.salesman_name === name));

            if (orgData) {
                return {
                    username: userId,
                    displayName: name || userId,
                    role: 'org_user',
                    organization: orgData.organization || orgData.team || orgData.branch, // 兼容可能的字段名
                };
            }
        } catch (error: any) {
            console.error('[WeComService] Failed to read or parse salesman mapping:', error.message);
            // 找不到文件或解析失败属于后端异常
        }

        // 不在管理员且没有机构匹配
        return null;
    }
}

export const wecomService = new WeComService();
