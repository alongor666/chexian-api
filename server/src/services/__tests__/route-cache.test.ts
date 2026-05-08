import { describe, it, expect, beforeEach } from 'vitest';
import { gunzipSync } from 'zlib';
import {
  getRouteCache,
  getRouteCacheEntry,
  setRouteCache,
  clearRouteCache,
  computeEtag,
  getRouteCacheStats,
  sendCachedEntry,
} from '../route-cache.js';

interface MockRes {
  headers: Record<string, string>;
  body: Buffer | null;
  ended: boolean;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  end(buf?: Buffer): void;
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  return {
    headers,
    body: null,
    ended: false,
    setHeader(name, value) { headers[name] = value; },
    getHeader(name) { return headers[name]; },
    end(buf?: Buffer) { this.body = buf ?? null; this.ended = true; },
  };
}

function bigPayload() {
  // > 1KB 触发预压缩；冗余字符串保证 br/gzip 都能显著压缩
  return { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, val: 'a'.repeat(50) })) };
}

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

  it('大于 1KB 时同时预 gzip 压缩，且体积小于原 JSON', () => {
    setRouteCache('gz', bigPayload(), 60_000);
    const entry = getRouteCacheEntry('gz')!;
    expect(entry.gzipBuffer).toBeInstanceOf(Buffer);
    expect(entry.gzipBuffer!.length).toBeLessThan(entry.jsonBuffer.length);
    // entry.sizeBytes 应包含 raw + br + gzip 三者总和
    expect(entry.sizeBytes).toBe(
      entry.jsonBuffer.length + (entry.brotliBuffer?.length ?? 0) + entry.gzipBuffer!.length,
    );
  });

  describe('sendCachedEntry 三态协商', () => {
    it('Accept-Encoding: gzip 命中 → Content-Encoding: gzip + 解压回原 JSON', () => {
      setRouteCache('s-gzip', bigPayload(), 60_000);
      const entry = getRouteCacheEntry('s-gzip')!;
      const res = makeRes();
      sendCachedEntry({ headers: { 'accept-encoding': 'gzip' } }, res, entry, entry.etag, 60);

      expect(res.headers['Content-Encoding']).toBe('gzip');
      expect(res.headers['Content-Length']).toBe(String(entry.gzipBuffer!.length));
      expect(res.headers['Vary']).toContain('Accept-Encoding');
      expect(res.headers['ETag']).toBe(entry.etag);
      const decoded = JSON.parse(gunzipSync(res.body!).toString('utf-8'));
      expect(decoded).toEqual(bigPayload());
    });

    it('Accept-Encoding: br;q=0, gzip 应回退到 gzip（q-value 解析）', () => {
      setRouteCache('s-brq0', bigPayload(), 60_000);
      const entry = getRouteCacheEntry('s-brq0')!;
      const res = makeRes();
      sendCachedEntry(
        { headers: { 'accept-encoding': 'br;q=0, gzip' } },
        res,
        entry,
        entry.etag,
        60,
      );

      expect(res.headers['Content-Encoding']).toBe('gzip');
      expect(res.body).toEqual(entry.gzipBuffer);
    });

    it('Accept-Encoding: identity 命中 → 走 raw jsonBuffer，无 Content-Encoding', () => {
      setRouteCache('s-raw', bigPayload(), 60_000);
      const entry = getRouteCacheEntry('s-raw')!;
      const res = makeRes();
      sendCachedEntry({ headers: { 'accept-encoding': 'identity' } }, res, entry, entry.etag, 60);

      expect(res.headers['Content-Encoding']).toBeUndefined();
      expect(res.headers['Content-Length']).toBe(String(entry.jsonBuffer.length));
      expect(res.body).toEqual(entry.jsonBuffer);
    });

    it('Accept-Encoding: br 命中 → 优先返回 brotliBuffer（回归用例）', () => {
      setRouteCache('s-br', bigPayload(), 60_000);
      const entry = getRouteCacheEntry('s-br')!;
      const res = makeRes();
      sendCachedEntry({ headers: { 'accept-encoding': 'br' } }, res, entry, entry.etag, 60);

      expect(res.headers['Content-Encoding']).toBe('br');
      expect(res.body).toEqual(entry.brotliBuffer);
    });

    it('Accept-Encoding: gzip;q=1, br;q=0.1 → 选 gzip（修 Codex P2 q-value 偏好）', () => {
      setRouteCache('s-q-gzip', bigPayload(), 60_000);
      const entry = getRouteCacheEntry('s-q-gzip')!;
      const res = makeRes();
      sendCachedEntry(
        { headers: { 'accept-encoding': 'gzip;q=1, br;q=0.1' } },
        res,
        entry,
        entry.etag,
        60,
      );

      expect(res.headers['Content-Encoding']).toBe('gzip');
      expect(res.body).toEqual(entry.gzipBuffer);
    });

    it('Accept-Encoding: br;q=1, gzip;q=0.5 → 选 br（q 高者胜）', () => {
      setRouteCache('s-q-br', bigPayload(), 60_000);
      const entry = getRouteCacheEntry('s-q-br')!;
      const res = makeRes();
      sendCachedEntry(
        { headers: { 'accept-encoding': 'br;q=1, gzip;q=0.5' } },
        res,
        entry,
        entry.etag,
        60,
      );

      expect(res.headers['Content-Encoding']).toBe('br');
      expect(res.body).toEqual(entry.brotliBuffer);
    });

    it('小 payload (< 1KB) 无预压缩 buffer → 直接发 raw 不会空响应', () => {
      setRouteCache('s-tiny', { x: 1 }, 60_000);
      const entry = getRouteCacheEntry('s-tiny')!;
      // 双重保险：tiny payload 不应有预压缩
      expect(entry.brotliBuffer).toBeNull();
      expect(entry.gzipBuffer).toBeNull();

      const res = makeRes();
      sendCachedEntry(
        { headers: { 'accept-encoding': 'br, gzip' } },
        res,
        entry,
        entry.etag,
        60,
      );
      expect(res.headers['Content-Encoding']).toBeUndefined();
      expect(res.body).toEqual(entry.jsonBuffer);
    });
  });
});
