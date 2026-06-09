/**
 * 鉴权/账号管理子客户端（ApiClient 神类拆分 Phase 2 · auth 域）
 *
 * 挂载点：apiClient.auth.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 * 仅迁入 12 个**无状态** CRUD 端点（用户 / PAT / 角色 / 企微配置），均经
 * t.request 收口（GET/POST/PUT/DELETE 按原动词保留）。
 *
 * ⚠️ 边界（刻意保留在基类 ApiClient，不迁入本子客户端）：
 *    login / logout / getCurrentUser —— 这三个是**会话生命周期**方法，会改写
 *    基类 token 状态（setToken / clearToken / setSessionCookieHint），是 app
 *    bootstrap 关键路径。token 写入只应由持有该状态的类（ApiClientCore/ApiClient）
 *    执行；不把 token 写入方法泄漏进 ApiTransport 句柄（只读 getToken 已够用）。
 */

import { AUTH_ROUTES } from './routes';
import type { ApiTransport } from './client-core';
import type { AccessUser, AccessRole, ApiTokenInfo, CreatedToken } from './types';

export class AuthApi {
  constructor(private readonly t: ApiTransport) {}

  // ── 用户 CRUD ──
  listUsers(): Promise<AccessUser[]> {
    return this.t.request<AccessUser[]>(`/${AUTH_ROUTES.USERS}`);
  }

  createUser(payload: {
    username: string;
    displayName: string;
    password: string;
    role: string;
    organization?: string;
    allowedRoutes?: string[];
    defaultRoute?: string;
    allowedIps?: string[];
    specialFeatures?: string[];
    active?: boolean;
  }): Promise<AccessUser> {
    return this.t.request<AccessUser>(`/${AUTH_ROUTES.USERS}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateUser(
    id: string,
    payload: {
      displayName: string;
      password?: string;
      role: string;
      organization?: string;
      allowedRoutes?: string[];
      defaultRoute?: string;
      allowedIps?: string[];
      specialFeatures?: string[];
      active?: boolean;
    }
  ): Promise<AccessUser> {
    return this.t.request<AccessUser>(`/${AUTH_ROUTES.USER_BY_ID}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.t.request(`/${AUTH_ROUTES.USER_BY_ID}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ── PAT (Personal Access Token) ──
  listMyTokens(): Promise<ApiTokenInfo[]> {
    return this.t.request<ApiTokenInfo[]>('/auth/tokens');
  }

  createMyToken(payload: { name: string; ttlDays: 30 | 90 | 180 | 365 }): Promise<CreatedToken> {
    return this.t.request<CreatedToken>('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async revokeMyToken(tokenId: string): Promise<void> {
    await this.t.request(`/auth/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
  }

  // ── 角色 CRUD ──
  listRoles(): Promise<AccessRole[]> {
    return this.t.request<AccessRole[]>(`/${AUTH_ROUTES.ROLES}`);
  }

  createRole(payload: {
    role: string;
    name: string;
    dataScope: 'all' | 'org' | 'telemarketing';
    allowedRoutes?: string[];
    defaultRoute?: string;
  }): Promise<AccessRole> {
    return this.t.request<AccessRole>(`/${AUTH_ROUTES.ROLES}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateRole(
    role: string,
    payload: {
      name: string;
      dataScope: 'all' | 'org' | 'telemarketing';
      allowedRoutes?: string[];
      defaultRoute?: string;
    }
  ): Promise<AccessRole> {
    return this.t.request<AccessRole>(`/${AUTH_ROUTES.ROLE_BY_ID}/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteRole(role: string): Promise<void> {
    await this.t.request(`/${AUTH_ROUTES.ROLE_BY_ID}/${encodeURIComponent(role)}`, {
      method: 'DELETE',
    });
  }

  // ── 企微登录配置 ──
  getWeComConfig(): Promise<{ corpId: string; agentId: string; callbackUrl: string }> {
    return this.t.request(`/${AUTH_ROUTES.WECOM_CONFIG}`);
  }
}
