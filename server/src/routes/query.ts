/**
 * 查询路由
 * Query Routes
 *
 * Phase 1:
 * GET /api/query/kpi - KPI查询
 * GET /api/query/kpi-detail - KPI详细数据（占比分解，支持环形图）
 * GET /api/query/trend - 趋势查询
 *
 * Phase 2:
 * GET /api/query/truck - 营业货车分析
 * GET /api/query/growth - 增长率分析
 * GET /api/query/coefficient - 系数监控
 * GET /api/query/cost - 成本分析
 * GET /api/query/renewal - 续保分析
 * GET /api/query/cross-sell - 车驾意推介率
 * GET /api/query/salesman-ranking - 业务员排名
 * POST /api/query/custom - 自定义SQL查询
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware } from '../middleware/permission.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { duckdbService } from '../services/duckdb.js';
import { permissionService } from '../services/permission.js';
import { generateKpiQuery } from '../sql/kpi.js';
import { generateKpiDetailQuery } from '../sql/kpi-detail.js';
import { generatePremiumTrendQuery, generateQualityBusinessTrendQuery, TimeView } from '../sql/trend.js';
import type { ViewPerspective } from '../types/view-perspective.js';
// Phase 2 SQL Generators
import { generateTonnageRoseQuery, generateOrgByTonnageQuery, generateTonnageByOrgQuery } from '../sql/truck.js';
import {
  generateGrowthQuery,
  generateDailyGrowthWithContextQuery,
  generateYoYGrowthQueryV2,
  generateMoMGrowthQueryV2,
  generateYTDGrowthQueryV2,
  GrowthConfig,
  GrowthType,
  TimeView as GrowthTimeView,
} from '../sql/growth.js';
import { generateCoefficientByOrgQuery, generateFullCoefficientQuery } from '../sql/coefficient.js';
import {
  generateClaimRatioQuery,
  generateExpenseRatioQuery,
  generateComprehensiveCostQuery,
  generateVariableCostQuery,
  generateEarnedPremiumQuery,
  generatePolicy2025In2025Query,
  generatePolicy2025In2026Query,
  generatePolicy2026In2026Query,
  generatePolicy2026In2027Query,
  generateNewEarnedPremiumSummaryQuery,
  generateNewEarnedPremiumSummaryQueryV2,
  generateMonthlyExpenseQuery,
  CostDimension,
} from '../sql/cost.js';
import { generateRenewalRateQuery, generateRenewalDetailTableQuery } from '../sql/renewal.js';
import { generateRenewalDrilldownQuery, type DrilldownDimension, type DrilldownLevel, type SortField, type SortOrder } from '../sql/renewal-drilldown.js';
import { generateCrossSellQuery, type CrossSellDimension, type DrilldownStep } from '../sql/cross-sell.js';
import { generateCrossSellTimePeriodQuery, getVehicleCategoryFilter, type VehicleCategory } from '../sql/cross-sell-summary.js';
import { generateCrossSellTrendQuery, type TrendGranularity } from '../sql/cross-sell-trend.js';
import { generateCrossSellOrgTrendQuery, type CoverageCombinationFilter } from '../sql/cross-sell-org-trend.js';
import { generateCrossSellTopSalesmanQuery, type TopSalesmanCoverage } from '../sql/cross-sell-top-salesman.js';
import {
  generatePerformancePeriodBoundsQuery,
  generatePerformanceSummaryQuery,
  generatePerformanceTrendQuery,
  generatePerformanceDrilldownQuery,
  generatePerformanceTopSalesmanQuery,
  mapLegacyVehicleCategoryToSegmentTag,
  type PerformancePeriodBounds,
  type PerformanceSegmentTag,
  type PerformanceVehicleCategory,
  type PerformanceGrowthMode,
  type PerformanceTimePeriod,
  type PerformanceTrendGranularity,
  type PerformanceSummaryExpandDims,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
} from '../sql/performance-analysis.js';
import { generateOrgHolidayReportQuery, generateSalesmanHolidayDetailQuery } from '../sql/marketing-report.js';
import { generateOrgPremiumReportQuery, generateSalesmanPremiumReportQuery } from '../sql/premium-report.js';
import { generatePremiumPlanDrilldownQuery, generateKPICardQuery, generateRateDistributionQuery, generatePlanAchievementPanel, type PlanDrilldownDimension, type PlanDrilldownLevel, type PlanSortField, type SortOrder as PlanSortOrder } from '../sql/premiumPlan.js';
import type { AdvancedFilterState } from '../types/data.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../sql/salesman-ranking.js';
import { validateSQL } from '../utils/sql-validator.js';
import { isValidDateFormat } from '../utils/sql-sanitizer.js';
import { injectPermissionFilter, isValidPermissionFilter } from '../utils/sql-permission-injector.js';
import { commonFilterSchema, buildWhereFromFilterParams, buildWhereFromFilterParamsWithoutDate } from '../utils/filter-params.js';
import { parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames, resolveGroupDim } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import { buildResponseMeta } from '../utils/api-meta.js';
import { markRequestCacheHit } from '../utils/request-context.js';

const router = Router();

const QUERY_CACHE = {
  hotspotShort: 30_000,
  hotspotMedium: 45_000,
  hotspotLong: 60_000,
} as const;

interface RouteCacheEntry<T> {
  data: T;
  expiry: number;
}

const routeResponseCache = new Map<string, RouteCacheEntry<unknown>>();

function buildRouteCacheKey(req: Request, routeName: string): string {
  const normalizedQuery = Object.entries(req.query)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return `${routeName}|${req.permissionFilter || '1=1'}|${normalizedQuery}`;
}

function getRouteCache<T>(key: string): T | null {
  const entry = routeResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    routeResponseCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setRouteCache<T>(key: string, data: T, ttlMs: number): void {
  if (routeResponseCache.size >= 500) {
    const oldestKey = routeResponseCache.keys().next().value;
    if (oldestKey) {
      routeResponseCache.delete(oldestKey);
    }
  }
  routeResponseCache.set(key, {
    data,
    expiry: Date.now() + ttlMs,
  });
}

function isBundleRoutesEnabled(): boolean {
  return process.env.ENABLE_QUERY_BUNDLES !== 'false';
}

function shouldUseGrowthV2(config: GrowthConfig): boolean {
  if (process.env.ENABLE_GROWTH_V2 === 'false') return false;
  if (!['yoy', 'mom', 'ytd'].includes(config.growthType)) return false;
  if (config.timeView !== 'monthly') return false;

  // V2 的 PeriodAggregated 不包含原始日期字段，遇到日期条件则回退 V1。
  const where = config.whereClause || '';
  if (/policy_date|insurance_start_date/i.test(where)) return false;
  return true;
}

function buildGrowthV2Sql(config: GrowthConfig): string {
  switch (config.growthType) {
    case 'yoy':
      return generateYoYGrowthQueryV2(config);
    case 'mom':
      return generateMoMGrowthQueryV2(config);
    case 'ytd':
      return generateYTDGrowthQueryV2(config);
    default:
      return generateGrowthQuery(config);
  }
}

/**
 * 应用认证和权限中间件到所有查询路由
 */
router.use(authMiddleware);
router.use(permissionMiddleware);

// ============================================================
// Phase 1 API Endpoints
// ============================================================

/**
 * GET /api/query/kpi
 * 获取KPI数据（保费、件数、占比等）
 * 支持完整高级筛选参数
 */
router.get(
  '/kpi',
  asyncHandler(async (req: Request, res: Response) => {
    const { filterData, whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);

    const orgNames = extractOrgNames(filterData, req.permissionFilter);
    const salesmanNames = extractSalesmanNames(filterData, req.permissionFilter);

    const sql = generateKpiQuery(
      whereWithDate,
      { orgNames, salesmanNames },
      whereWithoutDate
    );
    // KPI 高频查询，缓存 60 秒
    const result = await duckdbService.query(sql, 60_000);

    res.json({
      success: true,
      data: result[0] || {},
    });
  })
);

/**
 * GET /api/query/kpi-detail
 * 获取 KPI 详细数据（用于占比类指标的分解数据，支持迷你环形图）
 */
router.get(
  '/kpi-detail',
  asyncHandler(async (req: Request, res: Response) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);

    const sql = generateKpiDetailQuery(whereClause, false);
    // KPI 详情高频查询，缓存 60 秒
    const result = await duckdbService.query(sql, 60_000);

    res.json({
      success: true,
      data: result[0] || {},
    });
  })
);

/**
 * 趋势查询请求验证Schema
 * 兼容前端 granularity (day/week/month) 和后端 timeView (daily/weekly/monthly) 两种参数名
 */
const granularityMap: Record<string, string> = {
  day: 'daily', week: 'weekly', month: 'monthly',
  daily: 'daily', weekly: 'weekly', monthly: 'monthly',
};

const trendExtraSchema = z.object({
  timeView: z.string().optional(),
  granularity: z.string().optional(),
  perspective: z.enum(['premium', 'policy_count']).optional(),
});

/**
 * GET /api/query/trend
 * 获取保费趋势数据
 */
router.get(
  '/trend',
  asyncHandler(async (req: Request, res: Response) => {
    // 解析趋势特有参数
    const trendResult = trendExtraSchema.safeParse(req.query);
    const timeView = (granularityMap[
      trendResult.data?.timeView || trendResult.data?.granularity || 'daily'
    ] || 'daily') as 'daily' | 'weekly' | 'monthly';
    const perspective = (trendResult.data?.perspective || 'premium') as ViewPerspective;

    const { filterData, whereClause } = parseFiltersAndBuildWhere(req);
    const groupDim = resolveGroupDim(filterData, req);

    const sql = generatePremiumTrendQuery(
      timeView as TimeView,
      whereClause,
      filterData.dateField || 'policy_date',
      perspective,
      groupDim
    );
    // 趋势查询缓存 120 秒
    const result = await duckdbService.query(sql, 120_000);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * GET /api/query/quality-business-trend
 * 获取优质业务占比趋势数据
 */
router.get(
  '/quality-business-trend',
  asyncHandler(async (req: Request, res: Response) => {
    const trendResult = trendExtraSchema.safeParse(req.query);
    const timeView = (granularityMap[
      trendResult.data?.timeView || trendResult.data?.granularity || 'daily'
    ] || 'daily') as 'daily' | 'weekly' | 'monthly';
    const perspective = (trendResult.data?.perspective || 'premium') as ViewPerspective;

    const { filterData, whereClause } = parseFiltersAndBuildWhere(req);
    const groupDim = resolveGroupDim(filterData, req);

    const sql = generateQualityBusinessTrendQuery(
      timeView as TimeView,
      whereClause,
      filterData.dateField || 'policy_date',
      perspective,
      groupDim
    );
    const result = await duckdbService.query(sql, 120_000);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * GET /api/query/test
 * 测试查询端点（验证数据库连接和权限过滤）
 */
router.get(
  '/test',
  asyncHandler(async (req: Request, res: Response) => {
    const sql = `
      SELECT
        COUNT(*) as total_count,
        SUM(premium) as total_premium
      FROM PolicyFact
      WHERE ${req.permissionFilter || '1=1'}
    `;

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: {
        message: 'Database connection and permission filter working',
        user: req.user,
        permissionFilter: req.permissionFilter,
        queryResult: result[0],
      },
    });
  })
);

// ============================================================
// Phase 2 API Endpoints
// ============================================================

/**
 * 营业货车分析请求验证Schema（特有参数）
 */
const truckExtraSchema = z.object({
  queryType: z.enum(['rose', 'orgByTonnage', 'tonnageByOrg', 'all']).default('rose'),
  metric: z.enum(['premium', 'count']).default('premium'),
});

/**
 * GET /api/query/truck
 * 营业货车专项分析
 */
router.get(
  '/truck',
  asyncHandler(async (req: Request, res: Response) => {
    const truckResult = truckExtraSchema.safeParse(req.query);
    if (!truckResult.success) {
      throw new AppError(400, truckResult.error.issues[0].message);
    }
    const { queryType, metric } = truckResult.data;

    const { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    // queryType=all: 一次性返回所有4个子查询结果（前端货车面板需要）
    if (queryType === 'all') {
      const [rosePremium, roseCount, tonnageByOrg, orgPremium] = await Promise.all([
        duckdbService.query(generateTonnageRoseQuery('premium', finalWhereClause)),
        duckdbService.query(generateTonnageRoseQuery('count', finalWhereClause)),
        duckdbService.query(generateTonnageByOrgQuery(finalWhereClause)),
        duckdbService.query(generateOrgByTonnageQuery(finalWhereClause)),
      ]);

      res.json({
        success: true,
        data: { rosePremium, roseCount, tonnageByOrg, orgPremium },
      });
      return;
    }

    let sql: string;
    switch (queryType) {
      case 'rose':
        sql = generateTonnageRoseQuery(metric, finalWhereClause);
        break;
      case 'orgByTonnage':
        sql = generateOrgByTonnageQuery(finalWhereClause);
        break;
      case 'tonnageByOrg':
        sql = generateTonnageByOrgQuery(finalWhereClause);
        break;
      default:
        sql = generateTonnageRoseQuery(metric, finalWhereClause);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 增长率分析请求验证Schema
 */
const growthExtraSchema = z.object({
  growthType: z.enum(['yoy', 'mom', 'ytd', 'custom']).default('yoy'),
  timeView: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  baselineStart: z.string().optional(),
  baselineEnd: z.string().optional(),
  referenceYear: z.coerce.number().optional(),
  type: z.string().optional(),
});

/**
 * GET /api/query/growth
 * 增长率分析（同比/环比/年累计/自定义）
 */
router.get(
  '/growth',
  asyncHandler(async (req: Request, res: Response) => {
    const growthResult = growthExtraSchema.safeParse(req.query);
    if (!growthResult.success) {
      throw new AppError(400, growthResult.error.issues[0].message);
    }
    const { growthType, timeView, baselineStart, baselineEnd, referenceYear, type: queryType } = growthResult.data;

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const { startDate, endDate } = filterResult.data;

    // daily-context 类型：使用带月度/年度上下文的日度增长查询
    // 返回每日 current/previous 值 + period_total + ytd_total + 各级增长率
    if (queryType === 'daily-context' && startDate && endDate && baselineStart && baselineEnd) {
      if (!isValidDateFormat(baselineStart) || !isValidDateFormat(baselineEnd)) {
        throw new AppError(400, 'Invalid baseline date format. Expected YYYY-MM-DD');
      }

      // daily-context 不把日期放进 WHERE（由 SQL 的 currentPeriod/baselinePeriod 控制）
      const filterParamsNoDates = { ...filterResult.data, startDate: undefined, endDate: undefined };
      const finalWhereClause = buildWhereFromFilterParams(
        filterParamsNoDates,
        req.permissionFilter || '1=1'
      );

      // 获取视角指标
      const perspective = (req.query as any).perspective as string | undefined;
      const metric = perspective === 'count' ? 'COUNT(*)' : 'SUM(premium)';

      const config: GrowthConfig = {
        growthType: 'custom' as GrowthType,
        timeView: 'daily' as GrowthTimeView,
        whereClause: finalWhereClause,
        currentPeriod: { startDate, endDate },
        baselinePeriod: { startDate: baselineStart, endDate: baselineEnd },
        metric,
      };

      const sql = generateDailyGrowthWithContextQuery(config);
      const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

      res.json({
        success: true,
        data: result,
      });
      return;
    }

    // custom 增长类型：日期由 currentPeriod/baselinePeriod 分别控制，
    // whereClause 中不能包含日期条件，否则会与 baselinePeriod 的日期范围冲突导致基期数据为 0
    const filterParamsForWhere = growthType === 'custom' && baselineStart && baselineEnd
      ? { ...filterResult.data, startDate: undefined, endDate: undefined }
      : filterResult.data;

    const finalWhereClause = buildWhereFromFilterParams(
      filterParamsForWhere,
      req.permissionFilter || '1=1'
    );

    const config: GrowthConfig = {
      growthType: growthType as GrowthType,
      timeView: timeView as GrowthTimeView,
      whereClause: finalWhereClause,
      referenceYear: referenceYear || new Date().getFullYear(),
    };

    if (growthType === 'custom' && baselineStart && baselineEnd && startDate && endDate) {
      if (!isValidDateFormat(baselineStart) || !isValidDateFormat(baselineEnd)) {
        throw new AppError(400, 'Invalid baseline date format. Expected YYYY-MM-DD');
      }
      config.baselinePeriod = { startDate: baselineStart, endDate: baselineEnd };
      config.currentPeriod = { startDate, endDate };
    }

    const sql = shouldUseGrowthV2(config)
      ? buildGrowthV2Sql(config)
      : generateGrowthQuery(config);
    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 系数监控请求验证Schema
 */
const coefficientQuerySchema = z.object({
  queryType: z.enum(['byOrg', 'full', 'batch']).default('byOrg'),
  dateField: z.enum(['policy_date', 'insurance_start_date']).default('policy_date'),
  startDate: z.string(),
  endDate: z.string(),
  cutoffDate: z.string().optional(),
  analysisYear: z.coerce.number().optional(),
});

/**
 * GET /api/query/coefficient
 * 商车自主定价系数监控
 * 注意：系数监控使用独立的日期处理逻辑，不使用通用筛选
 */
router.get(
  '/coefficient',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = coefficientQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { queryType, dateField, startDate, endDate, cutoffDate, analysisYear } = parseResult.data;

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    // 权限 + 通用筛选（不含日期，系数接口使用独立日期参数）
    const permissionFilter = req.permissionFilter || '1=1';
    const finalWhereClauseWithoutDate = buildWhereFromFilterParamsWithoutDate(
      filterResult.data,
      permissionFilter
    );

    // queryType=batch: 返回结构化数据（成都/全省/各机构三层）
    if (queryType === 'batch') {
      const dateRange = {
        start: new Date(startDate),
        end: new Date(endDate),
      };

      const sql = generateFullCoefficientQuery(dateField, dateRange, finalWhereClauseWithoutDate);
      const rawData = await duckdbService.query(sql);

      const data = rawData.filter((r: Record<string, any>) => r.region_group !== 'chengdu' && r.region_group !== 'province');
      const provinceTop = rawData.filter((r: Record<string, any>) => r.org_level_3 === '全省');
      const chengduTop = rawData.filter((r: Record<string, any>) => r.org_level_3 === '成都');

      res.json({
        success: true,
        data: { data, periodGroups: [], provinceTop, chengduTop },
      });
      return;
    }

    const dateRange = {
      start: new Date(startDate),
      end: new Date(endDate),
    };

    let sql: string;
    if (queryType === 'byOrg') {
      sql = generateCoefficientByOrgQuery(dateField, dateRange, finalWhereClauseWithoutDate);
    } else {
      sql = generateFullCoefficientQuery(dateField, dateRange, finalWhereClauseWithoutDate);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 成本分析请求验证Schema（特有参数）
 */
const costExtraSchema = z.object({
  type: z.enum(['earned', 'earned-new', 'expense-forecast']).optional(),
  analysisType: z.enum(['claimRatio', 'expenseRatio', 'comprehensiveCost', 'variableCost']).optional(),
  dimension: z.enum(['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage']).default('org_level_3'),
  cutoffDate: z.string().optional(),
  operatingCostRate: z.string().optional(),
  policyMonth: z.string().optional(),
});

/**
 * GET /api/query/cost
 * 成本分析（赔付率/费用率/综合费用率/变动成本率）
 */
router.get(
  '/cost',
  asyncHandler(async (req: Request, res: Response) => {
    const costResult = costExtraSchema.safeParse(req.query);
    if (!costResult.success) {
      throw new AppError(400, costResult.error.issues[0].message);
    }
    const { type, analysisType, dimension, cutoffDate, operatingCostRate, policyMonth } = costResult.data;

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    // 新协议：type=earned/earned-new/expense-forecast
    if (type) {
      if (type === 'earned') {
        if (!cutoffDate) {
          throw new AppError(400, 'cutoffDate is required when type=earned');
        }
        if (!isValidDateFormat(cutoffDate)) {
          throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
        }

        const sql = generateEarnedPremiumQuery({
          cutoffDate,
          whereClause: finalWhereClause,
          policyMonth,
          orgLevel3: filterData.orgLevel3,
        });
        const result = await duckdbService.query(sql);
        res.json({ success: true, data: result });
        return;
      }

      if (type === 'earned-new') {
        const config = { whereClause: finalWhereClause };
        const [policy2025In2025, policy2025In2026, policy2026In2026, policy2026In2027] = await Promise.all([
          duckdbService.query(generatePolicy2025In2025Query(config)),
          duckdbService.query(generatePolicy2025In2026Query(config)),
          duckdbService.query(generatePolicy2026In2026Query(config)),
          duckdbService.query(generatePolicy2026In2027Query(config)),
        ]);

        res.json({
          success: true,
          data: {
            policy2025In2025,
            policy2025In2026,
            policy2026In2026,
            policy2026In2027,
          },
        });
        return;
      }

      // type=expense-forecast
      const parsedRate = operatingCostRate === undefined ? 9 : Number(operatingCostRate);
      if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        throw new AppError(400, `Invalid operatingCostRate: ${operatingCostRate}. Expected 0-100`);
      }

      const config = { whereClause: finalWhereClause };
      const summaryData = await duckdbService.query(
        generateNewEarnedPremiumSummaryQueryV2(config)
      ).catch(async () => {
        // 兼容未创建 EarnedPremiumMonthly 预聚合表的环境
        return duckdbService.query(generateNewEarnedPremiumSummaryQuery(config));
      });
      const monthlyExpenseData = await duckdbService.query(generateMonthlyExpenseQuery(config));

      res.json({
        success: true,
        data: {
          summaryData,
          monthlyExpenseData,
          operatingCostRate: parsedRate,
        },
      });
      return;
    }

    // 旧协议：analysisType + dimension + cutoffDate
    const finalAnalysisType = analysisType || 'claimRatio';
    if (!cutoffDate) {
      throw new AppError(400, 'cutoffDate is required for cost analysis');
    }
    if (!isValidDateFormat(cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
    }

    const config = {
      dimension: dimension as CostDimension,
      cutoffDate,
      whereClause: finalWhereClause,
    };

    let sql: string;
    switch (finalAnalysisType) {
      case 'claimRatio':
        sql = generateClaimRatioQuery(config);
        break;
      case 'expenseRatio':
        sql = generateExpenseRatioQuery(config);
        break;
      case 'comprehensiveCost':
        sql = generateComprehensiveCostQuery(config);
        break;
      case 'variableCost':
        sql = generateVariableCostQuery(config);
        break;
      default:
        sql = generateClaimRatioQuery(config);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 续保分析请求验证Schema（特有参数）
 */
const renewalExtraSchema = z.object({
  queryType: z.enum(['rate', 'detail', 'full']).default('rate'),
  targetYear: z.coerce.number().default(new Date().getFullYear()),
  targetMonth: z.coerce.number().default(new Date().getMonth() + 1),
  perspective: z.string().optional(),
});

/**
 * GET /api/query/renewal
 * 续保分析
 */
router.get(
  '/renewal',
  asyncHandler(async (req: Request, res: Response) => {
    const renewalResult = renewalExtraSchema.safeParse(req.query);
    if (!renewalResult.success) {
      throw new AppError(400, renewalResult.error.issues[0].message);
    }
    const { queryType, targetYear, targetMonth } = renewalResult.data;

    // 解析通用筛选参数
    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    // 构建筛选条件（AdvancedFilterState格式，供续保SQL生成器使用）
    const filters: AdvancedFilterState = {};

    // 从通用参数中提取机构筛选
    const orgNames = filterResult.data.orgNames?.split(',').filter(Boolean);
    if (orgNames && orgNames.length > 0) {
      filters.org_level_3 = orgNames;
    } else if (filterResult.data.orgLevel3) {
      filters.org_level_3 = [filterResult.data.orgLevel3];
    } else if (filterResult.data.orgName) {
      filters.org_level_3 = [filterResult.data.orgName];
    }

    // 权限过滤 - 添加到filters中
    const permissionFilter = req.permissionFilter || '1=1';
    if (permissionFilter !== '1=1') {
      const orgMatch = permissionFilter.match(/org_level_3\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
      if (orgMatch && !filters.org_level_3) {
        filters.org_level_3 = [orgMatch[1]];
      }

      const tmMatch = permissionFilter.match(/is_telemarketing\s*=\s*(true|false)/i);
      if (tmMatch) {
        filters.is_telemarketing = tmMatch[1].toLowerCase() === 'true';
      }
    }

    // queryType=full: 返回结构化数据（明细 + 可用月份 + 最新日期）
    if (queryType === 'full') {
      const detailSql = generateRenewalDetailTableQuery(filters, targetYear, targetMonth, 'premium');
      const detailData = await duckdbService.query(detailSql);

      const availableMonthsSql = `
        SELECT DISTINCT MONTH(DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day') AS month_num
        FROM PolicyFact
        WHERE YEAR(CAST(insurance_start_date AS DATE)) = ${targetYear - 1}
          AND YEAR(DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day') = ${targetYear}
        ORDER BY month_num
      `;
      const availableMonthsResult = await duckdbService.query(availableMonthsSql);
      const availableMonths = availableMonthsResult.map((r: Record<string, any>) => Number(r.month_num));

      const latestDateSql = `SELECT MAX(CAST(policy_date AS DATE)) AS latest_date FROM PolicyFact`;
      const latestDateResult = await duckdbService.query(latestDateSql);
      const latestPolicyDate = latestDateResult[0]?.latest_date ? String(latestDateResult[0].latest_date) : null;

      res.json({
        success: true,
        data: { detailData, availableMonths, latestPolicyDate },
      });
      return;
    }

    let sql: string;
    if (queryType === 'rate') {
      sql = generateRenewalRateQuery(filters, targetYear);
    } else {
      sql = generateRenewalDetailTableQuery(filters, targetYear, targetMonth, 'premium');
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 续保下钻分析请求验证Schema
 */
const renewalDrilldownSchema = z.object({
  targetYear: z.coerce.number().default(new Date().getFullYear()),
  level: z.enum(['company', 'org', 'team', 'salesman', 'coverage']).default('company'),
  orgFilter: z.string().optional(),
  teamFilter: z.string().optional(),
  salesmanFilter: z.string().optional(),
  selfRenewalOnly: z.string().optional(),
  bundleOnly: z.string().optional(),
  dueMonth: z.coerce.number().optional(),
  cutoffDate: z.string().optional(),
  sortField: z.enum(['renewal_rate', 'quote_rate', 'due_count', 'renewed_count']).default('renewal_rate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /api/query/renewal-drilldown
 * 续保下钻分析（五层下钻：公司→机构→团队→业务员→险别组合）
 */
router.get(
  '/renewal-drilldown',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = renewalDrilldownSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const {
      targetYear, level, orgFilter, teamFilter, salesmanFilter,
      selfRenewalOnly, bundleOnly, dueMonth, cutoffDate,
      sortField, sortOrder,
    } = parseResult.data;

    if (cutoffDate && !isValidDateFormat(cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
    }

    // 构建下钻维度
    const dimension: DrilldownDimension = {
      level: level as DrilldownLevel,
      selfRenewalOnly: selfRenewalOnly === 'true',
      bundleOnly: bundleOnly === 'true',
      dueMonth: dueMonth,
      filters: {
        org: orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
      },
    };

    // 构建筛选条件
    const filters: AdvancedFilterState = {};
    const permissionFilter = req.permissionFilter || '1=1';
    if (permissionFilter !== '1=1') {
      const orgMatch = permissionFilter.match(/org_level_3\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
      if (orgMatch && !orgFilter) {
        dimension.filters = { ...dimension.filters, org: orgMatch[1] };
      }

      const tmMatch = permissionFilter.match(/is_telemarketing\s*=\s*(true|false)/i);
      if (tmMatch) {
        filters.is_telemarketing = tmMatch[1].toLowerCase() === 'true';
      }
    }

    const sql = generateRenewalDrilldownQuery(
      filters,
      targetYear,
      dimension,
      { enabled: false },
      sortField as SortField,
      sortOrder as SortOrder,
      cutoffDate,
    );

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 车驾意推介率请求验证Schema（层层下钻）
 *
 * drillPath: JSON 数组，如 [{"dimension":"org_level_3","value":"天府"}]
 * groupBy: 当前分组维度（不传则仅返回汇总）
 */
const CROSS_SELL_DIMENSIONS = [
  'org_level_3', 'team', 'salesman', 'customer_category',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
] as const;

const CROSS_SELL_SEAT_COVERAGE_LEVELS = ['eq_1w', 'gte_2w', 'lt_1w'] as const;
type CrossSellSeatCoverageLevel = typeof CROSS_SELL_SEAT_COVERAGE_LEVELS[number] | 'all';

function getSeatCoverageClause(level?: CrossSellSeatCoverageLevel): string {
  if (!level || level === 'all') return '';
  switch (level) {
    case 'eq_1w':
      return 'COALESCE(driver_coverage, 0) = 10000 AND COALESCE(passenger_coverage, 0) = 10000';
    case 'gte_2w':
      return 'COALESCE(driver_coverage, 0) >= 20000 AND COALESCE(passenger_coverage, 0) >= 20000';
    case 'lt_1w':
      return 'COALESCE(driver_coverage, 0) < 10000 AND COALESCE(passenger_coverage, 0) < 10000';
    default:
      return '';
  }
}

const crossSellExtraSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(CROSS_SELL_DIMENSIONS).optional(),
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).optional(),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
});

/**
 * GET /api/query/cross-sell
 * 车驾意推介率分析（层层下钻）
 */
router.get(
  '/cross-sell',
  asyncHandler(async (req: Request, res: Response) => {
    const crossSellResult = crossSellExtraSchema.safeParse(req.query);
    if (!crossSellResult.success) {
      throw new AppError(400, crossSellResult.error.issues[0].message);
    }

    // 解析下钻路径
    let drillPath: DrilldownStep[] = [];
    try {
      const parsed = JSON.parse(crossSellResult.data.drillPath);
      if (Array.isArray(parsed)) {
        drillPath = parsed.map((s: any) => ({
          dimension: String(s.dimension) as CrossSellDimension,
          value: String(s.value),
        }));
      }
    } catch {
      throw new AppError(400, 'Invalid drillPath JSON');
    }

    const groupBy = crossSellResult.data.groupBy as CrossSellDimension | undefined;

    let { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    // 车辆类别过滤（标签页联动）
    const vehicleCat = crossSellResult.data.vehicleCategory as VehicleCategory | undefined;
    if (vehicleCat) {
      finalWhereClause += ` AND ${getVehicleCategoryFilter(vehicleCat)}`;
    }
    const seatCoverageClause = getSeatCoverageClause(crossSellResult.data.seatCoverageLevel);
    if (seatCoverageClause) {
      finalWhereClause += ` AND ${seatCoverageClause}`;
    }

    // 始终查询汇总行（应用 drillPath 过滤的汇总）
    // 如果有 groupBy，同时查询分组数据
    const [summaryResult, drilldownResult] = await Promise.all([
      duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, null), QUERY_CACHE.hotspotShort),
      groupBy
        ? duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, groupBy), QUERY_CACHE.hotspotShort)
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        summary: summaryResult[0] || null,
        rows: drilldownResult,
        drillPath,
        groupBy: groupBy || null,
      },
    });
  })
);

/**
 * 业务员排名请求验证Schema（特有参数）
 */
const salesmanRankingExtraSchema = z.object({
  rankingType: z.enum(['all', 'quality']).default('all'),
  limit: z.coerce.number().default(10),
});

/**
 * GET /api/query/salesman-ranking
 * 业务员排名（全部业务/优质业务）
 */
router.get(
  '/salesman-ranking',
  asyncHandler(async (req: Request, res: Response) => {
    const rankingResult = salesmanRankingExtraSchema.safeParse(req.query);
    if (!rankingResult.success) {
      throw new AppError(400, rankingResult.error.issues[0].message);
    }
    const { rankingType, limit } = rankingResult.data;

    const { whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    let sql: string;
    if (rankingType === 'all') {
      sql = generateSalesmanAllBusinessRankingQuery(finalWhereClause, limit);
    } else {
      sql = generateSalesmanQualityBusinessRankingQuery(finalWhereClause, limit);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 营销战报请求验证Schema
 */
const marketingReportSchema = z.object({
  reportType: z.enum(['org', 'salesman']).default('org'),
  holidayDates: z.string().default(''),
});

/**
 * GET /api/query/marketing-report
 * 营销战报（假日签单统计）
 */
router.get(
  '/marketing-report',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = marketingReportSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }

    const { reportType, holidayDates } = extraResult.data;
    const dates = holidayDates.split(',').filter(d => d && isValidDateFormat(d));

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    const dateField = filterData.dateField || 'policy_date';

    let sql: string;
    if (reportType === 'org') {
      sql = generateOrgHolidayReportQuery(finalWhereClause, dates, dateField);
    } else {
      sql = generateSalesmanHolidayDetailQuery(finalWhereClause, dates, dateField);
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 自定义SQL请求验证Schema
 */
const customSqlSchema = z.object({
  sql: z.string().min(1).max(8000),
});

/**
 * POST /api/query/custom
 * 自定义SQL查询（带安全校验）
 */
router.post(
  '/custom',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = customSqlSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { sql: userSql } = parseResult.data;

    // 1. SQL 安全校验（只读 + 聚合检查）
    const validation = validateSQL(userSql);
    if (!validation.valid) {
      throw new AppError(400, validation.error || 'SQL验证失败');
    }

    // 2. 获取权限过滤条件
    const permissionFilter = req.permissionFilter || '1=1';

    // 2.1 验证权限过滤条件格式（防止注入）
    if (!isValidPermissionFilter(permissionFilter)) {
      console.error('[Security] Invalid permission filter detected:', permissionFilter);
      throw new AppError(500, '权限配置错误，请联系管理员');
    }

    // 3. 使用健壮的权限注入工具
    let finalSql: string;
    try {
      finalSql = injectPermissionFilter(userSql, permissionFilter);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '无法应用权限过滤';
      throw new AppError(400, errorMessage);
    }

    // 4. 执行查询
    const result = await duckdbService.query(finalSql);

    res.json({
      success: true,
      data: result,
      meta: {
        rowCount: result.length,
        permissionApplied: permissionFilter !== '1=1',
      },
    });
  })
);

// ============================================================
// Cross-Sell Time Period Summary
// ============================================================

/**
 * GET /api/query/cross-sell-trend
 * 车驾意推介率走势（按日/周/月/季粒度，4条险别组合折线）
 */
const crossSellTrendSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get(
  '/cross-sell-trend',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = crossSellTrendSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { vehicleCategory, granularity, seatCoverageLevel } = extraResult.data;

    const { whereClause } = parseFiltersAndBuildWhere(req);
    let finalWhereClause = whereClause;
    const seatCoverageClause = getSeatCoverageClause(seatCoverageLevel);
    if (seatCoverageClause) {
      finalWhereClause += ` AND ${seatCoverageClause}`;
    }

    const sql = generateCrossSellTrendQuery(
      finalWhereClause,
      vehicleCategory as VehicleCategory,
      granularity as TrendGranularity
    );

    logger.debug('[cross-sell-trend] Generated SQL', { sqlLength: sql.length });

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

/**
 * 车驾意推介率时间维度汇总请求验证Schema
 */
const crossSellSummarySchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

/**
 * GET /api/query/cross-sell-summary
 * 车驾意推介率 时间维度汇总（当日/当周/当月/当年 × 险别组合）
 */
router.get(
  '/cross-sell-summary',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = crossSellSummarySchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }

    const { vehicleCategory, seatCoverageLevel } = extraResult.data;

    const { whereClause } = parseFiltersAndBuildWhere(req);
    let finalWhereClause = whereClause;
    const seatCoverageClause = getSeatCoverageClause(seatCoverageLevel);
    if (seatCoverageClause) {
      finalWhereClause += ` AND ${seatCoverageClause}`;
    }

    const sql = generateCrossSellTimePeriodQuery(
      finalWhereClause,
      vehicleCategory as VehicleCategory
    );

    logger.debug('[cross-sell-summary] Generated SQL', { sqlLength: sql.length });

    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    // 从结果中提取 maxDate（通过再查一次 date_bounds）
    const maxDateSql = `
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date
      FROM CrossSellDailyAgg
      WHERE ${finalWhereClause}
        AND ${getVehicleCategoryFilter(vehicleCategory as VehicleCategory)}
    `;
    const maxDateResult = await duckdbService.query(maxDateSql, QUERY_CACHE.hotspotMedium);
    const maxDate = maxDateResult[0]?.max_date || null;

    res.json({
      success: true,
      data: {
        maxDate,
        rows: result,
      },
    });
  })
);

// ============================================================
// Premium Report & Premium Plan Endpoints
// ============================================================

/**
 * 保费报表请求验证Schema
 */
const premiumReportExtraSchema = z.object({
  reportType: z.enum(['org', 'salesman']).default('org'),
  planYear: z.coerce.number().default(2026),
});

/**
 * GET /api/query/premium-report
 * 保费报表（机构汇总 / 业务员明细）
 */
router.get(
  '/premium-report',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = premiumReportExtraSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { reportType, planYear } = extraResult.data;

    const { filterData, whereClause: finalWhereClause } = parseFiltersAndBuildWhere(req);

    const dateField = filterData.dateField || 'policy_date';

    let sql: string;
    if (reportType === 'org') {
      sql = generateOrgPremiumReportQuery(finalWhereClause, dateField);
    } else {
      sql = generateSalesmanPremiumReportQuery(finalWhereClause, planYear);
    }

    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * 保费达成下钻请求验证Schema
 */
const premiumPlanSchema = z.object({
  queryType: z.enum(['drilldown', 'kpi', 'distribution']).default('drilldown'),
  planYear: z.coerce.number().default(2026),
  level: z.enum(['company', 'org', 'team', 'salesman', 'customer_category', 'coverage']).default('company'),
  orgFilter: z.string().optional(),
  teamFilter: z.string().optional(),
  salesmanFilter: z.string().optional(),
  customerCategoryFilter: z.string().optional(),
  sortField: z.enum(['plan_vehicle', 'actual_vehicle', 'rate_vehicle', 'plan_total', 'prev_year_premium', 'yoy_growth_rate', 'year_2025_actual', 'plan_growth_rate']).default('plan_vehicle'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  rankingEnabled: z.string().optional(),
  topN: z.coerce.number().default(10),
  bottomN: z.coerce.number().default(10),
});

/**
 * GET /api/query/premium-plan
 * 保费达成下钻分析（六级下钻 + KPI + 达成率分布）
 */
router.get(
  '/premium-plan',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = premiumPlanSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const {
      queryType, planYear, level,
      orgFilter, teamFilter, salesmanFilter, customerCategoryFilter,
      sortField, sortOrder,
      rankingEnabled, topN, bottomN,
    } = parseResult.data;

    const isOrgUser = req.user?.role === 'org_user';
    const forcedOrg = isOrgUser ? req.user?.organization : undefined;
    if (isOrgUser && !forcedOrg) {
      throw new AppError(403, 'Organization not specified for ORG_USER role');
    }

    const dimension: PlanDrilldownDimension = {
      level: level as PlanDrilldownLevel,
      filters: {
        // 三级机构账号：强制锁定本机构，忽略前端传参
        org: forcedOrg || orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
        customerCategory: customerCategoryFilter,
      },
    };

    let sql: string;
    switch (queryType) {
      case 'kpi':
        sql = generateKPICardQuery(planYear, dimension);
        break;
      case 'distribution':
        sql = generateRateDistributionQuery(planYear, dimension);
        break;
      case 'drilldown':
      default:
        sql = generatePremiumPlanDrilldownQuery(
          planYear,
          dimension,
          {
            enabled: rankingEnabled === 'true',
            rankField: 'rate_vehicle',
            topN,
            bottomN,
          },
          sortField as PlanSortField,
          sortOrder as PlanSortOrder,
        );
        break;
    }

    const result = await duckdbService.query(sql);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * GET /api/query/plan-achievement
 * 保费达成面板合并端点（单次请求返回 children + summary + distribution）
 *
 * 优势：
 * - 1 个 HTTP 请求替代原来的 3 个（减少 2/3 网络往返）
 * - 3 条 SQL 并发执行，均读 achievement_cache（极低延迟）
 * - 面包屑由前端维护，后端只返回数据
 *
 * Query params：
 *   planYear   number  计划年度（默认 2026）
 *   level      string  当前下钻层级（org/team/salesman/...）
 *   orgFilter  string  机构过滤（可选）
 *   teamFilter string  团队过滤（可选）
 *   salesmanFilter string  业务员过滤（可选）
 *   sortField  string  排序字段（默认 actual_vehicle）
 *   sortOrder  string  排序方向（默认 desc）
 */
const planAchievementSchema = z.object({
  planYear: z.coerce.number().default(2026),
  level: z.enum(['company', 'org', 'team', 'salesman', 'customer_category', 'coverage']).default('org'),
  orgFilter: z.string().optional(),
  teamFilter: z.string().optional(),
  salesmanFilter: z.string().optional(),
  customerCategoryFilter: z.string().optional(),
  sortField: z.enum(['plan_vehicle', 'actual_vehicle', 'rate_vehicle', 'plan_total', 'prev_year_premium', 'yoy_growth_rate', 'year_2025_actual', 'plan_growth_rate']).default('actual_vehicle'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

router.get(
  '/plan-achievement',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = planAchievementSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { planYear, level, orgFilter, teamFilter, salesmanFilter, customerCategoryFilter, sortField, sortOrder } = parseResult.data;
    const isOrgUser = req.user?.role === 'org_user';
    const forcedOrg = isOrgUser ? req.user?.organization : undefined;
    if (isOrgUser && !forcedOrg) {
      throw new AppError(403, 'Organization not specified for ORG_USER role');
    }

    const dimension: PlanDrilldownDimension = {
      level: level as PlanDrilldownLevel,
      filters: {
        // 三级机构账号：强制锁定本机构，忽略前端传参
        org: forcedOrg || orgFilter,
        team: teamFilter,
        salesman: salesmanFilter,
        customerCategory: customerCategoryFilter,
      },
    };

    const { childrenSql, summarySql, distributionSql } = generatePlanAchievementPanel(
      planYear,
      dimension,
      sortField as PlanSortField,
      sortOrder as PlanSortOrder,
    );

    // 三条 SQL 并发执行（均读 achievement_cache，每条 ~5-20ms）
    const [children, summaryRows, distribution] = await Promise.all([
      duckdbService.query(childrenSql),
      duckdbService.query(summarySql),
      duckdbService.query(distributionSql),
    ]);

    res.json({
      success: true,
      data: {
        children,
        summary: summaryRows[0] ?? null,
        distribution,
        meta: {
          plan_year: planYear,
          level,
        },
      },
    });
  })
);

/**
 * GET /api/query/cross-sell-top-salesman
 * 车驾意推介率 TOP20 业务员分析
 */
const crossSellTopSalesmanSchema = z.object({
  vehicleCategory: z.enum(['all', 'passenger', 'truck', 'motorcycle']).default('passenger'),
  coverage: z.enum(['主全', '交三']).default('主全'),
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('daily'),
  seatCoverageLevel: z.enum(['all', 'eq_1w', 'gte_2w', 'lt_1w']).optional(),
});

router.get(
  '/cross-sell-top-salesman',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = crossSellTopSalesmanSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { vehicleCategory, coverage, timePeriod, seatCoverageLevel } = extraResult.data;

    const { whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
    let finalWhereClause = whereWithoutDate;
    const seatCoverageClause = getSeatCoverageClause(seatCoverageLevel);
    if (seatCoverageClause) {
      finalWhereClause += ` AND ${seatCoverageClause}`;
    }

    const sql = generateCrossSellTopSalesmanQuery(
      finalWhereClause,
      vehicleCategory as VehicleCategory,
      coverage as TopSalesmanCoverage,
      timePeriod
    );

    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: {
        rows: result,
      },
    });
  })
);

/**
 * GET /api/query/cross-sell-bundle
 * 交叉销售页面聚合端点：summary + trend + drilldown + topSalesman
 */
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
  asyncHandler(async (req: Request, res: Response) => {
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
      res.json({
        success: true,
        data: cachedBundleData,
        meta: buildResponseMeta(res),
      });
      return;
    }

    const {
      drillPath: drillPathRaw,
      groupBy,
      vehicleCategory,
      seatCoverageLevel,
      granularity,
      timePeriod,
    } = parseResult.data;

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
    const seatCoverageClause = getSeatCoverageClause(seatCoverageLevel);

    let withDateWhere = `${whereWithDate} AND ${getVehicleCategoryFilter(vehicleCategory as VehicleCategory)}`;
    let withoutDateWhere = `${whereWithoutDate} AND ${getVehicleCategoryFilter(vehicleCategory as VehicleCategory)}`;
    if (seatCoverageClause) {
      withDateWhere += ` AND ${seatCoverageClause}`;
      withoutDateWhere += ` AND ${seatCoverageClause}`;
    }

    const trendSql = generateCrossSellTrendQuery(
      withDateWhere,
      vehicleCategory as VehicleCategory,
      granularity as TrendGranularity
    );

    const timePeriodSql = generateCrossSellTimePeriodQuery(
      withDateWhere,
      vehicleCategory as VehicleCategory
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
      vehicleCategory as VehicleCategory,
      '主全',
      timePeriod
    );
    const jiaosanTopSalesmanSql = generateCrossSellTopSalesmanQuery(
      withoutDateWhere,
      vehicleCategory as VehicleCategory,
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

    res.json({
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    });
  })
);

// ============================================================
// Performance Analysis Endpoints
// ============================================================

const PERFORMANCE_DIMENSIONS = [
  'org_level_3', 'team', 'salesman', 'customer_category',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
] as const;

const PERFORMANCE_SEGMENT_TAGS = [
  'all',
  'non_business_passenger',
  'business_passenger',
  'business_truck',
  'non_business_truck',
  'motorcycle',
  // 兼容旧参数
  'truck',
] as const;

const PERFORMANCE_LEGACY_CATEGORIES = ['passenger', 'business_passenger', 'truck', 'motorcycle'] as const;
const PERFORMANCE_EXPAND_DIMS = ['none', 'energy', 'business_nature', 'energy_business_nature'] as const;

function resolvePerformanceSegmentTag(data: {
  segmentTag?: string;
  vehicleCategory?: string;
}): PerformanceSegmentTag {
  if (data.segmentTag) {
    return data.segmentTag as PerformanceSegmentTag;
  }
  if (data.vehicleCategory) {
    return mapLegacyVehicleCategoryToSegmentTag(data.vehicleCategory as PerformanceVehicleCategory);
  }
  return 'all';
}

const performanceSummarySchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
  expandDims: z.enum(PERFORMANCE_EXPAND_DIMS).default('none'),
});

router.get(
  '/performance-summary',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = performanceSummarySchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { timePeriod, growthMode, expandDims } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);

    const sql = generatePerformanceSummaryQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      expandDims as PerformanceSummaryExpandDims
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

const performanceTrendSchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('daily'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
});

router.get(
  '/performance-trend',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = performanceTrendSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { granularity } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    const { whereWithDate } = parseFiltersAndBuildBothWhere(req);

    const sql = generatePerformanceTrendQuery(
      whereWithDate,
      segmentTag as PerformanceSegmentTag,
      granularity as PerformanceTrendGranularity
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

const performanceDrilldownSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(PERFORMANCE_DIMENSIONS).optional(),
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
});

router.get(
  '/performance-drilldown',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = performanceDrilldownSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { timePeriod, growthMode } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    let drillPath: PerformanceDrilldownStep[] = [];
    try {
      const parsed = JSON.parse(extraResult.data.drillPath);
      if (Array.isArray(parsed)) {
        drillPath = parsed.map((s: any) => ({
          dimension: String(s.dimension) as PerformanceDimension,
          value: String(s.value),
        }));
      }
    } catch {
      throw new AppError(400, 'Invalid drillPath JSON');
    }

    const groupBy = extraResult.data.groupBy as PerformanceDimension | undefined;

    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);

    const [summaryRows, drilldownRows] = await Promise.all([
      duckdbService.query(
        generatePerformanceDrilldownQuery(
          whereWithDate,
          whereWithoutDate,
          segmentTag as PerformanceSegmentTag,
          timePeriod as PerformanceTimePeriod,
          growthMode as PerformanceGrowthMode,
          drillPath,
          null
        ),
        QUERY_CACHE.hotspotShort
      ),
      groupBy
        ? duckdbService.query(
          generatePerformanceDrilldownQuery(
            whereWithDate,
            whereWithoutDate,
            segmentTag as PerformanceSegmentTag,
            timePeriod as PerformanceTimePeriod,
            growthMode as PerformanceGrowthMode,
            drillPath,
            groupBy
          ),
          QUERY_CACHE.hotspotShort
        )
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        summary: summaryRows[0] || null,
        rows: drilldownRows,
        drillPath,
        groupBy: groupBy || null,
      },
    });
  })
);

const performanceTopSalesmanSchema = z.object({
  segmentTag: z.enum(PERFORMANCE_SEGMENT_TAGS).optional(),
  vehicleCategory: z.enum(PERFORMANCE_LEGACY_CATEGORIES).optional(),
  timePeriod: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('day'),
  growthMode: z.enum(['mom', 'yoy']).default('mom'),
  limit: z.coerce.number().default(20),
});

router.get(
  '/performance-top-salesman',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = performanceTopSalesmanSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { timePeriod, growthMode, limit } = extraResult.data;
    const segmentTag = resolvePerformanceSegmentTag(extraResult.data);

    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);

    const sql = generatePerformanceTopSalesmanQuery(
      whereWithDate,
      whereWithoutDate,
      segmentTag as PerformanceSegmentTag,
      timePeriod as PerformanceTimePeriod,
      growthMode as PerformanceGrowthMode,
      limit
    );

    const rows = await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

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

function mapPerformanceTimeToGranularity(timePeriod: PerformanceTimePeriod): PerformanceTrendGranularity {
  switch (timePeriod) {
    case 'day':
      return 'daily';
    case 'week':
      return 'weekly';
    case 'month':
      return 'monthly';
    case 'quarter':
      return 'quarterly';
    case 'year':
      return 'yearly';
    default:
      return 'daily';
  }
}

router.get(
  '/performance-bundle',
  asyncHandler(async (req: Request, res: Response) => {
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
      res.json({
        success: true,
        data: cachedBundleData,
        meta: buildResponseMeta(res),
      });
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

    res.json({
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    });
  })
);

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
  asyncHandler(async (req: Request, res: Response) => {
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
      res.json({
        success: true,
        data: cachedBundleData,
        meta: buildResponseMeta(res),
      });
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

    const kpiSql = generateKpiQuery(whereWithDate, { orgNames, salesmanNames }, whereWithoutDate);
    const kpiDetailSql = generateKpiDetailQuery(whereWithDate, false);
    const trendSql = generatePremiumTrendQuery(
      timeView,
      whereWithDate,
      filterData.dateField || 'policy_date',
      perspective as ViewPerspective,
      groupDim
    );
    const qualityTrendSql = generateQualityBusinessTrendQuery(
      timeView,
      whereWithDate,
      filterData.dateField || 'policy_date',
      perspective as ViewPerspective,
      groupDim
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

    const [kpiRows, kpiDetailRows, trendRows, qualityTrendRows, allRankingRows, qualityRankingRows, customerRoseRows, coverageRoseRows, terminalRoseRows] = await Promise.all([
      duckdbService.query(kpiSql, QUERY_CACHE.hotspotLong),
      duckdbService.query(kpiDetailSql, QUERY_CACHE.hotspotLong),
      duckdbService.query(trendSql, QUERY_CACHE.hotspotLong),
      duckdbService.query(qualityTrendSql, QUERY_CACHE.hotspotLong),
      duckdbService.query(allRankingSql, QUERY_CACHE.hotspotMedium),
      duckdbService.query(qualityRankingSql, QUERY_CACHE.hotspotMedium),
      duckdbService.query(customerRoseSql, QUERY_CACHE.hotspotMedium),
      duckdbService.query(coverageRoseSql, QUERY_CACHE.hotspotMedium),
      duckdbService.query(terminalRoseSql, QUERY_CACHE.hotspotMedium),
    ]);

    const bundleData = {
      kpi: kpiRows[0] || {},
      kpiDetail: kpiDetailRows[0] || {},
      trend: trendRows,
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
    setRouteCache(routeCacheKey, bundleData, QUERY_CACHE.hotspotShort);

    res.json({
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    });
  })
);

/**
 * GET /api/query/cross-sell-org-trend
 * 机构推介率走势（最近14天，按日，叠加柱+推介率折线）
 */
const crossSellOrgTrendSchema = z.object({
  vehicleCategory: z.enum(['passenger', 'truck', 'motorcycle']).default('passenger'),
  coverageCombination: z.enum(['整体', '交三', '主全', '单交']).default('整体'),
  days: z.coerce.number().int().min(1).max(90).default(14),
  seatCoverageLevel: z.enum(CROSS_SELL_SEAT_COVERAGE_LEVELS).optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
});

router.get(
  '/cross-sell-org-trend',
  asyncHandler(async (req: Request, res: Response) => {
    const extraResult = crossSellOrgTrendSchema.safeParse(req.query);
    if (!extraResult.success) {
      throw new AppError(400, extraResult.error.issues[0].message);
    }
    const { vehicleCategory, coverageCombination, days, seatCoverageLevel } = extraResult.data;

    const { whereClause } = parseFiltersAndBuildWhere(req);
    let finalWhereClause = whereClause;
    const seatCoverageClause = getSeatCoverageClause(seatCoverageLevel);
    if (seatCoverageClause) {
      finalWhereClause += ` AND ${seatCoverageClause}`;
    }

    const sql = generateCrossSellOrgTrendQuery(
      finalWhereClause,
      vehicleCategory as VehicleCategory,
      coverageCombination as CoverageCombinationFilter,
      days
    );

    logger.debug('[cross-sell-org-trend] Generated SQL', { sqlLength: sql.length });

    const rows = await duckdbService.query(sql);

    res.json({
      success: true,
      data: { rows },
    });
  })
);

export default router;
