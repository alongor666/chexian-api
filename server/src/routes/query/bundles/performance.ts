/**
 * Performance bundle route: GET /performance-bundle
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildBothWhere,
  extractOrgNames, extractSalesmanNames, resolveBranchRlsCode,
  getRequestBranchCode, resolveRequiredPlanFactBranchCode,
  QUERY_CACHE, HTTP_MAX_AGE,
  isBundleRoutesEnabled, buildRouteCacheKey,
  getRouteCache, setRouteCache,
  markRequestCacheHit, sendWithEtag, buildResponseMeta,
} from '../shared.js';
import {
  generatePerformancePeriodBoundsQuery,
  generatePerformanceSummaryQuery,
  generatePerformanceTrendQuery,
  generatePerformanceDrilldownQuery,
  generatePerformanceTopSalesmanQuery,
  type PerformancePeriodBounds,
  type PerformanceSegmentTag,
  type PerformanceGrowthMode,
  type PerformanceTimePeriod,
  type PerformanceTrendGranularity,
  type PerformanceSummaryExpandDims,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
} from '../../../sql/performance-analysis.js';
import {
  PERFORMANCE_DIMENSIONS,
  PERFORMANCE_SEGMENT_TAGS,
  PERFORMANCE_LEGACY_CATEGORIES,
  PERFORMANCE_EXPAND_DIMS,
  resolvePerformanceSegmentTag,
  mapPerformanceTimeToGranularity,
} from '../performance.js';

export const performanceBundleSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(PERFORMANCE_DIMENSIONS).optional(),
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
  expandDims: z.enum(PERFORMANCE_EXPAND_DIMS).default('none'),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  limit: z.coerce.number().default(20),
});

const router = Router();

type DuckDBQueryFn = (sql: string, cacheTtlMs?: number) => Promise<Record<string, unknown>[]>;

export interface PerformanceBundleQueryPlan {
  summarySql: string;
  trendSql: string;
  drillSummarySql: string;
  drillRowsSql: string | null;
  topSalesmanSql: string;
  cacheTtlMs: number;
}

export interface PerformanceBundleQueryRows {
  summaryRows: Record<string, unknown>[];
  trendRows: Record<string, unknown>[];
  drillSummaryRows: Record<string, unknown>[];
  drillRows: Record<string, unknown>[];
  topSalesmanRows: Record<string, unknown>[];
}

function resolvePerformanceBundleInnerConcurrency(): number {
  const override = Number(process.env.PERFORMANCE_BUNDLE_INNER_CONCURRENCY);
  if (Number.isFinite(override) && override > 0) {
    return Math.max(1, Math.floor(override));
  }

  const duckdbThreads = Number(process.env.DUCKDB_THREADS || 4);
  if (Number.isFinite(duckdbThreads) && duckdbThreads <= 2) {
    return 1;
  }

  return 2;
}

export async function runPerformanceBundleQueries(
  query: DuckDBQueryFn,
  plan: PerformanceBundleQueryPlan
): Promise<PerformanceBundleQueryRows> {
  const tasks: Array<{
    key: keyof PerformanceBundleQueryRows;
    sql: string | null;
  }> = [
    { key: 'summaryRows', sql: plan.summarySql },
    { key: 'trendRows', sql: plan.trendSql },
    { key: 'drillSummaryRows', sql: plan.drillSummarySql },
    { key: 'drillRows', sql: plan.drillRowsSql },
    { key: 'topSalesmanRows', sql: plan.topSalesmanSql },
  ];
  const results: PerformanceBundleQueryRows = {
    summaryRows: [],
    trendRows: [],
    drillSummaryRows: [],
    drillRows: [],
    topSalesmanRows: [],
  };
  const concurrency = resolvePerformanceBundleInnerConcurrency();

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const rows = await Promise.all(
      batch.map(async (task) => {
        if (!task.sql) return { key: task.key, rows: [] };
        return {
          key: task.key,
          rows: await query(task.sql, plan.cacheTtlMs),
        };
      })
    );
    for (const item of rows) {
      results[item.key] = item.rows;
    }
  }

  return results;
}

/**
 * GET /api/query/performance-bundle
 * 业绩分析页面聚合端点：summary + trend + drilldown + topSalesman
 */
router.get(
  '/performance-bundle',
  asyncHandler(async (req, res) => {
    if (!isBundleRoutesEnabled()) {
      throw new AppError(503, 'Performance bundle route is disabled');
    }

    const parseResult = performanceBundleSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const routeCacheKey = buildRouteCacheKey(req, 'performance-bundle');
    const cachedBundleData = getRouteCache<Record<string, unknown>>(routeCacheKey);
    if (cachedBundleData) {
      markRequestCacheHit();
      sendWithEtag(req, res, {
        success: true,
        data: cachedBundleData,
        meta: buildResponseMeta(res),
      }, HTTP_MAX_AGE.bundle);
      return;
    }
    const {
      drillPath: drillPathRaw,
      groupBy,
      timePeriod,
      growthMode,
      expandDims,
      granularity,
      limit,
    } = parseResult.data;
    const segmentTag = resolvePerformanceSegmentTag(parseResult.data);

    let drillPath: PerformanceDrilldownStep[] = [];
    try {
      const parsed = JSON.parse(drillPathRaw);
      if (Array.isArray(parsed)) {
        drillPath = parsed.map((s: any) => ({
          dimension: String(s.dimension) as PerformanceDimension,
          value: String(s.value),
        }));
      }
    } catch {
      throw new AppError(400, 'Invalid drillPath JSON');
    }

    const { filterData, whereWithDate, whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);
    // 年计划取数范围（标准口径）：与保费看板 /kpi 同源的 org/salesman 提取
    const requestBranchCode = getRequestBranchCode(req);
    const planScope = {
      orgNames: extractOrgNames(filterData, req.permissionFilter),
      salesmanNames: extractSalesmanNames(filterData, req.permissionFilter),
      requestBranchCode,
      // 分省 RLS（ADR G4 GATED 多省）：achievement_cache 年计划按省过滤（双门控；flag off / 单省无列 → 不注入）
      branchCode: await resolveBranchRlsCode(req, 'achievement_cache'),
      organizationPlanBranchCode: await resolveRequiredPlanFactBranchCode(req),
    };
    // 分省 RLS：团队维度 all_rows JOIN 的剥列 CTE 按省过滤，免同名业务员跨省保费扇出
    const drilldownRlsBranchCode = await resolveBranchRlsCode(req, 'SalesmanTeamMapping');
    const trendGranularity = (granularity || mapPerformanceTimeToGranularity(timePeriod as PerformanceTimePeriod)) as PerformanceTrendGranularity;
    const periodBoundsSql = generatePerformancePeriodBoundsQuery(
      whereWithDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      dateField
    );
    const periodBoundsRows = await duckdbService.query<Record<string, unknown>>(
      periodBoundsSql,
      QUERY_CACHE.hotspotShort
    );
    const periodBoundsRow = periodBoundsRows[0];
    const periodBounds: PerformancePeriodBounds | undefined = periodBoundsRow
      ? {
        refDate: String(periodBoundsRow.ref_date ?? ''),
        currentStart: String(periodBoundsRow.current_start ?? ''),
        currentEnd: String(periodBoundsRow.current_end ?? ''),
        prevStart: String(periodBoundsRow.prev_start ?? ''),
        prevEnd: String(periodBoundsRow.prev_end ?? ''),
      }
      : undefined;

    const summarySql = generatePerformanceSummaryQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      expandDims as PerformanceSummaryExpandDims,
      periodBounds,
      dateField
    );
    const trendSql = generatePerformanceTrendQuery(
      whereWithDate,
      segmentTag as PerformanceSegmentTag,
      trendGranularity,
      dateField
    );
    const drillSummarySql = generatePerformanceDrilldownQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      drillPath,
      null,
      periodBounds,
      dateField,
      planScope,
      drilldownRlsBranchCode
    );
    const drillRowsSql = groupBy
      ? generatePerformanceDrilldownQuery(
        whereWithDate,
        whereWithoutDate,
        segmentTag as PerformanceSegmentTag,
        timePeriod as PerformanceTimePeriod,
        growthMode as PerformanceGrowthMode,
        drillPath,
        groupBy as PerformanceDimension,
        periodBounds,
        dateField,
        planScope,
        drilldownRlsBranchCode
      )
      : null;
    // 分省 RLS：归属机构 JOIN 的 salesman_dim 剥列 CTE 按省过滤，免同名业务员跨省排名扇出
    const topSalesmanRlsBranchCode = await resolveBranchRlsCode(req, 'SalesmanDim');
    const topSalesmanSql = generatePerformanceTopSalesmanQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      limit,
      periodBounds,
      dateField,
      planScope,
      topSalesmanRlsBranchCode
    );

    const {
      summaryRows,
      trendRows,
      drillSummaryRows,
      drillRows,
      topSalesmanRows,
    } = await runPerformanceBundleQueries(
      (sql, cacheTtlMs) => duckdbService.query(sql, cacheTtlMs),
      {
        summarySql,
        trendSql,
        drillSummarySql,
        drillRowsSql,
        topSalesmanSql,
        cacheTtlMs: QUERY_CACHE.hotspotShort,
      }
    );

    const bundleData = {
      summary: { rows: summaryRows },
      trend: { rows: trendRows },
      drilldown: {
        summary: drillSummaryRows[0] || null,
        rows: drillRows,
        drillPath,
        groupBy: groupBy || null,
      },
      topSalesman: { rows: topSalesmanRows },
    };
    setRouteCache(routeCacheKey, bundleData, QUERY_CACHE.hotspotShort);

    sendWithEtag(req, res, {
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    }, HTTP_MAX_AGE.bundle);
  })
);

export default router;
