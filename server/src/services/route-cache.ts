import crypto from 'crypto';
import { LRUCache } from 'lru-cache';

interface RouteCacheEntry<T> {
    data: T;
    etag: string;
    sizeBytes: number;
}

const DEFAULT_MAX_TOTAL_BYTES = 400 * 1024 * 1024; // 400MB
const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_MAX_ENTRY_BYTES = 2 * 1024 * 1024;   // 2MB

const MAX_TOTAL_BYTES = Number(process.env.ROUTE_CACHE_MAX_BYTES) || DEFAULT_MAX_TOTAL_BYTES;
const MAX_ENTRIES = Number(process.env.ROUTE_CACHE_MAX_ENTRIES) || DEFAULT_MAX_ENTRIES;
const MAX_ENTRY_BYTES = Number(process.env.ROUTE_CACHE_MAX_ENTRY_BYTES) || DEFAULT_MAX_ENTRY_BYTES;

let _hits = 0;
let _misses = 0;
let _evictions = 0;

const cache = new LRUCache<string, RouteCacheEntry<unknown>>({
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

function estimateSize(data: unknown): number {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    return Buffer.byteLength(json, 'utf8');
}

export function getRouteCache<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) { _misses++; return null; }
    _hits++;
    return entry.data as T;
}

export function setRouteCache<T>(key: string, data: T, ttlMs: number): void {
    const sizeBytes = estimateSize(data);
    if (sizeBytes > MAX_ENTRY_BYTES) return;
    cache.set(
        key,
        { data, etag: computeEtag(data), sizeBytes },
        { ttl: ttlMs },
    );
}

/**
 * 发送带 ETag + Cache-Control 的 JSON 响应。
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
