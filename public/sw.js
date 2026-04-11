/**
 * Service Worker — Phase 2: 离线优先 + 预取
 *
 * 策略: stale-while-revalidate（仅 /api/query/* 路由）
 * - 缓存命中 → 立即返回 (0ms) + 后台静默更新
 * - 缓存未命中 → 透传到 Express → 缓存响应
 * - 离线 → 直接返回缓存
 * - 每日轮询 /api/data/version → 版本变化 → 清空缓存 → 预取热点
 */

const CACHE_NAME = 'chexian-api-v1';
const VERSION_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

// 仅缓存 query 路由（不缓存 auth/data/ai/filters）
const CACHEABLE_PATTERN = /\/api\/query\//;

// 热点预取列表
const PREFETCH_PATHS = [
  '/api/query/dashboard-bundle?timeView=daily&perspective=premium&rankingLimit=10',
  '/api/query/performance-bundle?timePeriod=day&growthMode=mom&expandDims=none&limit=20',
];

let lastKnownEtlDate = null;
let lastVersionCheck = 0;

// ── Install 事件 ─────────────────────────────

self.addEventListener('install', (event) => {
  // 新 SW 安装后不强制 skipWaiting，避免页面闪烁
  // 用户下次刷新时自然切换到新版 SW
  event.waitUntil(caches.open(CACHE_NAME));
});

// ── Activate 事件 ────────────────────────────

self.addEventListener('activate', (event) => {
  // 清理旧版本缓存
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  // 立即接管所有客户端
  self.clients.claim();
});

// ── Fetch 拦截 ───────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只拦截同源的 /api/query/* GET 请求
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !CACHEABLE_PATTERN.test(url.pathname)
  ) {
    return;
  }

  event.respondWith(handleQueryRequest(event.request));
});

/**
 * stale-while-revalidate 策略
 */
async function handleQueryRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = buildCacheKey(request);

  // 1. 尝试从缓存读取
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    const cachedTime = cachedResponse.headers.get('X-SW-Cached-At');
    const isExpired = cachedTime && (Date.now() - parseInt(cachedTime, 10)) > CACHE_TTL;

    // 离线时直接返回缓存（不管是否过期）
    if (!navigator.onLine) {
      return addSwHeaders(cachedResponse.clone(), 'cache-offline');
    }

    // 后台静默更新（不阻塞响应）
    refreshInBackground(request, cache, cacheKey);

    // 触发版本检查（限频）
    maybeCheckVersion();

    return addSwHeaders(cachedResponse.clone(), isExpired ? 'cache-stale' : 'cache-hit');
  }

  // 2. 缓存未命中 → 网络请求 + 缓存响应
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseToCache = await addTimestamp(networkResponse.clone());
      cache.put(cacheKey, responseToCache);
    }
    return addSwHeaders(networkResponse, 'network');
  } catch (err) {
    // 网络失败且无缓存 → 返回错误
    return new Response(
      JSON.stringify({ success: false, error: 'Offline and no cache available' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── 后台静默更新 ─────────────────────────────

async function refreshInBackground(request, cache, cacheKey) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseToCache = await addTimestamp(networkResponse.clone());
      await cache.put(cacheKey, responseToCache);
    }
  } catch {
    // 后台更新失败不影响用户
  }
}

// ── 版本检查 ─────────────────────────────────

async function maybeCheckVersion() {
  const now = Date.now();
  if (now - lastVersionCheck < VERSION_CHECK_INTERVAL) return;
  lastVersionCheck = now;

  try {
    const res = await fetch('/api/data/version');
    if (!res.ok) return;

    const body = await res.json();
    const etlDate = body.data?.etlDate;

    if (lastKnownEtlDate && etlDate && etlDate !== lastKnownEtlDate) {
      // ETL 数据更新了 → 清空缓存 + 预取
      await clearAndPrefetch();
    }

    lastKnownEtlDate = etlDate;
  } catch {
    // 版本检查失败不影响服务
  }
}

async function clearAndPrefetch() {
  const cache = await caches.open(CACHE_NAME);

  // 清空所有缓存
  const keys = await cache.keys();
  await Promise.all(keys.map((key) => cache.delete(key)));

  // 预取热点 bundle（使用当前活跃客户端的 token）
  const clients = await self.clients.matchAll({ type: 'window' });
  if (clients.length === 0) return;

  // 通知客户端数据已更新
  for (const client of clients) {
    client.postMessage({ type: 'ETL_UPDATED', etlDate: lastKnownEtlDate });
  }
}

// ── 工具函数 ─────────────────────────────────

/**
 * 构建缓存 key：URL（含 query params）
 * 注意：Authorization header 不作为 key 的一部分，
 * 因为 Cache API 默认忽略 Vary: Authorization，
 * 且同一浏览器同一时间只有一个用户登录。
 */
function buildCacheKey(request) {
  return new Request(request.url, { method: 'GET' });
}

/**
 * 给缓存的响应添加时间戳 header
 */
async function addTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('X-SW-Cached-At', String(Date.now()));
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 给响应添加 SW 来源标识 header
 */
function addSwHeaders(response, source) {
  const headers = new Headers(response.headers);
  headers.set('X-SW-Source', source);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── 消息处理（前端可主动触发清空/预取）──────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'FORCE_REFRESH') {
    clearAndPrefetch();
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
