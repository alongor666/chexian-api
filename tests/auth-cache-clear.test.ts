/**
 * 换号登录/登出 → 缓存层清空 防回归测试
 *
 * 背景（BACKLOG 2026-07-03-claude-20e132）：换号登录只派发 auth-login，
 * 历史上仅 auth-logout 清缓存，导致 SW/React Query 缓存跨用户串数据越权。
 * 本测试锁死：auth-login 与 auth-logout 都必须清 React Query 缓存并通知 SW。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { registerAuthCacheClearing } from '../src/app/authCacheLifecycle';

describe('registerAuthCacheClearing', () => {
  let queryClient: QueryClient;
  let cleanup: (() => void) | null = null;
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    postMessageSpy = vi.fn();
    // jsdom 无 serviceWorker，注入最小 mock（controller.postMessage 是被测出口）
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: { postMessage: postMessageSpy } },
      configurable: true,
    });
    cleanup = registerAuthCacheClearing(queryClient);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    // @ts-expect-error 清理 mock
    delete navigator.serviceWorker;
  });

  const seedCache = () => {
    queryClient.setQueryData(['kpi', { org: '机构A' }], { premium: 123 });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  };

  it('auth-logout 清空 React Query 缓存并通知 SW FORCE_REFRESH', () => {
    seedCache();
    window.dispatchEvent(new Event('auth-logout'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'FORCE_REFRESH' });
  });

  it('auth-login（换号不登出路径）同样清空缓存并通知 SW —— 越权残留防回归', () => {
    seedCache();
    window.dispatchEvent(new Event('auth-login'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'FORCE_REFRESH' });
  });

  it('SW controller 不存在时不抛错（首次加载 SW 未接管）', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: null },
      configurable: true,
    });
    seedCache();
    expect(() => window.dispatchEvent(new Event('auth-login'))).not.toThrow();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('cleanup 后不再响应事件', () => {
    cleanup?.();
    cleanup = null;
    seedCache();
    window.dispatchEvent(new Event('auth-login'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });
});
