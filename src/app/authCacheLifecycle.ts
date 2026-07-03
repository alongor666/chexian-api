import type { QueryClient } from '@tanstack/react-query';

/**
 * 认证生命周期 ↔ 缓存层清理接线。
 *
 * 为什么 auth-login 也要清（不只是 auth-logout）：
 * 换号登录（不点登出直接输新账号，含企微扫码换身份）只派发 auth-login，
 * 前一用户的 SW Cache Storage + React Query 缓存原样保留——SW 缓存键仅 URL、
 * 不含用户身份，后端 `Cache-Control: private` 管不到 SW 层；生产 SW 活跃时
 * staleTime=Infinity，旧缓存永不刷新。dataScope 不同的两个用户先后使用同一
 * 浏览器时构成越权数据泄漏。BACKLOG 2026-07-03-claude-20e132。
 *
 * 为什么监听 auth-login 是安全的（不会误清正常会话）：
 * auth-login 只由三个显式登录动作派发（PermissionContext 的快速登录/密码登录/
 * 企微登录）；页面加载时的会话静默恢复（restoreSession）与 401 token 静默刷新
 * 均不派发该事件。
 *
 * 为什么也监听 auth-session-expired：
 * 会话完全过期（access token 过期且 refresh 失败，client-core.doRefreshSession
 * 派发）时用户即将被送回登录页，残留缓存与下一个登录者（可能是换号）之间没有
 * 任何清理时机——auth-login 虽会兜底，但过期瞬间即清可消除"过期后仍能浏览
 * 旧缓存数据"的窗口。BACKLOG 2026-07-03-claude-c5fe8f。
 */
const AUTH_CACHE_CLEAR_EVENTS = ['auth-logout', 'auth-login', 'auth-session-expired'] as const;

export function registerAuthCacheClearing(queryClient: QueryClient): () => void {
  const clearAllCacheLayers = () => {
    queryClient.clear();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'FORCE_REFRESH' });
    }
  };
  AUTH_CACHE_CLEAR_EVENTS.forEach((ev) => window.addEventListener(ev, clearAllCacheLayers));
  return () => {
    AUTH_CACHE_CLEAR_EVENTS.forEach((ev) => window.removeEventListener(ev, clearAllCacheLayers));
  };
}
