import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRouteCache,
  setRouteCache,
  clearRouteCache,
  computeEtag,
  getRouteCacheStats,
} from '../route-cache.js';

describe('route-cache (lru-cache backed)', () => {
  beforeEach(() => {
    clearRouteCache();
  });

  it('miss → set → hit', () => {
    expect(getRouteCache('k1')).toBeNull();
    setRouteCache('k1', { x: 1 }, 60_000);
    expect(getRouteCache('k1')).toEqual({ x: 1 });
  });

  it('TTL 过期后命中应返回 null', async () => {
    setRouteCache('k2', { v: 'short' }, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(getRouteCache('k2')).toBeNull();
  });

  it('单条超 maxEntryBytes（>2MB）不缓存', () => {
    const huge = { data: 'x'.repeat(3 * 1024 * 1024) };
    setRouteCache('huge', huge, 60_000);
    expect(getRouteCache('huge')).toBeNull();
  });

  it('clearRouteCache 清空全部条目', () => {
    setRouteCache('a', 1, 60_000);
    setRouteCache('b', 2, 60_000);
    expect(getRouteCacheStats().size).toBe(2);
    clearRouteCache();
    expect(getRouteCacheStats().size).toBe(0);
  });

  it('hits/misses 计数', () => {
    setRouteCache('hit', 'v', 60_000);
    getRouteCache('hit');
    getRouteCache('hit');
    getRouteCache('miss-key');
    const stats = getRouteCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it('computeEtag 同输入幂等', () => {
    const e1 = computeEtag({ a: 1, b: 2 });
    const e2 = computeEtag({ a: 1, b: 2 });
    expect(e1).toBe(e2);
    expect(e1).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('容量上限通过环境变量可调（默认 400MB / 5000 条）', () => {
    const stats = getRouteCacheStats();
    expect(stats.maxBytes).toBeGreaterThanOrEqual(400 * 1024 * 1024);
    expect(stats.maxEntries).toBe(5000);
  });
});
