/**
 * ETL 异常哨兵 — 取数封装
 *
 * 全部走生产 API（runner 无 parquet），PAT 只读鉴权（Authorization: Bearer cx_pat_...）。
 * 端点（均已实读源码核验）：
 *   - GET /api/data/version                          → {etlDate, buildTime, serverStartTime}（上下文/日志）
 *   - GET /api/query/comprehensive-bundle?granularity=...   → data.overview.summary(4 比率快照)
 *                                                       + data.loss.trendRows(逐期赔付率序列)
 *                                                       + data.meta.{cutoffDate,timeProgress}
 *     · 幂等：带 If-None-Match:<lastEtag> → 304 表示数据版本未变（getDataVersion 指纹），静默退出
 *   - GET /api/query/trend?perspective=premium|policy_count → data:[{time_period, <metric>}]（断崖检测）
 *
 * 调用量 ≈ 4 次/run（1 version + 1 comprehensive + 2 trend），远低于 PAT 60/min 单桶。
 * YoY 同期对齐改由 stats.evaluateMetricSeries 内部从 series 查 latestMature 期 -1 年（codex P2 修复，
 * 省去原 fetchClaimRatioYoY 远程调用 + 把 YTD 累计快照口径错对齐单月被检值的坑）。
 */

const ENVELOPE_OK = (j) => j && j.success === true && j.data !== undefined;

async function apiGet(apiBase, path, { pat, ifNoneMatch } = {}) {
  const url = `${apiBase.replace(/\/$/, '')}${path}`;
  const headers = { Accept: 'application/json' };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;

  const res = await fetch(url, { headers });
  if (res.status === 304) {
    return { notModified: true, etag: ifNoneMatch, status: 304 };
  }
  const etag = res.headers.get('etag');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} → HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const json = await res.json();
  if (!ENVELOPE_OK(json)) {
    throw new Error(`GET ${path} → 非预期响应体（缺 success/data）`);
  }
  return { notModified: false, etag, status: res.status, json };
}

/** 数据版本/ETL 上下文（etlDate = MAX(policy_date)，仅作日志/上下文，幂等以 ETag 为准） */
export async function fetchDataVersion(apiBase, pat) {
  const { json } = await apiGet(apiBase, '/api/data/version', { pat });
  return json.data; // {etlDate, buildTime, serverStartTime}
}

/**
 * 取综合分析 bundle。带 If-None-Match 做幂等。
 * @returns {{notModified:boolean, etag:string|null, bundle?:object, cutoffDate?:string, timeProgress?:number}}
 */
export async function fetchComprehensive(apiBase, pat, { granularity = 'monthly', cutoffDate = null, ifNoneMatch = null } = {}) {
  const q = new URLSearchParams({ granularity });
  if (cutoffDate) q.set('cutoffDate', cutoffDate);
  // 实际注册路径是 /comprehensive-bundle（query/comprehensive.ts），无 /comprehensive 别名
  const r = await apiGet(apiBase, `/api/query/comprehensive-bundle?${q.toString()}`, { pat, ifNoneMatch });
  if (r.notModified) return { notModified: true, etag: r.etag };

  const data = r.json.data;
  return {
    notModified: false,
    etag: r.etag,
    cutoffDate: data?.meta?.cutoffDate ?? null,
    timeProgress: data?.meta?.timeProgress ?? null,
    summary: data?.overview?.summary ?? {},
    lossTrendRows: Array.isArray(data?.loss?.trendRows) ? data.loss.trendRows : [],
  };
}

/**
 * 取流量趋势（断崖检测）。两层容错：
 *   1) 列名按视角变化 → 优先已知列名，兜底取首个非时间/非 next_month* 有限数值列。
 *   2) 同一 time_period 可能有多行（若被按机构等维度分组）→ **按 time_period 汇总**，
 *      避免把不同机构的单月值当成序列点（误报/漏报断崖）。哨兵默认无 org 筛选、
 *      admin 用户，trend 实际单行/期；汇总是防御性加固，单行场景为恒等。
 * @returns {Array<{time_period:string, value:number}>} 按 time_period 升序
 */
export async function fetchTrend(apiBase, pat, { perspective = 'premium', granularity = 'monthly' } = {}) {
  const q = new URLSearchParams({ perspective, granularity });
  const r = await apiGet(apiBase, `/api/query/trend?${q.toString()}`, { pat });
  const rows = Array.isArray(r.json.data) ? r.json.data : [];
  const PREFERRED = perspective === 'policy_count'
    ? ['policy_count', 'total_policy_count', 'count', 'value']
    : ['total_premium', 'premium', 'signed_premium', 'value'];

  const pickValue = (row) => {
    for (const k of PREFERRED) {
      if (Number.isFinite(Number(row[k]))) return Number(row[k]);
    }
    // 兜底：首个非时间/非 next_month* 的有限数值
    for (const [k, v] of Object.entries(row)) {
      if (k === 'time_period' || k === 'period' || k.startsWith('next_month')) continue;
      if (Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };

  // 按 time_period 汇总（多机构行 → 全量月度总额）
  const byPeriod = new Map();
  for (const row of rows) {
    const tp = row.time_period ?? row.period ?? null;
    if (tp == null) continue;
    const val = pickValue(row);
    if (val == null) continue;
    byPeriod.set(String(tp), (byPeriod.get(String(tp)) ?? 0) + val);
  }

  return [...byPeriod.entries()]
    .map(([time_period, value]) => ({ time_period, value }))
    .sort((a, b) => a.time_period.localeCompare(b.time_period));
}

/** 把 comprehensive lossTrendRows 规整成 {time_period, value=earned_claim_ratio} 逐期序列 */
export function lossTrendToSeries(lossTrendRows) {
  return lossTrendRows
    .filter(
      (r) =>
        r &&
        r.time_period != null &&
        // 显式拒绝 null/undefined：Number(null)===0 会让未来月（值为 null）被错当成 0 进入序列
        r.earned_claim_ratio != null &&
        Number.isFinite(Number(r.earned_claim_ratio))
    )
    .map((r) => ({ time_period: String(r.time_period), value: Number(r.earned_claim_ratio) }));
}

