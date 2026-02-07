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
import type { AdvancedFilterState } from '../types/data.js';
import { generateSalesmanAllBusinessRankingQuery, generateSalesmanQualityBusinessRankingQuery } from '../sql/salesman-ranking.js';
import { validateSQL } from '../utils/sql-validator.js';
import { buildDateCondition, buildStringCondition, escapeSqlString, isValidDateFormat } from '../utils/sql-sanitizer.js';
import { injectPermissionFilter, isValidPermissionFilter } from '../utils/sql-permission-injector.js';

const router = Router();

/**
 * 安全地构建日期范围WHERE条件
 * @param startDate - 开始日期
 * @param endDate - 结束日期
 * @param dateField - 日期字段名
 * @returns 条件数组
 */
function buildSafeDateConditions(
  startDate?: string,
  endDate?: string,
  dateField: string = 'policy_date'
): string[] {
  const conditions: string[] = ['1=1'];

  if (startDate) {
    if (!isValidDateFormat(startDate)) {
      throw new AppError(400, `Invalid startDate format: ${startDate}. Expected YYYY-MM-DD`);
    }
    conditions.push(buildDateCondition(dateField, '>=', startDate));
  }

  if (endDate) {
    if (!isValidDateFormat(endDate)) {
      throw new AppError(400, `Invalid endDate format: ${endDate}. Expected YYYY-MM-DD`);
    }
    conditions.push(buildDateCondition(dateField, '<=', endDate));
  }

  return conditions;
}

/**
 * 应用认证和权限中间件到所有查询路由
 */
router.use(authMiddleware);
router.use(permissionMiddleware);

/**
 * KPI查询请求验证Schema
 */
const kpiQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  orgLevel3: z.string().optional(),
  salesmanName: z.string().optional(),
});

/**
 * GET /api/query/kpi
 * 获取KPI数据（保费、件数、占比等）
 */
router.get(
  '/kpi',
  asyncHandler(async (req: Request, res: Response) => {
    // 1. 验证查询参数
    const parseResult = kpiQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { startDate, endDate, orgLevel3, salesmanName } = parseResult.data;

    // 2. 构建WHERE子句（用户筛选条件）- 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);

    if (orgLevel3) {
      conditions.push(buildStringCondition('org_level_3', orgLevel3));
    }
    if (salesmanName) {
      conditions.push(buildStringCondition('salesman_name', salesmanName));
    }

    const userWhereClause = conditions.join(' AND ');

    // 3. 合并权限过滤条件（行级安全）
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
      req.permissionFilter || '1=1'
    );

    // 4. 生成SQL并执行查询
    const sql = generateKpiQuery(finalWhereClause);
    const result = await duckdbService.query(sql);

    // 5. 返回结果
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
    // 1. 验证查询参数（复用 kpiQuerySchema）
    const parseResult = kpiQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { startDate, endDate, orgLevel3, salesmanName } = parseResult.data;

    // 2. 构建WHERE子句 - 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);

    if (orgLevel3) {
      conditions.push(buildStringCondition('org_level_3', orgLevel3));
    }
    if (salesmanName) {
      conditions.push(buildStringCondition('salesman_name', salesmanName));
    }

    const userWhereClause = conditions.join(' AND ');

    // 3. 合并权限过滤条件（行级安全）
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
      req.permissionFilter || '1=1'
    );

    // 4. 生成SQL并执行查询
    const sql = generateKpiDetailQuery(finalWhereClause, true);
    const result = await duckdbService.query(sql);

    // 5. 返回结果
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

const trendQuerySchema = z.object({
  timeView: z.string().optional(),
  granularity: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}).transform(data => ({
  timeView: (granularityMap[data.timeView || data.granularity || 'daily'] || 'daily') as 'daily' | 'weekly' | 'monthly',
  startDate: data.startDate,
  endDate: data.endDate,
}));

/**
 * GET /api/query/trend
 * 获取保费趋势数据
 */
router.get(
  '/trend',
  asyncHandler(async (req: Request, res: Response) => {
    // 1. 验证查询参数
    const parseResult = trendQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { timeView, startDate, endDate } = parseResult.data;

    // 2. 构建WHERE子句 - 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);
    const userWhereClause = conditions.join(' AND ');

    // 3. 合并权限过滤条件
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
      req.permissionFilter || '1=1'
    );

    // 4. 生成SQL并执行查询
    const sql = generatePremiumTrendQuery(
      timeView as TimeView,
      finalWhereClause,
      'policy_date',
      'premium'
    );
    const result = await duckdbService.query(sql);

    // 5. 返回结果
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
 * 营业货车分析请求验证Schema
 */
const truckQuerySchema = z.object({
  queryType: z.enum(['rose', 'orgByTonnage', 'tonnageByOrg']).default('rose'),
  metric: z.enum(['premium', 'count']).default('premium'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/**
 * GET /api/query/truck
 * 营业货车专项分析
 */
router.get(
  '/truck',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = truckQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { queryType, metric, startDate, endDate } = parseResult.data;

    // 构建WHERE子句 - 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);
    const userWhereClause = conditions.join(' AND ');
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
      req.permissionFilter || '1=1'
    );

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
const growthQuerySchema = z.object({
  growthType: z.enum(['yoy', 'mom', 'ytd', 'custom']).default('yoy'),
  timeView: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
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
    const parseResult = growthQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { growthType, timeView, startDate, endDate, baselineStart, baselineEnd, referenceYear } = parseResult.data;

    // 构建WHERE子句 - 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);
    const userWhereClause = conditions.join(' AND ');
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
      req.permissionFilter || '1=1'
    );

    const config: GrowthConfig = {
      growthType: growthType as GrowthType,
      timeView: timeView as GrowthTimeView,
      whereClause: finalWhereClause,
      referenceYear: referenceYear || new Date().getFullYear(),
    };

    if (growthType === 'custom' && baselineStart && baselineEnd && startDate && endDate) {
      // 验证自定义期间的日期格式
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
  queryType: z.enum(['byOrg', 'full']).default('byOrg'),
  dateField: z.string().default('policy_date'),
  startDate: z.string(),
  endDate: z.string(),
});

/**
 * GET /api/query/coefficient
 * 商车自主定价系数监控
 */
router.get(
  '/coefficient',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = coefficientQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { queryType, dateField, startDate, endDate } = parseResult.data;

    // 权限过滤条件
    const permissionFilter = req.permissionFilter || '1=1';

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
 * 成本分析请求验证Schema
 */
const costQuerySchema = z.object({
  analysisType: z.enum(['claimRatio', 'expenseRatio', 'comprehensiveCost', 'variableCost']).default('claimRatio'),
  dimension: z.enum(['customer_category', 'org_level_3', 'coverage_combination', 'org_customer', 'org_coverage']).default('org_level_3'),
  cutoffDate: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/**
 * GET /api/query/cost
 * 成本分析（赔付率/费用率/综合费用率/变动成本率）
 */
router.get(
  '/cost',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = costQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { analysisType, dimension, cutoffDate, startDate, endDate } = parseResult.data;

    // 验证 cutoffDate 格式
    if (!isValidDateFormat(cutoffDate)) {
      throw new AppError(400, `Invalid cutoffDate format: ${cutoffDate}. Expected YYYY-MM-DD`);
    }

    // 构建WHERE子句 - 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);
    const userWhereClause = conditions.join(' AND ');
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
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
 * 续保分析请求验证Schema
 */
const renewalQuerySchema = z.object({
  queryType: z.enum(['rate', 'detail']).default('rate'),
  targetYear: z.coerce.number().default(new Date().getFullYear()),
  targetMonth: z.coerce.number().default(new Date().getMonth() + 1),
  orgLevel3: z.string().optional(),
});

/**
 * GET /api/query/renewal
 * 续保分析
 */
router.get(
  '/renewal',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = renewalQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { queryType, targetYear, targetMonth, orgLevel3 } = parseResult.data;

    // 构建筛选条件（AdvancedFilterState格式）
    const filters: AdvancedFilterState = {};
    if (orgLevel3) filters.org_level_3 = [orgLevel3];

    // 权限过滤 - 添加到filters中
    const permissionFilter = req.permissionFilter || '1=1';
    if (permissionFilter !== '1=1') {
      // 解析权限过滤条件并添加到filters
      const orgMatch = permissionFilter.match(/org_level_3\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
      if (orgMatch && !filters.org_level_3) {
        filters.org_level_3 = [orgMatch[1]];
      }
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
 * 业务员排名请求验证Schema
 */
const salesmanRankingSchema = z.object({
  rankingType: z.enum(['all', 'quality']).default('all'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().default(10),
});

/**
 * GET /api/query/salesman-ranking
 * 业务员排名（全部业务/优质业务）
 */
router.get(
  '/salesman-ranking',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = salesmanRankingSchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(400, parseResult.error.issues[0].message);
    }

    const { rankingType, startDate, endDate, limit } = parseResult.data;

    // 构建WHERE子句 - 使用安全函数防止SQL注入
    const conditions = buildSafeDateConditions(startDate, endDate);

    const userWhereClause = conditions.join(' AND ');
    const finalWhereClause = permissionService.combineWhereClause(
      userWhereClause,
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
      // 无法安全注入权限，拒绝执行
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
