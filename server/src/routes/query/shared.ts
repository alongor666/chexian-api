/**
 * Shared utilities, types, and constants used across query route modules.
 */

import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getRouteCache, getRouteCacheEntry, setRouteCache, computeEtag, sendWithEtag, sendCachedEntry } from '../../services/route-cache.js';
import { markRequestCacheHit } from '../../utils/request-context.js';
import { buildResponseMeta } from '../../utils/api-meta.js';
import { DEFAULT_COMPREHENSIVE_THRESHOLDS } from '../../config/comprehensive-thresholds.js';
import { dbEnv } from '../../config/env.js';
import { getDataVersion } from '../../services/data-version.js';

// Re-export commonly used items for convenience
export type { Request, Response } from 'express';
export { z } from 'zod';
export { asyncHandler, AppError } from '../../middleware/error.js';
export { duckdbService } from '../../services/duckdb.js';
export { permissionService } from '../../services/permission.js';
export { isValidDateFormat } from '../../utils/sql-sanitizer.js';
export { commonFilterSchema, buildWhereFromFilterParams, buildWhereFromFilterParamsWithoutDate } from '../../utils/filter-params.js';
export { parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames, resolveGroupDim } from '../../utils/route-helpers.js';
export { logger } from '../../utils/logger.js';
export { getRouteCache, setRouteCache, computeEtag, sendWithEtag } from '../../services/route-cache.js';
export { markRequestCacheHit } from '../../utils/request-context.js';
export { buildResponseMeta } from '../../utils/api-meta.js';
export { DEFAULT_COMPREHENSIVE_THRESHOLDS } from '../../config/comprehensive-thresholds.js';
export type { AdvancedFilterState, DateCriteria } from '../../types/data.js';

/**
 * 查询缓存 TTL（毫秒）
 *
 * 数据每天仅更新一次（ETL daily），invalidateCache() 在数据加载时清空所有缓存。
 * 因此 TTL 只是"安全上限"，实际失效由 ETL 触发。
 * 旧值 2-5 分钟导致同一查询每天重复执行数百次，白白消耗 DuckDB 资源。
 */
export const QUERY_CACHE = {
  hotspotShort: 3_600_000,   // 1 小时（旧: 2 分钟）— KPI、下钻等高频查询
  hotspotMedium: 7_200_000,  // 2 小时（旧: 3 分钟）— 趋势、排名等中频查询
  hotspotLong: 14_400_000,   // 4 小时（旧: 5 分钟）— Dashboard bundle 等低频重查询
} as const;

/**
 * HTTP Cache-Control max-age（秒）
 *
 * 数据日更，浏览器无需每次都问服务器。配合 stale-while-revalidate=3600，
 * 即使过期也先返回旧数据、后台静默刷新，用户几乎零等待。
 */
export const HTTP_MAX_AGE = {
  bundle: 300,    // 5 分钟（旧: 30-60 秒）— 聚合 bundle 端点
  query: 300,     // 5 分钟（旧: 30-60 秒）— 独立查询端点
} as const;

const NON_SEMANTIC_QUERY_PARAMS = new Set(['_t', '_', 'cacheBust', 'cachebuster', 'timestamp']);

export function buildRouteCacheKey(req: Request, routeName: string): string {
  const normalizedQuery = Object.entries(req.query)
    .filter(([key]) => !NON_SEMANTIC_QUERY_PARAMS.has(key))
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  // 0E codex P2：branchCode 段独立于 permissionFilter — flag off 兼容期所有 admin
  // 的 permissionFilter 都是 '1=1'，但响应体可能按 req.user.branchCode 变化（如
  // cross-sell 汇总行的 '四川分公司' 标签）；若 cache key 不含 branchCode，会让
  // SC 用户先请求的响应缓给同 query 的 SX/全国用户。本段保证：
  //   - flag off + admin SC.branchCode='SC' → 'b=SC'
  //   - flag off + admin SX.branchCode='SX' → 'b=SX'
  //   - 系统级超管（branchCode undefined）→ 'b=_'
  // flag on 时 permissionFilter 已含 branch_code='SC'，本段是冗余防御（不是必要）。
  const branchSegment = `b=${req.user?.branchCode ?? '_'}`;
  // 版本后缀：ETL 完成后版本变更，旧 key 自然不再被命中，由 LRU 淘汰
  return `${routeName}|${req.permissionFilter || '1=1'}|${branchSegment}|${normalizedQuery}|v=${getDataVersion()}`;
}

/**
 * 基于 cache key 的确定性 ETag（不依赖响应体）。
 * 因为 cache key 已含 dataVersion，同 key 即同数据版本同筛选条件，
 * 客户端 If-None-Match 命中可直接 304，无需查 LRU 也无需执行 SQL。
 */
function deterministicEtag(cacheKey: string): string {
  return `"${crypto.createHash('md5').update(cacheKey).digest('hex').slice(0, 16)}"`;
}

/**
 * 路由级 LRU 缓存中间件。
 * - If-None-Match 命中（确定性 ETag）：直接 304，无 LRU 查询、无 SQL 执行
 * - LRU 命中：sendWithEtag(cached) 返回（<1ms）
 * - 未命中：拦截 res.json() 自动缓存成功响应
 *
 * 用法：router.get('/path', withRouteCache('routeName'), asyncHandler(...))
 */
export function withRouteCache(
  routeName: string,
  ttlMs: number = QUERY_CACHE.hotspotMedium,
  maxAgeSec: number = HTTP_MAX_AGE.query,
) {
  return (req: Request, res: Response, next: import('express').NextFunction): void => {
    const key = buildRouteCacheKey(req, routeName);
    const etag = deterministicEtag(key);

    // Fast path: 客户端持有当前版本的 ETag → 直接 304
    if (req.headers['if-none-match'] === etag) {
      markRequestCacheHit();
      res.set('ETag', etag);
      res.set('Cache-Control', `private, max-age=${maxAgeSec}, stale-while-revalidate=3600`);
      res.status(304).end();
      return;
    }

    const cachedEntry = getRouteCacheEntry(key);
    if (cachedEntry) {
      markRequestCacheHit();
      // 直接 res.end(buffer)，跳过 res.json + 二次 stringify + 压缩中间件
      sendCachedEntry(req, res, cachedEntry, etag, maxAgeSec);
      return;
    }

    const origJson = res.json.bind(res);
    res.json = function (body: any) {
      if (res.statusCode >= 200 && res.statusCode < 300 && body && body.success !== false) {
        setRouteCache(key, body, ttlMs);
        res.set('ETag', etag);
        res.set('Cache-Control', `private, max-age=${maxAgeSec}, stale-while-revalidate=3600`);
      }
      return origJson(body);
    } as any;
    next();
  };
}

export function isBundleRoutesEnabled(): boolean {
  return dbEnv.ENABLE_QUERY_BUNDLES !== 'false';
}

export function resolveCutoffDate(
  requestedCutoffDate: string | undefined,
  filterEndDate: string | undefined,
  maxDataDate: string | null
): string {
  if (requestedCutoffDate) return requestedCutoffDate;
  if (filterEndDate) return filterEndDate;
  if (maxDataDate) return maxDataDate;
  return new Date().toISOString().slice(0, 10);
}

export function computeTimeProgress(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const elapsedDays = Math.max(1, Math.floor((date.getTime() - start.getTime()) / 86400000) + 1);
  const totalDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000));
  return Number((elapsedDays / totalDays).toFixed(6));
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export interface ComprehensiveMetricRow {
  dim_type: string;
  dim_key: string;
  policy_count: number;
  signed_premium: number;
  reported_claims: number;
  fee_amount: number;
  claim_cases: number;
  earned_premium: number;
  earned_claim_ratio: number | null;
  expense_ratio: number | null;
  variable_cost_ratio: number | null;
  avg_claim_amount: number | null;
  claim_frequency: number | null;
  premium_share: number;
  claim_share: number;
  expense_share: number;
  plan_premium: number | null;
  achievement_rate: number | null;
}

export function buildComprehensiveAlerts(
  rows: ComprehensiveMetricRow[],
  thresholds: typeof DEFAULT_COMPREHENSIVE_THRESHOLDS
): string[] {
  const premiumLag = rows
    .filter((row) => row.achievement_rate !== null && row.achievement_rate < thresholds.premiumProgressWarn)
    .slice(0, 5)
    .map((row) => row.dim_key);
  const highCost = rows
    .filter((row) => row.variable_cost_ratio !== null && row.variable_cost_ratio > thresholds.costRateWarn)
    .slice(0, 5)
    .map((row) => row.dim_key);
  const highLoss = rows
    .filter((row) => row.earned_claim_ratio !== null && row.earned_claim_ratio > thresholds.lossRateWarn)
    .slice(0, 5)
    .map((row) => row.dim_key);
  const highExpense = rows
    .filter((row) => row.expense_ratio !== null && row.expense_ratio > thresholds.expenseRateWarn)
    .slice(0, 5)
    .map((row) => row.dim_key);

  const alerts: string[] = [];
  if (premiumLag.length > 0) alerts.push(`${premiumLag.join('、')}保费进度落后`);
  if (highCost.length > 0) alerts.push(`${highCost.join('、')}变动成本率超标`);
  if (highLoss.length > 0) alerts.push(`${highLoss.join('、')}满期赔付率偏高`);
  if (highExpense.length > 0) alerts.push(`${highExpense.join('、')}费用率超标`);
  return alerts;
}

// ============================================
// 惰性域加载中间件工厂（per MAT-01 / 04-02-PLAN.md）
// ============================================

import type { NextFunction } from 'express';
import { getBootstrapper } from '../../services/bootstrapper-registry.js';

/**
 * 集中式惰性域加载中间件工厂
 *
 * 用法：router.use(createDomainMiddleware('ClaimsDetail', 'ClaimsAgg'));
 *
 * 超时（15s）：返回 503 Service Unavailable
 * 加载失败：返回 500 Internal Server Error
 * 未注册（bootstrapper 未初始化）：直接 next()，不阻塞
 */
export function createDomainMiddleware(...domains: string[]) {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const bootstrapper = getBootstrapper();
    if (!bootstrapper) {
      // 测试环境或 bootstrapper 未初始化时，跳过惰性加载
      next();
      return;
    }
    try {
      for (const domain of domains) {
        await bootstrapper.ensureDomainLoaded(domain);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function withRankByDimType(rows: ComprehensiveMetricRow[]): Array<ComprehensiveMetricRow & { rank: number }> {
  const grouped = new Map<string, ComprehensiveMetricRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.dim_type)) {
      grouped.set(row.dim_type, []);
    }
    grouped.get(row.dim_type)!.push(row);
  }

  const rankedRows: Array<ComprehensiveMetricRow & { rank: number }> = [];
  for (const groupRows of grouped.values()) {
    const sorted = [...groupRows].sort((a, b) => b.signed_premium - a.signed_premium);
    sorted.forEach((row, index) => {
      rankedRows.push({ ...row, rank: index + 1 });
    });
  }
  return rankedRows;
}
