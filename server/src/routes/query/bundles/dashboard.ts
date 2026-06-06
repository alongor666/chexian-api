/**
 * Dashboard bundle route: GET /dashboard-bundle
 * Also exports fetchDashboardBundleData for use by the warm-cache path.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  parseFiltersAndBuildBothWhere,
  extractOrgNames, extractSalesmanNames, resolveGroupDim,
  logger, QUERY_CACHE, HTTP_MAX_AGE,
  isBundleRoutesEnabled, buildRouteCacheKey,
  getRouteCache, setRouteCache,
  markRequestCacheHit, sendWithEtag, buildResponseMeta,
} from '../shared.js';
import { buildWhereFromFilterParams } from '../../../utils/filter-params.js';
import { generateKpiQuery } from '../../../sql/kpi.js';
import { generateKpiDetailQuery } from '../../../sql/kpi-detail.js';
import { generatePremiumTrendQuery, generateQualityBusinessTrendQuery, TimeView } from '../../../sql/trend.js';
import type { ViewPerspective } from '../../../types/view-perspective.js';
import type { DateCriteria } from '../../../types/data.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../../../sql/salesman-ranking.js';

// ============================================================
// Dashboard bundle helpers
// ============================================================

const granularityMap: Record<string, string> = {
  day: 'daily', week: 'weekly', month: 'monthly',
  daily: 'daily', weekly: 'weekly', monthly: 'monthly',
};

const dashboardBundleSchema = z.object({
  timeView: z.string().optional(),
  granularity: z.string().optional(),
  perspective: z.enum(['premium', 'policy_count']).optional(),
  rankingLimit: z.coerce.number().default(10),
});

const router = Router();

/**
 * GET /api/query/dashboard-bundle
 * 仪表盘聚合端点：kpi + kpi-detail + trend + quality-trend + ranking + rose
 */
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
      }, HTTP_MAX_AGE.bundle);
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
        // 0B：cache_key 用 permissionFilter 段（permission.ts 注入），与 cache-warmer 写入侧自洽：
        // - flag off：permissionFilter='1=1' → key='dashboard-bundle|default|1=1'
        // - flag on：permissionFilter=`branch_code='SC'` → key='dashboard-bundle|default|branch_code=\'SC\''
        // 这样无需 dashboard.ts 知道 flag 状态，直接读 req.permissionFilter 即可。
        const tier1CacheKey = `dashboard-bundle|default|${req.permissionFilter || '1=1'}`;
        const escapedKey = tier1CacheKey.replace(/'/g, "''");
        const defaultCacheRows = await duckdbService.query<{ json_data: string }>(
          `SELECT json_data FROM DefaultDashboardCache WHERE cache_key = '${escapedKey}'`
        );
        if (defaultCacheRows.length > 0 && defaultCacheRows[0].json_data) {
          logger.info('[query.ts] Tier 1 Hard Cache Hit for dashboard-bundle!');
          const bundleData = JSON.parse(defaultCacheRows[0].json_data);
          markRequestCacheHit();
          sendWithEtag(req, res, {
            success: true,
            data: bundleData,
            meta: buildResponseMeta(res),
          }, HTTP_MAX_AGE.bundle);
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
    }, HTTP_MAX_AGE.bundle);
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
