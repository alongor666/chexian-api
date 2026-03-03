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
  generateMonthlyExpenseQuery,
  CostDimension,
} from '../sql/cost.js';
import {
  generateComprehensiveDimensionMetricsQuery,
  generateComprehensiveLossTrendQuery,
  generateComprehensivePlanByOrgQuery,
  generateComprehensiveSummaryQuery,
  type ComprehensiveDimension,
  type ComprehensiveGranularity,
} from '../sql/comprehensive-analysis.js';
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
import type { AdvancedFilterState, DateCriteria } from '../types/data.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../sql/salesman-ranking.js';
import { validateSQL } from '../utils/sql-validator.js';
import { isValidDateFormat } from '../utils/sql-sanitizer.js';
import { injectPermissionFilter, isValidPermissionFilter } from '../utils/sql-permission-injector.js';
import { commonFilterSchema, buildWhereFromFilterParams, buildWhereFromFilterParamsWithoutDate } from '../utils/filter-params.js';
import { parseFiltersAndBuildWhere, parseFiltersAndBuildBothWhere, extractOrgNames, extractSalesmanNames, resolveGroupDim } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import { buildResponseMeta } from '../utils/api-meta.js';
import { markRequestCacheHit } from '../utils/request-context.js';
import { getRouteCache, setRouteCache, computeEtag, sendWithEtag } from '../services/route-cache.js';
import { generateFeeAnalysisQuery } from '../sql/fee-analysis.js';
import { DEFAULT_COMPREHENSIVE_THRESHOLDS } from '../config/comprehensive-thresholds.js';

const router = Router();

const QUERY_CACHE = {
  hotspotShort: 120_000,
  hotspotMedium: 180_000,
  hotspotLong: 300_000,
} as const;

export function buildRouteCacheKey(req: Request, routeName: string): string {
  const normalizedQuery = Object.entries(req.query)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return `${routeName}|${req.permissionFilter || '1=1'}|${normalizedQuery}`;
}

function isBundleRoutesEnabled(): boolean {
  return process.env.ENABLE_QUERY_BUNDLES !== 'false';
}

function resolveCutoffDate(
  requestedCutoffDate: string | undefined,
  filterEndDate: string | undefined,
  maxDataDate: string | null
): string {
  if (requestedCutoffDate) return requestedCutoffDate;
  if (filterEndDate) return filterEndDate;
  if (maxDataDate) return maxDataDate;
  return new Date().toISOString().slice(0, 10);
}

function computeTimeProgress(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const elapsedDays = Math.max(1, Math.floor((date.getTime() - start.getTime()) / 86400000) + 1);
  const totalDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000));
  return Number((elapsedDays / totalDays).toFixed(6));
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

interface ComprehensiveMetricRow {
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

function buildComprehensiveAlerts(
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

function withRankByDimType(rows: ComprehensiveMetricRow[]): Array<ComprehensiveMetricRow & { rank: number }> {
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
    // KPI 高频查询，缓存 120 秒
    const result = await duckdbService.query(sql, 120_000);

    sendWithEtag(req, res, {
      success: true,
      data: result[0] || {},
    }, 30);
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
    // KPI 详情高频查询，缓存 120 秒
    const result = await duckdbService.query(sql, 120_000);

    sendWithEtag(req, res, {
      success: true,
      data: result[0] || {},
    }, 30);
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
    // 趋势查询缓存 180 秒
    const result = await duckdbService.query(sql, 180_000);

    sendWithEtag(req, res, {
      success: true,
      data: result,
    }, 60);
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
    const result = await duckdbService.query(sql, 180_000);

    sendWithEtag(req, res, {
      success: true,
      data: result,
    }, 60);
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

    const sql = generateGrowthQuery(config);
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
      const summaryData = await duckdbService.query(generateNewEarnedPremiumSummaryQuery(config));
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

const comprehensiveExtraSchema = z.object({
  cutoffDate: z.string().optional(),
  planYear: z.coerce.number().int().optional(),
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

async function handleComprehensiveBundle(req: Request, res: Response): Promise<void> {
  const parseResult = comprehensiveExtraSchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new AppError(400, parseResult.error.issues[0].message);
  }

  const routeCacheKey = buildRouteCacheKey(req, 'comprehensive-bundle');
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

  const { cutoffDate: requestedCutoffDate, planYear: requestedPlanYear, granularity } = parseResult.data;
  const { filterData, whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);

  if (requestedCutoffDate && !isValidDateFormat(requestedCutoffDate)) {
    throw new AppError(400, `Invalid cutoffDate format: ${requestedCutoffDate}. Expected YYYY-MM-DD`);
  }

  const maxDateRows = await duckdbService.query<{ max_data_date: string | null }>(
    `SELECT MAX(CAST(policy_date AS DATE)) AS max_data_date FROM PolicyFact WHERE ${whereWithoutDate}`,
    QUERY_CACHE.hotspotShort
  );
  const maxDataDate = maxDateRows[0]?.max_data_date ? String(maxDateRows[0].max_data_date) : null;
  const resolvedCutoffDate = resolveCutoffDate(requestedCutoffDate, filterData.endDate, maxDataDate);

  if (!isValidDateFormat(resolvedCutoffDate)) {
    throw new AppError(400, `Invalid resolved cutoffDate: ${resolvedCutoffDate}. Expected YYYY-MM-DD`);
  }

  const resolvedPlanYear = requestedPlanYear ?? Number(resolvedCutoffDate.slice(0, 4));
  const timeProgress = computeTimeProgress(resolvedCutoffDate);
  const thresholds = DEFAULT_COMPREHENSIVE_THRESHOLDS;

  const dimensions: ComprehensiveDimension[] = ['org', 'category', 'business'];
  const [summaryRows, ...dimensionResults] = await Promise.all([
    duckdbService.query(generateComprehensiveSummaryQuery(whereWithDate, resolvedCutoffDate), QUERY_CACHE.hotspotShort),
    ...dimensions.map((dimension) =>
      duckdbService.query(
        generateComprehensiveDimensionMetricsQuery({
          dimension,
          whereClause: whereWithDate,
          cutoffDate: resolvedCutoffDate,
        }),
        QUERY_CACHE.hotspotShort
      )
    ),
  ]);

  const orgNames = extractOrgNames(filterData, req.permissionFilter);
  let planRows: Array<{ dim_key: string; plan_premium: number }> = [];
  try {
    planRows = await duckdbService.query(
      generateComprehensivePlanByOrgQuery(resolvedPlanYear, orgNames),
      QUERY_CACHE.hotspotMedium
    );
  } catch (error) {
    logger.warn('comprehensive-bundle: failed to load achievement_cache plan data, fallback to null plan.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const planMap = new Map<string, number>();
  for (const row of planRows) {
    if (!row?.dim_key) continue;
    planMap.set(String(row.dim_key), toFiniteNumber(row.plan_premium));
  }

  const normalizedRows: ComprehensiveMetricRow[] = dimensionResults.flatMap((rows, idx) => {
    const dimType = dimensions[idx];
    return (rows as Array<Record<string, unknown>>).map((row) => {
      const dimKey = String(row.dim_key ?? '未知');
      const planPremium = dimType === 'org' ? (planMap.get(dimKey) ?? null) : null;
      const signedPremium = toFiniteNumber(row.signed_premium);
      const achievementRate =
        planPremium && planPremium > 0 && timeProgress && timeProgress > 0
          ? Number(((signedPremium / planPremium) / timeProgress * 100).toFixed(2))
          : null;

      return {
        dim_type: dimType,
        dim_key: dimKey,
        policy_count: Math.max(0, Math.round(toFiniteNumber(row.policy_count))),
        signed_premium: signedPremium,
        reported_claims: toFiniteNumber(row.reported_claims),
        fee_amount: toFiniteNumber(row.fee_amount),
        claim_cases: Math.max(0, Math.round(toFiniteNumber(row.claim_cases))),
        earned_premium: toFiniteNumber(row.earned_premium),
        earned_claim_ratio: row.earned_claim_ratio === null ? null : toFiniteNumber(row.earned_claim_ratio, NaN),
        expense_ratio: row.expense_ratio === null ? null : toFiniteNumber(row.expense_ratio, NaN),
        variable_cost_ratio:
          row.variable_cost_ratio === null ? null : toFiniteNumber(row.variable_cost_ratio, NaN),
        avg_claim_amount: row.avg_claim_amount === null ? null : toFiniteNumber(row.avg_claim_amount, NaN),
        claim_frequency: row.claim_frequency === null ? null : toFiniteNumber(row.claim_frequency, NaN),
        premium_share: toFiniteNumber(row.premium_share),
        claim_share: toFiniteNumber(row.claim_share),
        expense_share: toFiniteNumber(row.expense_share),
        plan_premium: planPremium,
        achievement_rate: achievementRate,
      };
    });
  }).map((row) => ({
    ...row,
    earned_claim_ratio: Number.isFinite(row.earned_claim_ratio ?? NaN) ? row.earned_claim_ratio : null,
    expense_ratio: Number.isFinite(row.expense_ratio ?? NaN) ? row.expense_ratio : null,
    variable_cost_ratio: Number.isFinite(row.variable_cost_ratio ?? NaN) ? row.variable_cost_ratio : null,
    avg_claim_amount: Number.isFinite(row.avg_claim_amount ?? NaN) ? row.avg_claim_amount : null,
    claim_frequency: Number.isFinite(row.claim_frequency ?? NaN) ? row.claim_frequency : null,
  }));

  const rankedRows = withRankByDimType(normalizedRows);
  const orgRows = rankedRows.filter((row) => row.dim_type === 'org');
  const orgScope = orgRows.map((row) => row.dim_key);

  const summaryRow = (summaryRows[0] || {}) as Record<string, unknown>;
  const totalPlanPremium = orgRows.reduce((sum, row) => sum + (row.plan_premium || 0), 0);
  const totalSignedPremium = toFiniteNumber(summaryRow.signed_premium);
  const summaryAchievementRate =
    totalPlanPremium > 0 && timeProgress && timeProgress > 0
      ? Number(((totalSignedPremium / totalPlanPremium) / timeProgress * 100).toFixed(2))
      : null;

  const lossTrendRows = await duckdbService.query(
    generateComprehensiveLossTrendQuery(
      whereWithDate,
      resolvedCutoffDate,
      granularity as ComprehensiveGranularity
    ),
    QUERY_CACHE.hotspotShort
  );

  const overviewRows = rankedRows;
  const overviewAlerts = buildComprehensiveAlerts(orgRows, thresholds);

  const expenseSurplusRows = rankedRows.map((row) => {
    const expenseRateDeviation =
      row.expense_ratio === null
        ? null
        : Number((row.expense_ratio - thresholds.expenseBudget).toFixed(2));
    const expenseSurplusAmount =
      expenseRateDeviation === null
        ? null
        : Number((row.signed_premium * expenseRateDeviation / 100).toFixed(2));

    return {
      dim_type: row.dim_type,
      dim_key: row.dim_key,
      expenseRateDeviation,
      expenseSurplusAmount,
    };
  });

  const roiRows = rankedRows.map((row) => {
    const claimRatio = row.earned_claim_ratio !== null ? row.earned_claim_ratio / 100 : null;
    const expenseRatio = row.expense_ratio !== null ? row.expense_ratio / 100 : null;
    const marginContribution =
      claimRatio !== null && expenseRatio !== null
        ? Number((row.signed_premium * (1 - claimRatio - expenseRatio)).toFixed(2))
        : null;
    const expenseOutputPremiumRatio =
      row.fee_amount > 0 ? Number((row.signed_premium / row.fee_amount).toFixed(4)) : null;
    const expenseOutputMarginRatio =
      row.fee_amount > 0 && marginContribution !== null
        ? Number((marginContribution / row.fee_amount).toFixed(4))
        : null;
    const marginRate =
      row.signed_premium > 0 && marginContribution !== null
        ? Number((marginContribution * 100.0 / row.signed_premium).toFixed(2))
        : null;

    return {
      dim_type: row.dim_type,
      dim_key: row.dim_key,
      signed_premium: row.signed_premium,
      expense_amount: row.fee_amount,
      marginContribution,
      expenseOutputPremiumRatio,
      expenseOutputMarginRatio,
      marginRate,
    };
  });

  const bundleData = {
    meta: {
      cutoffDate: resolvedCutoffDate,
      maxDataDate,
      planYear: resolvedPlanYear,
      orgScope,
      permissionFilter: req.permissionFilter || '1=1',
      thresholds,
      timeProgress,
    },
    overview: {
      summary: {
        signedPremium: totalSignedPremium,
        reportedClaims: toFiniteNumber(summaryRow.reported_claims),
        expenseAmount: toFiniteNumber(summaryRow.fee_amount),
        earnedClaimRatio:
          summaryRow.earned_claim_ratio === null ? null : toFiniteNumber(summaryRow.earned_claim_ratio, NaN),
        expenseRatio: summaryRow.expense_ratio === null ? null : toFiniteNumber(summaryRow.expense_ratio, NaN),
        variableCostRatio:
          summaryRow.variable_cost_ratio === null ? null : toFiniteNumber(summaryRow.variable_cost_ratio, NaN),
        achievementRate: summaryAchievementRate,
      },
      rows: overviewRows,
      alerts: overviewAlerts,
    },
    premium: {
      rows: rankedRows,
    },
    cost: {
      rows: rankedRows,
    },
    loss: {
      quadrantRows: rankedRows,
      trendRows: lossTrendRows,
    },
    expense: {
      rows: rankedRows,
      surplusRows: expenseSurplusRows,
    },
    roi: {
      rows: roiRows,
    },
  };

  setRouteCache(routeCacheKey, bundleData, QUERY_CACHE.hotspotShort);

  sendWithEtag(req, res, {
    success: true,
    data: bundleData,
    meta: buildResponseMeta(res),
  }, 60);
}

router.get(
  '/comprehensive-bundle',
  asyncHandler(async (req: Request, res: Response) => {
    await handleComprehensiveBundle(req, res);
  })
);

router.get(
  '/comprehensive-analysis-bundle',
  asyncHandler(async (req: Request, res: Response) => {
    await handleComprehensiveBundle(req, res);
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
      // 必须有至少一项保额 > 0，否则会把没买驾乘险（保额全为0）的也算进去，导致推介率分母极大，件均异常
      return '(COALESCE(driver_coverage, 0) > 0 OR COALESCE(passenger_coverage, 0) > 0) AND COALESCE(driver_coverage, 0) < 10000 AND COALESCE(passenger_coverage, 0) < 10000';
    default:
      return '';
  }
}

async function ensureCrossSellAggregateTablesReady(): Promise<void> {
  // 全环境实时聚合：CrossSellDailyAgg 由 DuckDB 服务启动时创建为实时视图。
  return;
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
    await ensureCrossSellAggregateTablesReady();

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
 * POST /api/query/custom - 已移除（SQL 编辑器功能已删除）
 * 保留端点返回 410 Gone
 */
router.post(
  '/custom',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(410).json({
      success: false,
      error: '自定义 SQL 查询功能已关闭',
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
    await ensureCrossSellAggregateTablesReady();

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
    await ensureCrossSellAggregateTablesReady();

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
    await ensureCrossSellAggregateTablesReady();

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

    sendWithEtag(req, res, {
      success: true,
      data: bundleData,
      meta: buildResponseMeta(res),
    }, 60);
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
      !filterData.smallTruckScores &&
      !filterData.largeTruckScores &&
      !filterData.isRenewal &&
      !filterData.isNewCar &&
      !filterData.isTransfer &&
      !filterData.isNev &&
      !filterData.isTelemarketing &&
      !filterData.isCommercialInsure &&
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

    // Tier 3: 动态执行 Fallback
    const bundleData = await fetchDashboardBundleData({
      whereWithDate,
      whereWithoutDate,
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

  return {
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
}
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

/**
 * GET /api/query/fee-analysis
 * 费用分析（成都同城机构 | 非营业个人客车 | 非新能源 | 非电销 | 22条规则分档）
 */
router.get(
  '/fee-analysis',
  asyncHandler(async (req: Request, res: Response) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const sql = generateFeeAnalysisQuery(whereClause);
    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
