import crypto from 'crypto';

interface RouteCacheEntry<T> {
    data: T;
    etag: string;
    expiry: number;
}

const routeResponseCache = new Map<string, RouteCacheEntry<unknown>>();

export function computeEtag(data: unknown): string {
    const json = JSON.stringify(data);
    return `"${crypto.createHash('md5').update(json).digest('hex').slice(0, 16)}"`;
}

export function getRouteCache<T>(key: string): T | null {
    const entry = routeResponseCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        routeResponseCache.delete(key);
        return null;
    }
    return entry.data as T;
}

export function setRouteCache<T>(key: string, data: T, ttlMs: number): void {
    // 限制最大缓存条目数防止内存泄漏
    if (routeResponseCache.size >= 2000) {
        const oldestKey = routeResponseCache.keys().next().value;
        if (oldestKey) {
            routeResponseCache.delete(oldestKey);
        }
    }
    routeResponseCache.set(key, {
        data,
        etag: computeEtag(data),
        expiry: Date.now() + ttlMs,
    });
}

/**
 * 发送带 ETag + Cache-Control 的 JSON 响应。
 * 若客户端 If-None-Match 命中则返回 304。
 */
export function sendWithEtag(req: any, res: any, body: unknown, maxAgeSec: number): void {
    const etag = computeEtag(body);
    res.set('ETag', etag);
    res.set('Cache-Control', `private, max-age=${maxAgeSec}, stale-while-revalidate=60`);
    if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
    }
    res.json(body);
}

export function clearRouteCache(): void {
    routeResponseCache.clear();
}
