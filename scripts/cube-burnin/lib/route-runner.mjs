/**
 * route-runner.mjs — 5 路由请求构造 + 并发执行
 *
 * 管理请求构造、并发限流、预热、进度日志。
 * 不包含判定逻辑（见 shadow-judge.mjs）。
 */

import { CUBE_ROUTES } from '../../shared/cube-routes.mjs';

// ─── 路由清单 ────────────────────────────────────────────────────

/** re-export 给本 lib 测试用（SSOT 在 scripts/shared/cube-routes.mjs）*/
export const ROUTES = CUBE_ROUTES;

// ─── 工具函数 ────────────────────────────────────────────────────

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 将 filter 对象序列化为 URL query string。
 * 值为 undefined 时跳过（与 commonFilterSchema optional 语义一致）。
 *
 * @param {Record<string, string | undefined>} filters
 * @returns {string} 不含前导 '?' 的 query string
 */
export function buildQueryString(filters) {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      params.append(key, String(val));
    }
  }
  return params.toString();
}

/**
 * 带并发限制的 Promise 批量执行器（semaphore 模式）。
 *
 * @param {Array<() => Promise<any>>} tasks - thunk 数组
 * @param {number} concurrency - 最大并发数
 * @returns {Promise<any[]>} 与 tasks 顺序对应的结果数组
 */
export async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 发送单个 GET 请求，静默捕获网络错误。
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal, headers?: Record<string, string> }} [opts]
 * @returns {{ ok: boolean, status: number | null, error: string | null }}
 */
async function fetchOne(url, { signal, headers } = {}) {
  try {
    const res = await fetch(url, { signal, headers: headers ?? {} });
    return { ok: res.ok, status: res.status, error: null };
  } catch (err) {
    // AbortError 视为中断，非错误
    if (err?.name === 'AbortError') return { ok: false, status: null, error: null };
    return { ok: false, status: null, error: String(err?.message ?? err) };
  }
}

// ─── 立方体就绪等待 ──────────────────────────────────────────────

const CUBE_KEYS = ['trend', 'cost', 'salesman'];

/**
 * 轮询 /health 直到三个核心立方体全部就绪（building=false 且 builtVersion 非 null）。
 * 替代固定 200ms sleep：cube 首次构建是秒级，sleep 根本不够，会导致 INSUFFICIENT 掩盖验证。
 *
 * @param {string} baseUrl
 * @param {AbortSignal} [signal]
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<{ ready: boolean, elapsed: number, reason?: string }>}
 */
async function waitForCubeReady(baseUrl, signal, timeoutMs = 30000) {
  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return { ready: false, elapsed: Date.now() - start, reason: 'aborted' };
    try {
      const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (res.ok) {
        const text = await res.text();
        const health = JSON.parse(text);
        const allReady = CUBE_KEYS.every(
          k => health?.cubes?.[k]?.building === false && health?.cubes?.[k]?.builtVersion != null
        );
        if (allReady) return { ready: true, elapsed: Date.now() - start };
      }
    } catch {
      // 网络抖动或 AbortError —— 继续重试
    }
    await sleep(500);
  }
  return { ready: false, elapsed: Date.now() - start, reason: 'timeout' };
}

// ─── 主入口 ─────────────────────────────────────────────────────

/**
 * 执行一轮 burn-in 流量生成。
 *
 * @param {object} opts
 * @param {string} opts.baseUrl        - 服务基地址（含协议和端口）
 * @param {string} opts.tier           - 'basic' | 'org' | 'cross'
 * @param {number} [opts.concurrency]  - 并发数（默认 8）
 * @param {boolean} [opts.dryRun]      - 仅打印计划，不发请求
 * @param {Array<Record<string, string>>} opts.matrix - filter 对象数组（由 buildWhereMatrix 生成）
 * @param {string} [opts.token]        - Bearer Token（从 CX_BURNIN_TOKEN env 注入）
 * @param {AbortSignal} [opts.signal]  - 中断信号（Ctrl+C 时中止飞行中的请求）
 * @returns {Promise<{ sent: number, ok: number, failed: number, errors: string[], authError?: boolean, cubeNotReady?: boolean }>}
 */
export async function runFlight({ baseUrl, tier, concurrency = 8, dryRun = false, matrix, token, signal }) {
  const base = baseUrl.replace(/\/+$/, '');
  const totalRequests = matrix.length * ROUTES.length;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // dry-run：只打印计划
  if (dryRun) {
    console.log(`[cube-burnin] DRY-RUN tier=${tier}`);
    console.log(`  矩阵大小：${matrix.length} 个 filter 组合`);
    console.log(`  路由数：${ROUTES.length}`);
    console.log(`  请求总数：${totalRequests}`);
    console.log(`  并发：${concurrency}`);
    return { sent: 0, ok: 0, failed: 0, errors: [] };
  }

  // 预热：轮询 /health 等待立方体就绪（替代固定 sleep，cube 首次构建是秒级非毫秒级）
  console.log(`[cube-burnin] 等待立方体就绪（轮询 /health，最长 30s）…`);
  const cubeStatus = await waitForCubeReady(base, signal);
  if (!cubeStatus.ready) {
    console.warn(
      `[cube-burnin] 警告：立方体未就绪（${cubeStatus.reason}，已等待 ${cubeStatus.elapsed}ms）。` +
      `结果可能 INSUFFICIENT，请检查 /health cubes.{trend,cost,salesman} 状态。`
    );
  } else {
    console.log(`[cube-burnin] 立方体就绪（${cubeStatus.elapsed}ms）。`);
  }

  // HIGH #3 — 采样头 5 个请求判断鉴权，避免"401 vs cube 未就绪"根因混淆
  // 全 401 时立即中止，提示用户设置 CX_BURNIN_TOKEN，不走主流量
  const probeRoutes = ROUTES.slice(0, Math.min(5, ROUTES.length));
  const probeResults = [];
  for (const route of probeRoutes) {
    const probeUrl = `${base}${route.path}`;
    const r = await fetchOne(probeUrl, { signal, headers });
    probeResults.push(r);
  }
  const count401 = probeResults.filter(r => r.status === 401).length;
  if (count401 >= 3) {
    console.error(
      `[cube-burnin] 全部请求返回 401。请设置 CX_BURNIN_TOKEN 环境变量获取的 Bearer token：\n` +
      `  CX_BURNIN_TOKEN=<token> node scripts/cube-burnin.mjs --tier ${tier}`
    );
    return { sent: probeResults.length, ok: 0, failed: probeResults.length, errors: ['401 Unauthorized'], authError: true };
  }

  // 主流量
  console.log(`[cube-burnin] 发送 ${totalRequests} 个请求（tier=${tier}, concurrency=${concurrency}）…`);

  const tasks = [];
  for (const filter of matrix) {
    for (const route of ROUTES) {
      const qs = buildQueryString(filter);
      const url = `${base}${route.path}${qs ? '?' + qs : ''}`;
      tasks.push(() => fetchOne(url, { signal, headers }));
    }
  }

  const rawResults = await runWithConcurrency(tasks, concurrency);

  let ok = 0;
  let failed = 0;
  const errors = [];

  for (const r of rawResults) {
    if (r.ok) {
      ok++;
    } else {
      failed++;
      if (r.error) {
        // 去重收集错误，避免千条同类错误淹没输出
        if (errors.length < 20) errors.push(r.error);
      }
    }
  }

  console.log(`[cube-burnin] 完成：ok=${ok}, failed=${failed}, errors=${errors.length}`);
  return { sent: rawResults.length, ok, failed, errors };
}
