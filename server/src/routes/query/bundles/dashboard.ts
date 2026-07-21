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
  resolveBranchRlsCode,
  getRequestBranchCode,
  resolveRequiredPlanFactBranchCode,
  requirePermissionFilter,
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

export const dashboardBundleSchema = z.object({
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
        // 0B：cache_key 用 permissionFilter 段（permission.ts 注入），与 cache-warmer 写入侧自洽。
        // 0E codex P2：增加 b=<branchCode> 段，与 shared.ts buildRouteCacheKey + cache-warmer Tier 1 写入侧严格对齐 —
        //   兼容期所有 admin permissionFilter='1=1'，仅靠 permissionFilter 段无法防止 SC 用户先请求让 SX/全国
        //   admin 命中错误 group_name 等响应体。
        // - flag off + admin SC.branchCode='SC' → key='dashboard-bundle|default|1=1|b=SC'
        // - flag off + 系统级超管 branchCode undefined → key='...|b=_'
        // - flag on + admin SC → key='...|branch_code=\'SC\'|b=SC'
        // 全国超管切省（codex 闸-1 P2-1）：用 effectiveBranch 区分 SC/SX/ALL。
        //   切单省（SC/SX）→ effectiveBranch==该省码、permissionFilter 同 → 命中 cache-warmer 该省预热；
        //   切 ALL → b=ALL（预热侧无此变体）→ miss → 走实时查询（正确合并，冷启动可接受，预热侧 ALL 变体后续再补）。
        //   普通用户 effectiveBranch==branchCode → 读 key 字节不变。
        const branchSegment = `b=${req.effectiveBranch ?? req.user?.branchCode ?? '_'}`;
        const tier1CacheKey = `dashboard-bundle|default|${req.permissionFilter || '1=1'}|${branchSegment}`;
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
      requirePermissionFilter(req.permissionFilter)
    );

    // 分省 RLS：kpi-detail 内同城/异地名单按省切换；KPI 计划表按各自关系独立门控。
    const [branchCode, achievementCacheBranchCode, organizationPlanBranchCode] = await Promise.all([
      resolveBranchRlsCode(req, 'PolicyFact'),
      resolveBranchRlsCode(req, 'achievement_cache'),
      resolveRequiredPlanFactBranchCode(req),
    ]);

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
      dateField: filterData.dateField || 'policy_date',
      branchCode,
      achievementCacheBranchCode: achievementCacheBranchCode ?? null,
      organizationPlanBranchCode: organizationPlanBranchCode ?? null,
      requestBranchCode: getRequestBranchCode(req) ?? null,
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
  dateField,
  branchCode,
  achievementCacheBranchCode,
  organizationPlanBranchCode,
  requestBranchCode,
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
  /** 省份代码（'SC'/'SX'）；未传时回退 SC 名单，SQL 字节与改动前一致（字节安全）。G6 follow-up。*/
  branchCode?: string;
  /** achievement_cache 计划关系的分省码，必须由该关系自身列门控解析。 */
  achievementCacheBranchCode?: string | null;
  /** PlanFact 计划关系的分省码，必须由该关系自身列门控解析。 */
  organizationPlanBranchCode?: string | null;
  /** 请求业务省份；PlanFact 未就绪时仍用于保持 SX 计划为空且禁止回退。 */
  requestBranchCode?: string | null;
}) {
  const kpiSql = generateKpiQuery(
    whereWithDate,
    {
      orgNames,
      salesmanNames,
      achievementCacheBranchCode: achievementCacheBranchCode !== undefined
        ? achievementCacheBranchCode
        : branchCode,
      organizationPlanBranchCode,
      requestBranchCode,
    },
    whereWithoutDate,
    dateField
  );
  const kpiDetailSql = generateKpiDetailQuery(whereWithDate, false, branchCode);
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
