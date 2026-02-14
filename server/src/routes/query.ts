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
import { generatePremiumTrendQuery, TimeView } from '../sql/trend.js';
// Phase 2 SQL Generators
import { generateTonnageRoseQuery, generateOrgByTonnageQuery, generateTonnageByOrgQuery } from '../sql/truck.js';
import { generateGrowthQuery, GrowthConfig, GrowthType, TimeView as GrowthTimeView } from '../sql/growth.js';
import { generateCoefficientByOrgQuery, generateFullCoefficientQuery } from '../sql/coefficient.js';
import { generateClaimRatioQuery, generateExpenseRatioQuery, generateComprehensiveCostQuery, generateVariableCostQuery, CostDimension } from '../sql/cost.js';
import { generateRenewalRateQuery, generateRenewalDetailTableQuery } from '../sql/renewal.js';
import { generateCrossSellQuery, type CrossSellDimension, type DrilldownStep } from '../sql/cross-sell.js';
import type { AdvancedFilterState } from '../types/data.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../sql/salesman-ranking.js';
import { validateSQL } from '../utils/sql-validator.js';
import { isValidDateFormat } from '../utils/sql-sanitizer.js';
import { injectPermissionFilter, isValidPermissionFilter } from '../utils/sql-permission-injector.js';
import { commonFilterSchema, buildWhereFromFilterParams } from '../utils/filter-params.js';

const router = Router();

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
    const parseResult = commonFilterSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      parseResult.data,
      req.permissionFilter || '1=1'
    );

    const sql = generateKpiQuery(finalWhereClause);
    const result = await duckdbService.query(sql);

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
    const parseResult = commonFilterSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      parseResult.data,
      req.permissionFilter || '1=1'
    );

    const sql = generateKpiDetailQuery(finalWhereClause, false);
    const result = await duckdbService.query(sql);

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

    // 解析通用筛选参数
    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      filterResult.data,
      req.permissionFilter || '1=1'
    );

    const sql = generatePremiumTrendQuery(
      timeView as TimeView,
      finalWhereClause,
      filterResult.data.dateField || 'policy_date',
      'premium'
    );
    const result = await duckdbService.query(sql);

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

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      filterResult.data,
      req.permissionFilter || '1=1'
    );

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
    const { growthType, timeView, baselineStart, baselineEnd, referenceYear } = growthResult.data;

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const { startDate, endDate } = filterResult.data;

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
    const result = await duckdbService.query(sql);

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

    // 权限过滤条件
    const permissionFilter = req.permissionFilter || '1=1';

    // queryType=batch: 返回结构化数据（成都/全省/各机构三层）
    if (queryType === 'batch') {
      const dateRange = {
        start: new Date(startDate),
        end: new Date(endDate),
      };

      const sql = generateFullCoefficientQuery(dateField, dateRange, permissionFilter);
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
      sql = generateCoefficientByOrgQuery(dateField, dateRange, permissionFilter);
    } else {
      sql = generateFullCoefficientQuery(dateField, dateRange, permissionFilter);
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
  analysisType: z.enum(['claimRatio', 'expenseRatio', 'comprehensiveCost', 'variableCost']).default('claimRatio'),
  dimension: z.enum(['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage']).default('org_level_3'),
  cutoffDate: z.string(),
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
    const { analysisType, dimension, cutoffDate } = costResult.data;

    if (!isValidDateFormat(cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
    }

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      filterResult.data,
      req.permissionFilter || '1=1'
    );

    const config = {
      dimension: dimension as CostDimension,
      cutoffDate,
      whereClause: finalWhereClause,
    };

    let sql: string;
    switch (analysisType) {
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
 * 车驾意推介率请求验证Schema（层层下钻）
 *
 * drillPath: JSON 数组，如 [{"dimension":"org_level_3","value":"天府"}]
 * groupBy: 当前分组维度（不传则仅返回汇总）
 */
const CROSS_SELL_DIMENSIONS = [
  'org_level_3', 'team', 'salesman', 'customer_category',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
] as const;

const crossSellExtraSchema = z.object({
  drillPath: z.string().optional().default('[]'),
  groupBy: z.enum(CROSS_SELL_DIMENSIONS).optional(),
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

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      filterResult.data,
      req.permissionFilter || '1=1'
    );

    // 始终查询汇总行（应用 drillPath 过滤的汇总）
    // 如果有 groupBy，同时查询分组数据
    const [summaryResult, drilldownResult] = await Promise.all([
      duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, null)),
      groupBy
        ? duckdbService.query(generateCrossSellQuery(finalWhereClause, drillPath, groupBy))
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

    const filterResult = commonFilterSchema.safeParse(req.query);
    if (!filterResult.success) {
      throw new AppError(400, filterResult.error.issues[0].message);
    }

    const finalWhereClause = buildWhereFromFilterParams(
      filterResult.data,
      req.permissionFilter || '1=1'
    );

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

export default router;
