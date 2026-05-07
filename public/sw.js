/**
 * Service Worker — Phase C: cache-first + 5min 版本轮询
 *
 * 策略: cache-first（仅 /api/query/* 路由）
 * - 缓存命中且未过期 → 立即返回 (0ms)，不发后台 fetch（消除每页 5-10 次冗余网络往返）
 * - 缓存命中但已过期 → 走网络拉取 + 更新缓存（revalidate-on-expiry）
 * - 缓存未命中 → 网络拉取 + 缓存
 * - 离线 → 即使过期也返回缓存
 * - 每 5 分钟轮询 /api/data/version → 版本变化 → 清空缓存 + 通知客户端
 *   （日级数据 + 服务端 dataVersion 进 cache key + 服务端预热已覆盖 ETL，
 *    SW 5min 轮询作为客户端兜底，让长期开着的 tab 也能感知新版本）
 */

const CACHE_NAME = 'chexian-api-v2';
const VERSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟
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
 * cache-first 策略
 * - 命中且未过期 → 直接返回（0ms，无后台 fetch）
 * - 命中但已过期 → 走网络（revalidate-on-expiry）
 * - 未命中 → 走网络
 * - 离线 → 即使过期也返回缓存
 */
async function handleQueryRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = buildCacheKey(request);

  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    const cachedTime = cachedResponse.headers.get('X-SW-Cached-At');
    const isExpired = cachedTime && (Date.now() - parseInt(cachedTime, 10)) > CACHE_TTL;

    if (!navigator.onLine) {
      return addSwHeaders(cachedResponse.clone(), 'cache-offline');
    }

    // 触发版本检查（限频）
    maybeCheckVersion();

    if (!isExpired) {
      // cache-first：未过期直接返回，不发后台 fetch
      return addSwHeaders(cachedResponse.clone(), 'cache-hit');
    }
    // 过期：走网络拉新（同步等待，确保用户拿到的是新版本）
  }

  // 网络请求 + 缓存响应
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const responseToCache = await addTimestamp(networkResponse.clone());
      cache.put(cacheKey, responseToCache);
      return addSwHeaders(networkResponse, 'network');
    }
    // 上游 5xx/429 等暂时性错误：若有过期缓存则回退（避免短暂故障替换可用数据）
    if (cachedResponse) {
      return addSwHeaders(cachedResponse.clone(), 'cache-stale-fallback');
    }
    return addSwHeaders(networkResponse, 'network');
  } catch (err) {
    // 网络异常（fetch throw）：兜底返回过期缓存（如果有）
    if (cachedResponse) {
      return addSwHeaders(cachedResponse.clone(), 'cache-stale-fallback');
    }
    return new Response(
      JSON.stringify({ success: false, error: 'Offline and no cache available' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
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
