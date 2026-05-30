/**
 * Performance bundle route: GET /performance-bundle
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildBothWhere,
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

const performanceBundleSchema = z.object({
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

    const { whereWithDate, whereWithoutDate, dateField } = parseFiltersAndBuildBothWhere(req);
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
      dateField
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
        dateField
      )
      : null;
    const topSalesmanSql = generatePerformanceTopSalesmanQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      limit,
      periodBounds,
      dateField
    );

    const [summaryRows, trendRows, drillSummaryRows, drillRows, topSalesmanRows] = await Promise.all([
      duckdbService.query(summarySql, QUERY_CACHE.hotspotShort),
      duckdbService.query(trendSql, QUERY_CACHE.hotspotShort),
      duckdbService.query(drillSummarySql, QUERY_CACHE.hotspotShort),
      drillRowsSql ? duckdbService.query(drillRowsSql, QUERY_CACHE.hotspotShort) : Promise.resolve([]),
      duckdbService.query(topSalesmanSql, QUERY_CACHE.hotspotShort),
    ]);

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
