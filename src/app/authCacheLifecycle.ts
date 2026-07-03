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
 */
export function registerAuthCacheClearing(queryClient: QueryClient): () => void {
  const clearAllCacheLayers = () => {
    queryClient.clear();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'FORCE_REFRESH' });
    }
  };
  window.addEventListener('auth-logout', clearAllCacheLayers);
  window.addEventListener('auth-login', clearAllCacheLayers);
  return () => {
    window.removeEventListener('auth-logout', clearAllCacheLayers);
    window.removeEventListener('auth-login', clearAllCacheLayers);
  };
}
