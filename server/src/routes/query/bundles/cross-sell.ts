/**
 * Cross-sell bundle route: GET /cross-sell-bundle
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
  createDomainMiddleware, resolveBranchRlsCode,
} from '../shared.js';
import {
  CROSS_SELL_DIMENSIONS,
  getSeatCoverageClause,
  buildCrossSellAggInsuranceClause,
  ensureCrossSellAggregateTablesReady,
  sanitizeAggQuery,
  type CrossSellSeatCoverageLevel,
} from '../cross-sell.js';
import { generateCrossSellQuery, type CrossSellDimension, type DrilldownStep } from '../../../sql/cross-sell.js';
import { generateCrossSellTimePeriodQuery, getVehicleCategoryFilter, type VehicleCategory } from '../../../sql/cross-sell-summary.js';
import { generateCrossSellTrendQuery, type TrendGranularity } from '../../../sql/cross-sell-trend.js';
import { generateCrossSellTopSalesmanQuery } from '../../../sql/cross-sell-top-salesman.js';

export const crossSellBundleSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(CROSS_SELL_DIMENSIONS).optional(),
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
});

const router = Router();

router.get(
  '/cross-sell-bundle',
  // 294022：本路由 SQL 直查 CrossSellDailyAgg，此前无惰性域中间件——修复前靠
  // "CrossSell 在 listen 前物化完成"兜底；预热移到 listen 后异步后，降级窗口内
  // 裸查会抛 table not found（500）。补挂中间件对齐 cross-sell.ts 其余路由的
  // 降级语义（加载等待 ≤15s，超时 503+Retry-After）。
  createDomainMiddleware('CrossSell'),
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
      }, HTTP_MAX_AGE.bundle);
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

    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req, sanitizeAggQuery(req.query));
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

    // 分省 RLS：团队/业务员维度剥列 CTE 按省过滤，免同名业务员跨省保费扇出
    // （summaryGroupName 传 undefined 沿用默认 '四川分公司'，与现网逐字节一致）
    const rlsBranchCode = await resolveBranchRlsCode(req, 'SalesmanTeamMapping');
    const drillSummarySql = generateCrossSellQuery(
      withDateWhere,
      drillPath,
      null,
      undefined,
      rlsBranchCode
    );
    const drillRowsSql = groupBy
      ? generateCrossSellQuery(withDateWhere, drillPath, groupBy as CrossSellDimension, undefined, rlsBranchCode)
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
    }, HTTP_MAX_AGE.bundle);
  })
);

export default router;
