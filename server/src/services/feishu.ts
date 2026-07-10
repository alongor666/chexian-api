import fs from 'fs/promises';
import { UserCredential } from './auth.js';
import { getSalesmanMappingPaths, getFeishuRoleMappingPath } from '../config/paths.js';
import { feishuEnv } from '../config/env.js';
import { resolveBranchCode, getDeploymentBranchCode, isValidBranchCodeFormat } from '../config/sql-federation-policy.js';

/** 角色映射文件中的单条授权（feishu 内任一标识匹配即命中） */
interface FeishuRoleMappingEntry {
    feishu: {
        user_id?: string;
        open_id?: string;
        mobile?: string;
        email?: string;
    };
    /**
     * 角色层级：branch_admin（全量）/ org_user（机构）/ telemarketing_user（电销）等，与 access-control 角色一致。
     * 特殊值 'deny'：显式拒绝该用户登录（重名兜底拦截——防止业务员映射表按姓名误授权给同名员工）
     */
    role: string;
    /** org_user 必填：可见机构 */
    organization?: string;
    displayName?: string;
    /** 可选：登录后的系统用户名（对齐既有密码账号，如 xuechenglong）；缺省用飞书 user_id/open_id */
    username?: string;
    /** 可选：该用户的分公司编码（CHAR(2) 大写，如 SC/SX）；缺省回退全局 FEISHU_DEFAULT_BRANCH / 部署 BRANCH_CODE */
    branchCode?: string;
}

export interface FeishuConfig {
    appId: string;
    appSecret: string;
}

/** 飞书 OAuth v2 换取 user_access_token 的响应（成功时 code=0） */
interface FeishuTokenResponse {
    code?: number;
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

/** 飞书 /authen/v1/user_info 返回的用户信息 */
export interface FeishuUserInfo {
    name?: string;
    en_name?: string;
    open_id?: string;
    union_id?: string;
    user_id?: string;
    email?: string;
    enterprise_email?: string;
    mobile?: string;
    /** 用户所属飞书企业（租户）标识，组织门禁依据 */
    tenant_key?: string;
    [key: string]: any;
}

const FEISHU_OAUTH_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

/** 归一化手机号：去掉 +86 前缀与空白，便于与白名单/映射表比对 */
function normalizeMobile(mobile: string): string {
    return mobile.replace(/^\+86/, '').replace(/\s+/g, '');
}

class FeishuService {
    private config: FeishuConfig;

    constructor() {
        this.config = {
            appId: feishuEnv.FEISHU_APP_ID,
            appSecret: feishuEnv.FEISHU_APP_SECRET,
        };
    }

    getConfig() {
        return {
            appId: this.config.appId,
        };
    }

    isConfigured(): boolean {
        return Boolean(this.config.appId && this.config.appSecret);
    }

    /**
     * 用授权码换取 user_access_token（OAuth v2，直接使用应用凭证，无需 app_access_token）
     */
    async exchangeUserAccessToken(code: string, redirectUri: string): Promise<string> {
        const { appId, appSecret } = this.config;
        if (!appId || !appSecret) {
            throw new Error('Feishu configuration missing: FEISHU_APP_ID or FEISHU_APP_SECRET');
        }

        const response = await fetch(FEISHU_OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: appId,
                client_secret: appSecret,
                code,
                redirect_uri: redirectUri,
            }),
        });
        const data = await response.json() as FeishuTokenResponse;

        if (!data.access_token) {
            const reason = data.error_description || data.error || `code=${data.code}`;
            throw new Error(`Feishu token exchange failed: ${reason}`);
        }

        return data.access_token;
    }

    /**
     * 用 user_access_token 获取飞书用户信息
     */
    async getUserInfo(userAccessToken: string): Promise<FeishuUserInfo> {
        const response = await fetch(FEISHU_USER_INFO_URL, {
            headers: { Authorization: `Bearer ${userAccessToken}` },
        });
        const data = await response.json() as { code: number; msg: string; data?: FeishuUserInfo };

        if (data.code !== 0 || !data.data) {
            throw new Error(`Feishu getUserInfo failed: ${data.msg}`);
        }

        return data.data;
    }

    /**
     * 组织（租户）门禁：仅允许 FEISHU_TENANT_KEY 指定的飞书企业成员登录。
     * fail-closed：未配置 FEISHU_TENANT_KEY、用户无 tenant_key、或不匹配，一律拒绝。
     */
    isTenantAllowed(tenantKey: string | undefined): boolean {
        const allowed = feishuEnv.FEISHU_TENANT_KEY.trim();
        if (!allowed) {
            console.warn('[FeishuService] FEISHU_TENANT_KEY 未配置，组织门禁默认拒绝全部飞书登录（fail-closed）');
            return false;
        }
        return Boolean(tenantKey) && tenantKey === allowed;
    }

    /**
     * 读取飞书角色映射文件（用户 → 角色/机构分层授权）。
     * 文件缺失/损坏时返回空数组（回退到白名单 + 业务员映射，不阻断登录链路）。
     */
    private async loadRoleMapping(): Promise<FeishuRoleMappingEntry[]> {
        const mappingPath = getFeishuRoleMappingPath();
        try {
            const raw = await fs.readFile(mappingPath, 'utf8');
            const root = JSON.parse(raw);
            const users = Array.isArray(root.users) ? root.users : [];
            return users.filter((entry: any) => {
                if (!entry || typeof entry !== 'object' || !entry.feishu || typeof entry.role !== 'string' || !entry.role) {
                    console.warn('[FeishuService] 角色映射存在非法条目（缺 feishu 标识或 role），已跳过');
                    return false;
                }
                if (entry.role === 'org_user' && !entry.organization) {
                    console.warn('[FeishuService] 角色映射 org_user 条目缺 organization，已跳过');
                    return false;
                }
                if (entry.branchCode !== undefined && (typeof entry.branchCode !== 'string' || !isValidBranchCodeFormat(entry.branchCode))) {
                    console.warn(`[FeishuService] 角色映射条目 branchCode='${entry.branchCode}' 格式非法（须 CHAR(2) 大写字母），已跳过整条（fail-closed，不回退全局默认）`);
                    return false;
                }
                return true;
            });
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.warn(`[FeishuService] 角色映射加载失败（${mappingPath}）：${error.message}`);
            }
            return [];
        }
    }

    /**
     * 解析权限，按优先级三层：
     * 1. 角色映射文件（getFeishuRoleMappingPath()，按人分层授权的唯一事实源；
     *    条目可带 username/branchCode 覆盖默认值，role='deny' 命中即拒绝）
     * 2. 管理员白名单 env FEISHU_ADMIN_USERIDS（bootstrap 用，映射文件就绪后可清空）
     * 3. 业务员映射表（与既有密码登录共用，兜底为 org_user；
     *    默认关闭，需显式 FEISHU_SALESMAN_FALLBACK=true 启用——姓名匹配有重名误授权风险）
     * 均不匹配返回 null（拒绝登录）。
     */
    async resolvePermission(userInfo: FeishuUserInfo): Promise<Omit<UserCredential, 'passwordHash'> | null> {
        const name = userInfo.name || userInfo.en_name;
        const username = userInfo.user_id || userInfo.open_id;
        if (!username) return null;

        const identities = [
            userInfo.user_id,
            userInfo.open_id,
            userInfo.union_id,
            userInfo.email,
            userInfo.enterprise_email,
            userInfo.mobile ? normalizeMobile(userInfo.mobile) : undefined,
        ].filter(Boolean) as string[];

        // 多省 RLS fail-closed：token 缺 branchCode 会被 permission 中间件 401，必须显式携带。
        // FEISHU_DEFAULT_BRANCH 显式设置时优先；留空跟随部署省份 BRANCH_CODE
        const branchCode = feishuEnv.FEISHU_DEFAULT_BRANCH
            ? resolveBranchCode(feishuEnv.FEISHU_DEFAULT_BRANCH, 'feishu-login')
            : getDeploymentBranchCode();

        // 1. 角色映射文件（分层授权：不同员工 → 不同角色/机构）
        const roleMapping = await this.loadRoleMapping();
        const mapped = roleMapping.find(entry => {
            const keys = [
                entry.feishu.user_id,
                entry.feishu.open_id,
                entry.feishu.email,
                entry.feishu.mobile ? normalizeMobile(entry.feishu.mobile) : undefined,
            ].filter(Boolean) as string[];
            return keys.some(key => identities.includes(key));
        });
        if (mapped) {
            // 显式拒绝条目：重名兜底拦截，命中即拒绝（不再落入白名单/业务员映射）
            if (mapped.role === 'deny') {
                console.warn(`[FeishuService] 用户 ${mapped.displayName || username} 命中角色映射 deny 条目，拒绝登录`);
                return null;
            }
            return {
                username: mapped.username || username,
                displayName: mapped.displayName || name || username,
                role: mapped.role,
                ...(mapped.organization ? { organization: mapped.organization } : {}),
                branchCode: mapped.branchCode || branchCode,
            };
        }

        // 2. 检查超级管理员白名单（支持 user_id / open_id / 手机号 / 邮箱）
        const adminIds = feishuEnv.FEISHU_ADMIN_USERIDS
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

        if (adminIds.some(id => identities.includes(id) || identities.includes(normalizeMobile(id)))) {
            return {
                username,
                displayName: name || username,
                role: 'branch_admin',
                branchCode,
            };
        }

        // 3. 检查业务员映射（与既有密码登录共用一份映射：warehouse 优先，server/data 兜底）
        // 默认关闭（fail-closed）：按姓名匹配有重名误授权风险，显式 FEISHU_SALESMAN_FALLBACK=true 才启用
        if (feishuEnv.FEISHU_SALESMAN_FALLBACK !== 'true') {
            return null;
        }
        const mappingPaths = getSalesmanMappingPaths();
        for (const mappingPath of mappingPaths) {
            try {
                const data = await fs.readFile(mappingPath, 'utf8');
                const root = JSON.parse(data);
                const mappingList = root.salesman_mapping || [];

                const orgData = mappingList.find(
                  (item: any) => item.business_no === username || (name && item.salesman_name === name)
                );

                if (orgData) {
                    return {
                        username,
                        displayName: name || username,
                        role: 'org_user',
                        organization: orgData.organization || orgData.team || orgData.branch,
                        branchCode,
                    };
                }

                // 读取成功但未命中，直接结束，不需要继续 fallback
                return null;
            } catch (error: any) {
                console.warn(`[FeishuService] Mapping load failed at ${mappingPath}: ${error.message}`);
            }
        }

        // 不在管理员且没有机构匹配
        return null;
    }
}

export const feishuService = new FeishuService();
