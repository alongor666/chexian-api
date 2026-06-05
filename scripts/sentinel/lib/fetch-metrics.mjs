/**
 * ETL 异常哨兵 — 取数封装
 *
 * 全部走生产 API（runner 无 parquet），PAT 只读鉴权（Authorization: Bearer cx_pat_...）。
 * 端点（均已实读源码核验）：
 *   - GET /api/data/version                          → {etlDate, buildTime, serverStartTime}（上下文/日志）
 *   - GET /api/query/comprehensive?granularity=...   → data.overview.summary(4 比率快照)
 *                                                       + data.loss.trendRows(逐期赔付率序列)
 *                                                       + data.meta.{cutoffDate,timeProgress}
 *     · 幂等：带 If-None-Match:<lastEtag> → 304 表示数据版本未变（getDataVersion 指纹），静默退出
 *   - GET /api/query/trend?perspective=premium|policy_count → data:[{time_period, <metric>}]（断崖检测）
 *
 * 调用量 ≈ 5 次/run，远低于 PAT 60/min 单桶。串行 + 控速。
 */

import { lastYearCutoff } from './stats.mjs';

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
  const r = await apiGet(apiBase, `/api/query/comprehensive?${q.toString()}`, { pat, ifNoneMatch });
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
 * 取流量趋势（断崖检测）。trend 输出列名按视角变化，做容错解析：
 * 取 time_period + 第一个「非 time_period / 非 next_month* 的有限数值列」作为指标值。
 * @returns {Array<{time_period:string, value:number}>}
 */
export async function fetchTrend(apiBase, pat, { perspective = 'premium', granularity = 'monthly' } = {}) {
  const q = new URLSearchParams({ perspective, granularity });
  const r = await apiGet(apiBase, `/api/query/trend?${q.toString()}`, { pat });
  const rows = Array.isArray(r.json.data) ? r.json.data : [];
  const PREFERRED = perspective === 'policy_count'
    ? ['policy_count', 'total_policy_count', 'count', 'value']
    : ['total_premium', 'premium', 'signed_premium', 'value'];

  return rows
    .map((row) => {
      const tp = row.time_period ?? row.period ?? null;
      if (tp == null) return null;
      let val = null;
      for (const k of PREFERRED) {
        if (Number.isFinite(Number(row[k]))) { val = Number(row[k]); break; }
      }
      if (val == null) {
        // 兜底：首个非时间/非 next_month* 的有限数值
        for (const [k, v] of Object.entries(row)) {
          if (k === 'time_period' || k === 'period' || k.startsWith('next_month')) continue;
          if (Number.isFinite(Number(v))) { val = Number(v); break; }
        }
      }
      return val == null ? null : { time_period: String(tp), value: val };
    })
    .filter(Boolean);
}

/** 把 comprehensive lossTrendRows 规整成 {time_period, value=earned_claim_ratio} 逐期序列 */
export function lossTrendToSeries(lossTrendRows) {
  return lossTrendRows
    .filter((r) => r && r.time_period != null && Number.isFinite(Number(r.earned_claim_ratio)))
    .map((r) => ({ time_period: String(r.time_period), value: Number(r.earned_claim_ratio) }));
}

/**
 * 取去年同期满期赔付率（YoY 交叉确认）。失败返回 null（不阻断主流程）。
 */
export async function fetchClaimRatioYoY(apiBase, pat, currentCutoff, currentValue) {
  const lyCutoff = lastYearCutoff(currentCutoff);
  if (!lyCutoff) return null;
  try {
    const r = await fetchComprehensive(apiBase, pat, { granularity: 'monthly', cutoffDate: lyCutoff });
    if (r.notModified) return null;
    const prev = Number(r.summary?.earnedClaimRatio);
    if (!Number.isFinite(prev)) return null;
    return { current: Number(currentValue), previous: prev, previousCutoff: lyCutoff };
  } catch {
    return null;
  }
}
