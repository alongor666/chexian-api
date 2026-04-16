import crypto from 'crypto';

interface RouteCacheEntry<T> {
    data: T;
    etag: string;
    expiry: number;
    sizeBytes: number;
}

/** 缓存配置：字节上限 50MB，单条上限 500KB，条目上限 200 */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 500 * 1024;
const MAX_ENTRIES = 200;

const routeResponseCache = new Map<string, RouteCacheEntry<unknown>>();
let totalBytes = 0;

/** 缓存指标（供 health detail 端点使用） */
let _hits = 0;
let _misses = 0;
let _evictions = 0;

export function getRouteCacheStats() {
    return { size: routeResponseCache.size, totalBytes, hits: _hits, misses: _misses, evictions: _evictions };
}

export function computeEtag(data: unknown): string {
    const json = JSON.stringify(data);
    return `"${crypto.createHash('md5').update(json).digest('hex').slice(0, 16)}"`;
}

function estimateSize(data: unknown): number {
    // 快速估算：JSON 序列化后的字节数（UTF-8）
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    return Buffer.byteLength(json, 'utf8');
}

/** 驱逐 LRU 条目直到满足字节/条目限制 */
function evictUntilFits(neededBytes: number): void {
    while (
        routeResponseCache.size > 0 &&
        (totalBytes + neededBytes > MAX_TOTAL_BYTES || routeResponseCache.size >= MAX_ENTRIES)
    ) {
        const lruKey = routeResponseCache.keys().next().value;
        if (!lruKey) break;
        const evicted = routeResponseCache.get(lruKey);
        if (evicted) totalBytes -= evicted.sizeBytes;
        routeResponseCache.delete(lruKey);
        _evictions++;
    }
}

/** 清理已过期条目（写入时顺带执行，避免累积） */
function purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of routeResponseCache) {
        if (now > entry.expiry) {
            totalBytes -= entry.sizeBytes;
            routeResponseCache.delete(key);
        }
    }
}

export function getRouteCache<T>(key: string): T | null {
    const entry = routeResponseCache.get(key);
    if (!entry) { _misses++; return null; }
    if (Date.now() > entry.expiry) {
        totalBytes -= entry.sizeBytes;
        routeResponseCache.delete(key);
        _misses++;
        return null;
    }
    // LRU: 访问时 delete→set 移到 Map 末尾
    routeResponseCache.delete(key);
    routeResponseCache.set(key, entry);
    _hits++;
    return entry.data as T;
}

export function setRouteCache<T>(key: string, data: T, ttlMs: number): void {
    const sizeBytes = estimateSize(data);
    // 单条超限 → 不缓存
    if (sizeBytes > MAX_ENTRY_BYTES) return;

    // 已存在则先移除旧条目（释放字节配额）
    const existing = routeResponseCache.get(key);
    if (existing) {
        totalBytes -= existing.sizeBytes;
        routeResponseCache.delete(key);
    }

    // 写入前清理过期条目 + LRU 驱逐
    purgeExpired();
    evictUntilFits(sizeBytes);

    routeResponseCache.set(key, {
        data,
        etag: computeEtag(data),
        expiry: Date.now() + ttlMs,
        sizeBytes,
    });
    totalBytes += sizeBytes;
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
    routeResponseCache.clear();
    totalBytes = 0;
    _hits = 0;
    _misses = 0;
    _evictions = 0;
}
