/**
 * Shared utilities, types, and constants used across query route modules.
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AppError } from '../../middleware/error.js';
import { duckdbService } from '../../services/duckdb.js';
import { sanitizeTableName, escapeSqlValue } from '../../utils/security.js';
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

/**
 * 紧急止血：路由级 admin-only 闸（BACKLOG 2026-06-11-claude-942414 / P0）
 *
 * 背景：customer-flow / quote-conversion / claims-detail / repair 四域
 * 的路由 handler 历史上未消费 req.permissionFilter，且其底层 SQL 生成器签名
 * 也未预留 whereClause 入参 → 非超管账号可越权读全量数据。
 *
 * 紧急对策（本中间件）：四域整体退化为 admin-only，非 branch_admin 一律 403。
 * 长期修法（拆 BACKLOG 子项）：按域注入 permissionFilter（字段齐的 3 域）
 * 或域逻辑兜底（customer-flow 视图无 org_level_3）。
 *
 * 历史先例：B263 已对 agent diagnosis 客户流向端点做过同款 admin-only 兜底。
 */
export function requireBranchAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next(new AppError(401, 'Authentication required'));
    return;
  }
  if (req.user.role !== 'branch_admin') {
    next(new AppError(403, '此域当前仅对分公司管理员开放（RLS 整域改造期临时策略，详见 BACKLOG 2026-06-11-claude-942414）'));
    return;
  }
  next();
}

/**
 * 派生/维度视图的「org 作用域」权限子句（安全降级）。
 *
 * 背景：部分派生视图（RenewalTrackerFact / RepairDim 等）只含 org_level_3，
 * **不含 is_telemarketing / branch_code**。直接把 req.permissionFilter 追加到针对
 * 这些视图的查询，对电销用户（filter='is_telemarketing = true'）或多分公司用户
 * （含 branch_code）会触发 DuckDB Binder Error（列不存在）→ 500。
 *
 * 安全降级（与 routes/query/repair.ts buildRepairPermissionWhere 同款模式——只保留视图
 * 真实存在的 org_level_3 条件，绝不静默丢弃它）：
 *   - branch_admin（'1=1'）→ '1=1'（不限制）
 *   - org_user（含 org_level_3='...'）→ 提取该条件（视图有此列，照常隔离）
 *   - telemarketing_user（'is_telemarketing=true'，无 org_level_3）→ '1=1'（视图无电销维度，
 *     与 repair.ts 既定口径一致：电销在此类派生视图看 org 范围内全部数据，非泄漏放大）
 *   - 多分公司（org_level_3=X AND branch_code=Y）→ 仅保留 org_level_3 段
 *     （branch_code 真正下推依赖 P0.5 派生域补列，BACKLOG 跟踪）
 *
 * repair.ts 现有同名局部函数为等价实现；后续可统一到本函数（DRY，未在本变更内合并以控范围）。
 */
export function buildOrgScopedPermissionWhere(req: Request): string {
  const pf = req.permissionFilter;
  if (!pf || pf === '1=1') return '1=1';
  // 提取 org_level_3 = '...' 段（支持转义单引号 ''）；无该列条件则降为 '1=1'，绝不追加视图缺失的列
  const match = pf.match(/org_level_3\s*=\s*'(?:[^']|'')*'/);
  return match ? match[0] : '1=1';
}

/**
 * 解析针对「不含标准 RLS 列、但 GATED 多省时携带 branch_code」的关系
 * （achievement_cache / SalesmanTeamMapping / RepairDim）的分省 RLS 码（ADR G3/G4 查询期收口）。
 *
 * 这些关系不含 org_level_3/is_telemarketing 标准 RLS 列（RepairDim 仅含编码格式 org_level_3），
 * parseFiltersAndBuildWhere 的 whereClause 注入对它们无效（列不存在→Binder Error）；改由本助手
 * 解析 branchCode，各 SQL 生成器单独拼 `branch_code='XX'` 等值过滤。
 *
 * 双门控（两者皆成立才返回 branchCode，否则 undefined → 不注入 → 行为不变）：
 *  - gate a：req.permissionFilter 含 `branch_code='XX'`（⟺ BRANCH_RLS_ENABLED 且用户有 branchCode；
 *    见 middleware/permission.ts）。flag=false（默认/生产）→ 无此段 → undefined → 逐字节字节安全。
 *  - gate b：目标关系实测含 branch_code 列（⟺ GATED 多省加载已激活；information_schema 零假设实测）。
 *    免疫 T-3 中间态（RLS-on + 未载 SX → 关系仍单省无 branch_code 列）：不注入 → 不 Binder Error，
 *    SC 全量=零差异（与 premiumPlan rlsOrgName 旁路同款安全降级）。
 *
 * branchCode 经 `^[A-Z]{2}$` 校验后方内插（与 getDeploymentBranchCode 同源约束），无 SQL 注入面。
 */
export async function resolveBranchRlsCode(
  req: Request,
  relation: string,
): Promise<string | undefined> {
  const pf = req.permissionFilter;
  if (!pf) return undefined;
  const m = pf.match(/branch_code\s*=\s*'([A-Z]{2})'/); // gate a
  if (!m) return undefined;
  const code = m[1];
  const hasCol = await relationHasBranchCode(relation); // gate b
  return hasCol ? code : undefined;
}

/**
 * 关系是否含 branch_code 列（gate b 的实测）。information_schema 查询：关系/列缺失返回 0 行
 * （不抛错，免 DESCRIBE 在表不存在时的异常）。带 hotspotLong TTL 缓存——列结构仅 ETL reload 时变，
 * 缓存随 duckdb 内部 cache epoch（invalidateCache）自动作废。
 */
async function relationHasBranchCode(relation: string): Promise<boolean> {
  const safe = escapeSqlValue(sanitizeTableName(relation));
  const rows = await duckdbService.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = '${safe}' AND lower(column_name) = 'branch_code'`,
    QUERY_CACHE.hotspotLong,
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

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
