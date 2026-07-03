/**
 * Service Worker — Phase D: cache-first + 页面驱动版本失效
 *
 * 策略: cache-first（仅 /api/query/* 路由）
 * - 缓存命中且未过期 → 立即返回 (0ms)，不发后台 fetch（消除每页 5-10 次冗余网络往返）
 * - 缓存命中但已过期 → 走网络拉取 + 更新缓存（revalidate-on-expiry）
 * - 缓存未命中 → 网络拉取 + 缓存
 * - 离线 → 即使过期也返回缓存
 *
 * ETL 版本失效（Phase D 改为页面驱动，见 src/app/etlVersionPoller.ts）：
 * 页面侧带鉴权定时轮询 /api/data/version，版本变化 → postMessage FORCE_REFRESH
 * → 本 SW 清空 Cache Storage。
 * ⚠️ 勿在 SW 内恢复裸 fetch('/api/data/version')：该接口挂 authMiddleware，
 * SW 上下文不带登录凭证恒 401（BACKLOG 2026-06-11-claude-ed63ec 双重死因之二）；
 * 且"fetch 事件顺带触发"在 staleTime=Infinity 下永不执行（死因之一）。
 */

const CACHE_NAME = 'chexian-api-v2';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

// 仅缓存 query 路由（不缓存 auth/data/ai/filters）
const CACHEABLE_PATTERN = /\/api\/query\//;

// ── Install 事件 ─────────────────────────────

self.addEventListener('install', (event) => {
  // skipWaiting：新版 SW 立即进入 activate，不等旧 tab 全部关闭。
  // 本 SW 只缓存 API 响应、不缓存 HTML/JS/CSS，跳版无页面资源不一致风险；
  // 反之不跳版会让 SW 缓存策略修复延迟到"所有旧 tab 关闭"才生效
  // （BACKLOG 2026-07-03-claude-0f86cb 部署白屏链的 SW 侧一环）。
  self.skipWaiting();
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
    // 仅 5xx/429 暂时性错误回退过期缓存（避免短暂故障替换可用数据）。
    // 其余 4xx（尤其 401/403）必须透传：否则会话过期后 SW 把旧缓存当有效
    // 响应端给前端，client-core 的 401 刷新/auth-session-expired 链路永远
    // 触发不了，用户看着旧数据以为会话正常（BACKLOG 2026-07-03-claude-dc9f29）。
    const isTransientError = networkResponse.status >= 500 || networkResponse.status === 429;
    if (cachedResponse && isTransientError) {
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

// ── 缓存清空（页面通过 FORCE_REFRESH 消息驱动）──

async function clearAndNotify(etlDate = null) {
  const cache = await caches.open(CACHE_NAME);

  // 清空所有缓存
  const keys = await cache.keys();
  await Promise.all(keys.map((key) => cache.delete(key)));

  // 通知所有客户端数据已更新（触发 React Query 失效）
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'ETL_UPDATED', etlDate });
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
    clearAndNotify(event.data.etlDate ?? null);
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
