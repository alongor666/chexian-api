import crypto from 'crypto';
import { brotliCompressSync, constants, gzipSync } from 'zlib';
import { LRUCache } from 'lru-cache';
import { clientAcceptsBrotli, clientAcceptsGzip } from '../utils/accept-encoding.js';

/**
 * 缓存条目存预序列化的 JSON Buffer + 预 brotli/gzip 压缩后的 Buffer。
 * 命中时直接 res.end(buffer)，省掉 JSON.stringify（5MB bundle ≈ 30-50ms）+ 压缩（≈ 20ms）。
 * gzipBuffer 兜底不支持 br 的客户端（严格代理、CDN、Accept-Encoding: br;q=0）。
 */
interface RouteCacheEntry {
    jsonBuffer: Buffer;
    brotliBuffer: Buffer | null;
    gzipBuffer: Buffer | null;
    etag: string;
    sizeBytes: number;
}

const DEFAULT_MAX_TOTAL_BYTES = 400 * 1024 * 1024; // 400MB
const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_MAX_ENTRY_BYTES = 2 * 1024 * 1024;   // 2MB（仅按 jsonBuffer 计）
const COMPRESS_THRESHOLD = 1024;
const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 6; // zlib 默认；与 Express compression 中间件同级

const MAX_TOTAL_BYTES = Number(process.env.ROUTE_CACHE_MAX_BYTES) || DEFAULT_MAX_TOTAL_BYTES;
const MAX_ENTRIES = Number(process.env.ROUTE_CACHE_MAX_ENTRIES) || DEFAULT_MAX_ENTRIES;
const MAX_ENTRY_BYTES = Number(process.env.ROUTE_CACHE_MAX_ENTRY_BYTES) || DEFAULT_MAX_ENTRY_BYTES;

let _hits = 0;
let _misses = 0;
let _evictions = 0;

const cache = new LRUCache<string, RouteCacheEntry>({
    max: MAX_ENTRIES,
    maxSize: MAX_TOTAL_BYTES,
    sizeCalculation: (entry) => entry.sizeBytes,
    dispose: (_value, _key, reason) => {
        if (reason === 'evict' || reason === 'set') _evictions++;
    },
});

export function getRouteCacheStats() {
    return {
        size: cache.size,
        totalBytes: cache.calculatedSize,
        hits: _hits,
        misses: _misses,
        evictions: _evictions,
        maxBytes: MAX_TOTAL_BYTES,
        maxEntries: MAX_ENTRIES,
    };
}

export function computeEtag(data: unknown): string {
    const json = JSON.stringify(data);
    return `"${crypto.createHash('md5').update(json).digest('hex').slice(0, 16)}"`;
}

/**
 * 返回完整缓存条目（含预序列化 Buffer + 预 brotli），供 fast-path
 * 直接 res.end(buffer) 使用，省掉 stringify + 压缩。withRouteCache 使用此 API。
 */
export function getRouteCacheEntry(key: string): RouteCacheEntry | null {
    const entry = cache.get(key);
    if (!entry) { _misses++; return null; }
    _hits++;
    return entry;
}

/**
 * 返回反序列化后的对象（向后兼容老调用方：bundles.ts / comprehensive.ts）。
 * 内部 JSON.parse(jsonBuffer)，比 V8 直接持对象稍慢但内存占用减半。
 * 性能优先路径请改用 getRouteCacheEntry + sendCachedEntry。
 */
export function getRouteCache<T = unknown>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) { _misses++; return null; }
    _hits++;
    try {
        return JSON.parse(entry.jsonBuffer.toString('utf-8')) as T;
    } catch {
        return null;
    }
}

export function setRouteCache(key: string, data: unknown, ttlMs: number): void {
    const json = JSON.stringify(data);
    const jsonBuffer = Buffer.from(json, 'utf-8');
    if (jsonBuffer.length > MAX_ENTRY_BYTES) return;

    let brotliBuffer: Buffer | null = null;
    let gzipBuffer: Buffer | null = null;
    if (jsonBuffer.length >= COMPRESS_THRESHOLD) {
        try {
            brotliBuffer = brotliCompressSync(jsonBuffer, {
                params: {
                    [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
                    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                },
            });
        } catch {
            brotliBuffer = null;
        }
        try {
            gzipBuffer = gzipSync(jsonBuffer, { level: GZIP_LEVEL });
        } catch {
            gzipBuffer = null;
        }
    }

    const etag = `"${crypto.createHash('md5').update(jsonBuffer).digest('hex').slice(0, 16)}"`;
    const sizeBytes =
        jsonBuffer.length + (brotliBuffer?.length ?? 0) + (gzipBuffer?.length ?? 0);

    cache.set(
        key,
        { jsonBuffer, brotliBuffer, gzipBuffer, etag, sizeBytes },
        { ttl: ttlMs },
    );
}

function appendVary(res: any, value: string): void {
    const existing = res.getHeader('Vary');
    const varies = new Set(
        (existing ? String(existing).split(/,\s*/).filter(Boolean) : []).concat(value),
    );
    res.setHeader('Vary', Array.from(varies).join(', '));
}

/**
 * 发送已缓存条目：根据 Accept-Encoding 优先级 br > gzip > raw 选缓冲，
 * 直接 res.end 绕过 res.json + 中间件的二次序列化和压缩。
 * gzip 兜底用于不支持 br 的客户端（严格代理、CDN、br;q=0），避免吞流量发 raw。
 */
export function sendCachedEntry(
    req: any,
    res: any,
    entry: RouteCacheEntry,
    etag: string,
    maxAgeSec: number,
): void {
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', `private, max-age=${maxAgeSec}, stale-while-revalidate=3600`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const ae = req.headers['accept-encoding'];
    if (entry.brotliBuffer && clientAcceptsBrotli(ae)) {
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Length', String(entry.brotliBuffer.length));
        appendVary(res, 'Accept-Encoding');
        res.end(entry.brotliBuffer);
        return;
    }

    if (entry.gzipBuffer && clientAcceptsGzip(ae)) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', String(entry.gzipBuffer.length));
        appendVary(res, 'Accept-Encoding');
        res.end(entry.gzipBuffer);
        return;
    }

    res.setHeader('Content-Length', String(entry.jsonBuffer.length));
    res.end(entry.jsonBuffer);
}

/**
 * 发送带 ETag + Cache-Control 的 JSON 响应（兼容老路径，无 LRU）。
 * 若客户端 If-None-Match 命中则返回 304。
 */
export function sendWithEtag(req: any, res: any, body: unknown, maxAgeSec: number): void {
    const etag = computeEtag(body);
    res.set('ETag', etag);
    res.set('Cache-Control', `private, max-age=${maxAgeSec}, stale-while-revalidate=3600`);
    if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
    }
    res.json(body);
}

export function clearRouteCache(): void {
    cache.clear();
    _hits = 0;
    _misses = 0;
    _evictions = 0;
}
