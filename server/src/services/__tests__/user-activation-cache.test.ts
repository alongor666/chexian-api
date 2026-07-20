/**
 * user-activation-cache 单测：JWT 实时吊销的纯缓存层
 * 覆盖 fail-open（未就绪）/ 命中 / 未命中 / 重建（禁用生效）/ 空集合（全禁用）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUserAllowedRoutes,
  isUsernameActive,
  setActiveUsernames,
  setUserAuthorizationCache,
  __resetActiveUsernamesCacheForTest,
} from '../user-activation-cache.js';

describe('user-activation-cache', () => {
  beforeEach(() => {
    __resetActiveUsernamesCacheForTest();
  });

  it('缓存未就绪（null）→ fail-open 返回 true（绝不因缓存缺失误锁全站）', () => {
    expect(isUsernameActive('anyone')).toBe(true);
  });

  it('setActiveUsernames 后：集合内 true、集合外 false', () => {
    setActiveUsernames(['alice', 'bob']);
    expect(isUsernameActive('alice')).toBe(true);
    expect(isUsernameActive('bob')).toBe(true);
    expect(isUsernameActive('carol')).toBe(false); // 不存在/已删除
  });

  it('重建集合（禁用 bob）→ bob 立即失效，alice 不受影响', () => {
    setActiveUsernames(['alice', 'bob']);
    setActiveUsernames(['alice']);
    expect(isUsernameActive('bob')).toBe(false);
    expect(isUsernameActive('alice')).toBe(true);
  });

  it('空集合（全部禁用）→ 任何人 false（区别于未就绪的 fail-open）', () => {
    setActiveUsernames([]);
    expect(isUsernameActive('alice')).toBe(false);
  });

  it('setUserAuthorizationCache 原子重建 active 与用户级 allowedRoutes', () => {
    setUserAuthorizationCache([
      { username: 'alice', active: true, allowedRoutes: ['/home'] },
      { username: 'bob', active: false, allowedRoutes: ['/cost'] },
      { username: 'carol', active: true },
    ]);

    expect(isUsernameActive('alice')).toBe(true);
    expect(isUsernameActive('bob')).toBe(false);
    expect(getUserAllowedRoutes('alice')).toEqual(['/home']);
    expect(getUserAllowedRoutes('bob')).toEqual(['/cost']);
    expect(getUserAllowedRoutes('carol')).toBeUndefined();
  });

  it('getUserAllowedRoutes 返回副本，请求侧修改不污染全局缓存', () => {
    setUserAuthorizationCache([
      { username: 'alice', active: true, allowedRoutes: ['/home'] },
    ]);
    const routes = getUserAllowedRoutes('alice');
    routes?.push('/cost');
    expect(getUserAllowedRoutes('alice')).toEqual(['/home']);
  });
});
