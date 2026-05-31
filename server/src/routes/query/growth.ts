import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler, AppError, duckdbService,
  commonFilterSchema, buildWhereFromFilterParams,
  isValidDateFormat,
  QUERY_CACHE, withRouteCache,
} from './shared.js';
import {
  generateGrowthQuery,
  generateDailyGrowthWithContextQuery,
  GrowthConfig,
  GrowthType,
  TimeView as GrowthTimeView,
} from '../../sql/growth.js';

const router = Router();

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
  withRouteCache('growth'),
  asyncHandler(async (req, res) => {
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
      // B300: startDate/endDate 会被剥离出 WHERE 并直接进入 currentPeriod 拼入 SQL，
      // 必须与 baseline 一样强制校验格式，否则绕过 buildWhereFromFilterParams 的日期校验
      if (
        !isValidDateFormat(baselineStart) || !isValidDateFormat(baselineEnd) ||
        !isValidDateFormat(startDate) || !isValidDateFormat(endDate)
      ) {
        throw new AppError(400, 'Invalid date format. Expected YYYY-MM-DD');
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
      // B300: 同 daily-context，custom 下 startDate/endDate 进入 currentPeriod 直接拼 SQL，须校验格式
      if (
        !isValidDateFormat(baselineStart) || !isValidDateFormat(baselineEnd) ||
        !isValidDateFormat(startDate) || !isValidDateFormat(endDate)
      ) {
        throw new AppError(400, 'Invalid date format. Expected YYYY-MM-DD');
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

export default router;
