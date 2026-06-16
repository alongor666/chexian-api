/**
 * route-runner.mjs — 5 路由请求构造 + 并发执行
 *
 * 管理请求构造、并发限流、预热、进度日志。
 * 不包含判定逻辑（见 shadow-judge.mjs）。
 */

// ─── 路由清单 ────────────────────────────────────────────────────

/** 5 个 burn-in 目标路由（路由表与 /health cubeShadow key 对应）*/
export const ROUTES = Object.freeze([
  { key: 'trend',            path: '/api/query/trend',             shadowKey: 'trend'            },
  { key: 'growth',           path: '/api/query/growth',            shadowKey: 'growth'           },
  { key: 'cost',             path: '/api/query/cost',              shadowKey: 'cost'             },
  { key: 'kpi',              path: '/api/query/kpi',               shadowKey: 'kpi'              },
  { key: 'salesman',         path: '/api/query/salesman-ranking',  shadowKey: 'salesman-ranking' },
]);

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
 * @returns {Promise<{ sent: number, ok: number, failed: number, errors: string[] }>}
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

  // 预热：每路由打 2 个 noop 请求（避免命中 cube building 状态）
  console.log(`[cube-burnin] 预热（每路由 2 个请求）…`);
  for (const route of ROUTES) {
    const warmUrl = `${base}${route.path}`;
    await fetchOne(warmUrl, { signal, headers });
    await fetchOne(warmUrl, { signal, headers });
  }
  await sleep(200); // 给 cube 切换状态留余量

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
