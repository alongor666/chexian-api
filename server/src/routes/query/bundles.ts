/**
 * Bundle routes for aggregated multi-query endpoints.
 * Consolidates dashboard-bundle, performance-bundle, and cross-sell-bundle.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildBothWhere,
  extractOrgNames, extractSalesmanNames, resolveGroupDim,
  logger, QUERY_CACHE,
  isBundleRoutesEnabled, buildRouteCacheKey,
  getRouteCache, setRouteCache,
  markRequestCacheHit, sendWithEtag, buildResponseMeta,
} from './shared.js';
import { buildWhereFromFilterParams } from '../../utils/filter-params.js';
import {
  CROSS_SELL_DIMENSIONS,
  getSeatCoverageClause,
  buildCrossSellAggInsuranceClause,
  ensureCrossSellAggregateTablesReady,
  type CrossSellSeatCoverageLevel,
  CROSS_SELL_SEAT_COVERAGE_LEVELS_WITH_ALL,
  buildPolicyFactInsuranceClause,
} from './cross-sell.js';
import { generateKpiQuery } from '../../sql/kpi.js';
import { generateKpiDetailQuery } from '../../sql/kpi-detail.js';
import { generatePremiumTrendQuery, generateQualityBusinessTrendQuery, TimeView } from '../../sql/trend.js';
import type { ViewPerspective } from '../../types/view-perspective.js';
import type { DateCriteria } from '../../types/data.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../../sql/salesman-ranking.js';
import { generateCrossSellQuery, type CrossSellDimension, type DrilldownStep } from '../../sql/cross-sell.js';
import { generateCrossSellTimePeriodQuery, getVehicleCategoryFilter, type VehicleCategory } from '../../sql/cross-sell-summary.js';
import { generateCrossSellTrendQuery, type TrendGranularity } from '../../sql/cross-sell-trend.js';
import { generateCrossSellTopSalesmanQuery, type TopSalesmanCoverage } from '../../sql/cross-sell-top-salesman.js';
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
} from '../../sql/performance-analysis.js';
import {
  PERFORMANCE_DIMENSIONS,
  PERFORMANCE_SEGMENT_TAGS,
  PERFORMANCE_LEGACY_CATEGORIES,
  PERFORMANCE_EXPAND_DIMS,
  resolvePerformanceSegmentTag,
  mapPerformanceTimeToGranularity,
} from './performance.js';

// ============================================================
// Dashboard bundle helpers
// ============================================================

const granularityMap: Record<string, string> = {
  day: 'daily', week: 'weekly', month: 'monthly',
  daily: 'daily', weekly: 'weekly', monthly: 'monthly',
};

// ============================================================
// Router
// ============================================================

const router = Router();

// ============================================================
// Cross-sell Bundle
// ============================================================

const crossSellBundleSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(CROSS_SELL_DIMENSIONS).optional(),
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
});

router.get(
  '/cross-sell-bundle',
  asyncHandler(async (req, res) => {
    if (!isBundleRoutesEnabled()) {
      throw new AppError(503, 'Cross-sell bundle route is disabled');
    }

    const parseResult = crossSellBundleSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const routeCacheKey = buildRouteCacheKey(req, 'cross-sell-bundle');
    const cachedBundleData = getRouteCache<Record<string, unknown>>(routeCacheKey);
    if (cachedBundleData) {
      markRequestCacheHit();
      sendWithEtag(req, res, {
        success: true,
        data: cachedBundleData,
        meta: buildResponseMeta(res),
      }, 60);
      return;
    }
    await ensureCrossSellAggregateTablesReady();

    const {
      drillPath: drillPathRaw,
      groupBy,
      granularity,
      timePeriod,
    } = parseResult.data;
    const normalizedVehicleCategory: VehicleCategory = 'passenger';
    const normalizedSeatCoverageLevel: CrossSellSeatCoverageLevel = 'all';

    let drillPath: DrilldownStep[] = [];
    try {
      const parsed = JSON.parse(drillPathRaw);
      if (Array.isArray(parsed)) {
        drillPath = parsed.map((s: any) => ({
          dimension: String(s.dimension) as CrossSellDimension,
          value: String(s.value),
        }));
      }
    } catch {
      throw new AppError(400, 'Invalid drillPath JSON');
    }

    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
    const seatCoverageClause = getSeatCoverageClause(normalizedSeatCoverageLevel);

    let withDateWhere = `${whereWithDate} AND ${getVehicleCategoryFilter(normalizedVehicleCategory)}`;
    let withoutDateWhere = `${whereWithoutDate} AND ${getVehicleCategoryFilter(normalizedVehicleCategory)}`;
    if (seatCoverageClause) {
      withDateWhere += ` AND ${seatCoverageClause}`;
      withoutDateWhere += ` AND ${seatCoverageClause}`;
    }
    const insuranceClause = buildCrossSellAggInsuranceClause(req.query.insuranceType);
    if (insuranceClause) {
      withDateWhere += ` AND ${insuranceClause}`;
      withoutDateWhere += ` AND ${insuranceClause}`;
    }

    const trendSql = generateCrossSellTrendQuery(
      withDateWhere,
      normalizedVehicleCategory,
      granularity as TrendGranularity
    );

    const timePeriodSql = generateCrossSellTimePeriodQuery(
      withDateWhere,
      normalizedVehicleCategory
    );

    const drillSummarySql = generateCrossSellQuery(
      withDateWhere,
      drillPath,
      null
    );
    const drillRowsSql = groupBy
      ? generateCrossSellQuery(withDateWhere, drillPath, groupBy as CrossSellDimension)
      : null;

    const zhuquanTopSalesmanSql = generateCrossSellTopSalesmanQuery(
      withoutDateWhere,
      normalizedVehicleCategory,
      '主全',
      timePeriod
    );
    const jiaosanTopSalesmanSql = generateCrossSellTopSalesmanQuery(
      withoutDateWhere,
      normalizedVehicleCategory,
      '交三',
      timePeriod
    );

    const maxDateSql = `
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date
      FROM CrossSellDailyAgg
      WHERE ${withDateWhere}
    `;

    const [
      trendRows,
      timePeriodRows,
      drillSummaryRows,
      drillRows,
      zhuquanTopSalesmanRows,
      jiaosanTopSalesmanRows,
      maxDateRows,
    ] = await Promise.all([
      duckdbService.query(trendSql, QUERY_CACHE.hotspotMedium),
      duckdbService.query(timePeriodSql, QUERY_CACHE.hotspotMedium),
      duckdbService.query(drillSummarySql, QUERY_CACHE.hotspotShort),
      drillRowsSql ? duckdbService.query(drillRowsSql, QUERY_CACHE.hotspotShort) : Promise.resolve([]),
      duckdbService.query(zhuquanTopSalesmanSql, QUERY_CACHE.hotspotShort),
      duckdbService.query(jiaosanTopSalesmanSql, QUERY_CACHE.hotspotShort),
      duckdbService.query(maxDateSql, QUERY_CACHE.hotspotMedium),
    ]);

    const bundleData = {
      summary: {
        maxDate: maxDateRows[0]?.max_date || null,
        rows: timePeriodRows,
      },
      trend: {
        rows: trendRows,
      },
      drilldown: {
        summary: drillSummaryRows[0] || null,
        rows: drillRows,
        drillPath,
        groupBy: groupBy || null,
      },
      topSalesman: {
        zhuquanRows: zhuquanTopSalesmanRows,
        jiaosanRows: jiaosanTopSalesmanRows,
      },
    };
    setRouteCache(routeCacheKey, bundleData, QUERY_CACHE.hotspotShort);

    sendWithEtag(req, res, {
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    }, 60);
  })
);

// ============================================================
// Performance Bundle
// ============================================================

/**
 * GET /api/query/performance-bundle
 * 业绩分析页面聚合端点：summary + trend + drilldown + topSalesman
 */
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
      }, 60);
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

    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
    const trendGranularity = (granularity || mapPerformanceTimeToGranularity(timePeriod as PerformanceTimePeriod)) as PerformanceTrendGranularity;
    const periodBoundsSql = generatePerformancePeriodBoundsQuery(
      whereWithDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode
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
      periodBounds
    );
    const trendSql = generatePerformanceTrendQuery(
      whereWithDate,
      segmentTag as PerformanceSegmentTag,
      trendGranularity
    );
    const drillSummarySql = generatePerformanceDrilldownQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      drillPath,
      null,
      periodBounds
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
        periodBounds
      )
      : null;
    const topSalesmanSql = generatePerformanceTopSalesmanQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      limit,
      periodBounds
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
    }, 60);
  })
);

// ============================================================
// Dashboard Bundle
// ============================================================

/**
 * GET /api/query/dashboard-bundle
 * 仪表盘聚合端点：kpi + kpi-detail + trend + quality-trend + ranking + rose
 */
const dashboardBundleSchema = z.object({
  timeView: z.string().optional(),
  granularity: z.string().optional(),
  perspective: z.enum(['premium', 'policy_count']).optional(),
  rankingLimit: z.coerce.number().default(10),
});

router.get(
  '/dashboard-bundle',
  asyncHandler(async (req, res) => {
    if (!isBundleRoutesEnabled()) {
      throw new AppError(503, 'Dashboard bundle route is disabled');
    }

    const parseResult = dashboardBundleSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }
    const routeCacheKey = buildRouteCacheKey(req, 'dashboard-bundle');
    const cachedBundleData = getRouteCache<Record<string, unknown>>(routeCacheKey);
    if (cachedBundleData) {
      markRequestCacheHit();
      sendWithEtag(req, res, {
        success: true,
        data: cachedBundleData,
        meta: buildResponseMeta(res),
      }, 30);
      return;
    }
    const { perspective = 'premium', rankingLimit } = parseResult.data;
    const timeView = (granularityMap[
      parseResult.data.timeView || parseResult.data.granularity || 'weekly'
    ] || 'weekly') as TimeView;

    const { filterData, whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
    const groupDim = resolveGroupDim(filterData, req);

    const orgNames = extractOrgNames(filterData, req.permissionFilter);
    const salesmanNames = extractSalesmanNames(filterData, req.permissionFilter);

    // 检查是否符合 Tier 1 绝对默认条件
    // 默认条件：没有选机构、没有选业务员、时间范围是整年（简化判断：通过前端不传额外的 filtering details 即可）
    // 为了极致性能，我们可以简单判断是否有额外的 filterData (例如 org_filter, salesman_filter, customer_category_filter)
    const isDefaultCondition =
      orgNames.length === 0 &&
      salesmanNames.length === 0 &&
      !filterData.customerCategories &&
      !filterData.coverageCombinations &&
      !filterData.renewalModes &&
      !filterData.tonnageSegments &&
      !filterData.insuranceGrades &&
      !filterData.isRenewal &&
      !filterData.isNewCar &&
      !filterData.isTransfer &&
      !filterData.isNev &&
      !filterData.isTelemarketing &&
      !filterData.isCommercialInsure &&
      !filterData.vehicleQuickFilter &&
      !filterData.businessNature &&
      filterData.dateField === 'policy_date' &&
      timeView === 'daily' &&
      perspective === 'premium';

    if (isDefaultCondition) {
      try {
        const defaultCacheRows = await duckdbService.query<{ json_data: string }>(
          `SELECT json_data FROM DefaultDashboardCache WHERE cache_key = 'dashboard-bundle|default'`
        );
        if (defaultCacheRows.length > 0 && defaultCacheRows[0].json_data) {
          logger.info('[query.ts] Tier 1 Hard Cache Hit for dashboard-bundle!');
          const bundleData = JSON.parse(defaultCacheRows[0].json_data);
          markRequestCacheHit();
          sendWithEtag(req, res, {
            success: true,
            data: bundleData,
            meta: buildResponseMeta(res),
          }, 60); // 暂存更久一点
          return;
        }
      } catch (e) {
        logger.warn('[query.ts] Failed to read DefaultDashboardCache, falling back to execution.', e);
      }
    }

    // 构建上年趋势 WHERE（日期平移一年，保留其他筛选条件）
    const prevYearFilterData = { ...filterData };
    if (prevYearFilterData.startDate) {
      prevYearFilterData.startDate = prevYearFilterData.startDate.replace(
        /^\d{4}/, String(parseInt(prevYearFilterData.startDate.slice(0, 4)) - 1)
      );
    }
    if (prevYearFilterData.endDate) {
      prevYearFilterData.endDate = prevYearFilterData.endDate.replace(
        /^\d{4}/, String(parseInt(prevYearFilterData.endDate.slice(0, 4)) - 1)
      );
    }
    const prevYearWhereWithDate = buildWhereFromFilterParams(
      prevYearFilterData,
      req.permissionFilter || '1=1'
    );

    // Tier 3: 动态执行 Fallback
    const bundleData = await fetchDashboardBundleData({
      whereWithDate,
      whereWithoutDate,
      prevYearWhereWithDate,
      orgNames,
      salesmanNames,
      rankingLimit,
      timeView,
      perspective,
      groupDim,
      dateField: filterData.dateField || 'policy_date'
    });

    setRouteCache(routeCacheKey, bundleData, QUERY_CACHE.hotspotShort);

    sendWithEtag(req, res, {
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    }, 30);
  })
);

export async function fetchDashboardBundleData({
  whereWithDate,
  whereWithoutDate,
  prevYearWhereWithDate,
  orgNames,
  salesmanNames,
  rankingLimit,
  timeView,
  perspective,
  groupDim,
  dateField
}: {
  whereWithDate: string;
  whereWithoutDate: string;
  prevYearWhereWithDate?: string;
  orgNames: string[];
  salesmanNames: string[];
  rankingLimit: number;
  timeView: TimeView;
  perspective: ViewPerspective;
  groupDim?: string;
  dateField: DateCriteria;
}) {
  const kpiSql = generateKpiQuery(whereWithDate, { orgNames, salesmanNames }, whereWithoutDate);
  const kpiDetailSql = generateKpiDetailQuery(whereWithDate, false);
  const trendSql = generatePremiumTrendQuery(
    timeView,
    whereWithDate,
    dateField,
    perspective,
    groupDim || undefined
  );
  // 上年同期趋势（用于同比对照柱状图）
  const trendPrevSql = prevYearWhereWithDate
    ? generatePremiumTrendQuery(
        timeView,
        prevYearWhereWithDate,
        dateField,
        perspective,
        groupDim || undefined
      )
    : null;
  const qualityTrendSql = generateQualityBusinessTrendQuery(
    timeView,
    whereWithDate,
    dateField,
    perspective,
    groupDim || undefined
  );
  const allRankingSql = generateSalesmanAllBusinessRankingQuery(whereWithDate, rankingLimit);
  const qualityRankingSql = generateSalesmanQualityBusinessRankingQuery(whereWithDate, rankingLimit);
  const customerRoseSql = `
      SELECT COALESCE(customer_category, '未知') AS dim_key, SUM(premium) AS value
      FROM PolicyFact
      WHERE ${whereWithDate}
      GROUP BY COALESCE(customer_category, '未知')
      ORDER BY value DESC
    `;
  const coverageRoseSql = `
      SELECT COALESCE(coverage_combination, '未知') AS dim_key, SUM(premium) AS value
      FROM PolicyFact
      WHERE ${whereWithDate}
      GROUP BY COALESCE(coverage_combination, '未知')
      ORDER BY value DESC
    `;
  const terminalRoseSql = `
      SELECT
        CASE WHEN is_telemarketing THEN '电销' ELSE '非电销' END AS dim_key,
        SUM(premium) AS value
      FROM PolicyFact
      WHERE ${whereWithDate}
      GROUP BY CASE WHEN is_telemarketing THEN '电销' ELSE '非电销' END
      ORDER BY value DESC
    `;

  const [kpiRows, kpiDetailRows, trendRows, trendPrevRows, qualityTrendRows, allRankingRows, qualityRankingRows, customerRoseRows, coverageRoseRows, terminalRoseRows] = await Promise.all([
    duckdbService.query(kpiSql, QUERY_CACHE.hotspotLong),
    duckdbService.query(kpiDetailSql, QUERY_CACHE.hotspotLong),
    duckdbService.query(trendSql, QUERY_CACHE.hotspotLong),
    trendPrevSql ? duckdbService.query(trendPrevSql, QUERY_CACHE.hotspotLong) : Promise.resolve([]),
    duckdbService.query(qualityTrendSql, QUERY_CACHE.hotspotLong),
    duckdbService.query(allRankingSql, QUERY_CACHE.hotspotMedium),
    duckdbService.query(qualityRankingSql, QUERY_CACHE.hotspotMedium),
    duckdbService.query(customerRoseSql, QUERY_CACHE.hotspotMedium),
    duckdbService.query(coverageRoseSql, QUERY_CACHE.hotspotMedium),
    duckdbService.query(terminalRoseSql, QUERY_CACHE.hotspotMedium),
  ]);

  return {
    kpi: kpiRows[0] || {},
    kpiDetail: kpiDetailRows[0] || {},
    trend: [...trendPrevRows, ...trendRows],
    qualityTrend: qualityTrendRows,
    ranking: {
      allBusinessTop: allRankingRows,
      qualityBusinessTop: qualityRankingRows,
    },
    rose: {
      customerCategory: customerRoseRows,
      coverageCombination: coverageRoseRows,
      terminalSource: terminalRoseRows,
    },
  };
}

export default router;
