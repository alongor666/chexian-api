import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRouteCache,
  getRouteCacheEntry,
  setRouteCache,
  clearRouteCache,
  computeEtag,
  getRouteCacheStats,
} from '../route-cache.js';

describe('route-cache (lru-cache + buffer)', () => {
  beforeEach(() => {
    clearRouteCache();
  });

  it('miss → set → hit (getRouteCache 返回 parsed data)', () => {
    expect(getRouteCache('k1')).toBeNull();
    setRouteCache('k1', { x: 1 }, 60_000);
    expect(getRouteCache('k1')).toEqual({ x: 1 });
  });

  it('getRouteCacheEntry 返回 entry，含 jsonBuffer + brotliBuffer', () => {
    setRouteCache('e1', { x: 1 }, 60_000);
    const entry = getRouteCacheEntry('e1');
    expect(entry).not.toBeNull();
    expect(entry!.jsonBuffer).toBeInstanceOf(Buffer);
    expect(JSON.parse(entry!.jsonBuffer.toString('utf-8'))).toEqual({ x: 1 });
  });

  it('TTL 过期后命中应返回 null', async () => {
    setRouteCache('k2', { v: 'short' }, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(getRouteCache('k2')).toBeNull();
  });

  it('单条 jsonBuffer 超 maxEntryBytes（>2MB）不缓存', () => {
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

  it('大于 1KB 时预 brotli 压缩，小于阈值时跳过', () => {
    setRouteCache('small', { x: 'y' }, 60_000);
    const small = getRouteCacheEntry('small');
    expect(small!.brotliBuffer).toBeNull();

    const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, val: 'a'.repeat(50) })) };
    setRouteCache('big', big, 60_000);
    const bigEntry = getRouteCacheEntry('big');
    expect(bigEntry!.brotliBuffer).toBeInstanceOf(Buffer);
    // brotli 压缩通常比原 JSON 小 50%+
    expect(bigEntry!.brotliBuffer!.length).toBeLessThan(bigEntry!.jsonBuffer.length);
  });

  it('etag 由 jsonBuffer 派生，相同对象产生相同 etag', () => {
    setRouteCache('et1', { a: 1, b: 2 }, 60_000);
    const e1 = getRouteCacheEntry('et1')!.etag;
    setRouteCache('et2', { a: 1, b: 2 }, 60_000);
    const e2 = getRouteCacheEntry('et2')!.etag;
    expect(e1).toBe(e2);
  });
});
