import React from 'react';
import { ApiTokensPanel } from './ApiTokensPanel';

/**
 * API 令牌（PAT）自助管理页 — /my-tokens
 *
 * 2026-07-15 从权限管理页（/admin/access-control 的「我的 API Token」页签）拆出为独立页面：
 * 权限管理模块收紧到指名白名单（RESTRICTED_MODULES）后，总经理室/车险部全员仍需 PAT 自助入口。
 * 后端 /api/auth/tokens 本就对全部会话用户开放，PAT 权限完全继承用户本人（dataScope/allowedRoutes），
 * 故本页对所有已登录用户可见（routeRegistry PERSONAL_ROUTES）。
 */
export const MyTokensPage: React.FC = () => (
  <div className="p-6 space-y-6">
    <div>
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">API 令牌</h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
        创建与管理你的个人访问令牌（PAT），用于 CLI / MCP / 脚本等程序化只读访问；令牌权限与你的账号完全一致
      </p>
    </div>
    <ApiTokensPanel />
  </div>
);
