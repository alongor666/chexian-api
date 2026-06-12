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
  generateDualMetricComparisonQuery,
  GrowthConfig,
  GrowthType,
  TimeView as GrowthTimeView,
} from '../../sql/growth.js';
import { dbEnv } from '../../config/env.js';
import { isGrowthCubeServable, rewriteGrowthSqlForCube } from '../../sql/cube/growth-cube.js';
import { ensureTrendCubeFresh } from '../../services/duckdb-cube.js';
import { runShadowCompare } from '../../services/cube-shadow.js';

const router = Router();

/**
 * 通用可加性立方体接线（第二批次，BACKLOG uid=2026-06-11-claude-90a92c）。
 * 双开关默认关闭时零生效。返回 null 表示走原路径（不可服务/未就绪/开关关闭）。
 * 影子模式：返回 null（外层照常走原路径），同时后台双跑比对。
 */
async function tryGrowthCube(
  legacySql: string,
  servabilityArgs: Parameters<typeof isGrowthCubeServable>[0],
  cacheTtl: number,
  legacyRunner: () => Promise<Array<Record<string, unknown>>>
): Promise<Array<Record<string, unknown>> | null> {
  const cubeRouting = dbEnv.CUBE_ROUTING_ENABLED === 'true';
  const cubeShadow = dbEnv.CUBE_SHADOW_COMPARE === 'true';
  if (!cubeRouting && !cubeShadow) return null;
  if (!isGrowthCubeServable(servabilityArgs).servable) return null;
  if (ensureTrendCubeFresh(duckdbService) !== 'ready') return null;

  const cubeSql = rewriteGrowthSqlForCube(legacySql);
  if (cubeRouting) {
    return duckdbService.query(cubeSql, cacheTtl);
  }
  // 影子对账：先取原路径结果返回调用方，后台比对立方体结果
  const legacyResult = await legacyRunner();
  runShadowCompare('growth', legacyResult, () => duckdbService.query(cubeSql));
  return legacyResult;
}

/**
 * 允许的分组维度白名单（安全：groupBy 字段会直接拼入 GROUP BY，禁止透传任意字段名）
 * 当前前端对比页仅支持「按机构 / 按业务员」，对应字段如下。
 */
const GROWTH_GROUPBY_DIMENSIONS = ['org_level_3', 'salesman_name'] as const;

/**
 * 解析并白名单校验 groupBy（CSV → string[]）。
 * 任一字段不在白名单 → 抛 400（防 SQL 注入 + 明确报错）。
 */
function parseGroupBy(raw: string | undefined): string[] {
  if (!raw) return [];
  const dims = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const d of dims) {
    if (!(GROWTH_GROUPBY_DIMENSIONS as readonly string[]).includes(d)) {
      throw new AppError(400, `Invalid groupBy dimension: ${d}`);
    }
  }
  return dims;
}

/**
 * 增长率分析请求验证Schema
 */
export const growthExtraSchema = z.object({
  growthType: z.enum(['yoy', 'mom', 'ytd', 'custom']).default('yoy'),
  timeView: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  baselineStart: z.string().optional(),
  baselineEnd: z.string().optional(),
  referenceYear: z.coerce.number().optional(),
  type: z.string().optional(),
  // 分组维度（CSV，如 'org_level_3' 或 'salesman_name'）；白名单校验在 parseGroupBy
  groupBy: z.string().optional(),
  // 单指标聚合（白名单：保费 / 件数）；不传则由 SQL 生成器默认 SUM(premium)
  metric: z.enum(['SUM(premium)', 'COUNT(*)']).optional(),
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
    const { growthType, timeView, baselineStart, baselineEnd, referenceYear, type: queryType, metric } = growthResult.data;
    const groupBy = parseGroupBy(growthResult.data.groupBy);

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
      const cubeResult = await tryGrowthCube(
        sql,
        { whereClause: finalWhereClause, metric },
        QUERY_CACHE.hotspotShort,
        () => duckdbService.query(sql, QUERY_CACHE.hotspotShort)
      );
      const result = cubeResult ?? await duckdbService.query(sql, QUERY_CACHE.hotspotShort);

      res.json({
        success: true,
        data: result,
      });
      return;
    }

    // dual-metric 类型：双指标（保费 + 件数）自定义期间对比，按 groupBy 维度分组。
    // 输出 dim_key / current_premium / previous_premium / current_count / previous_count
    // / premium_growth_rate / count_growth_rate（前端 analyzeDualMetricComparison 消费）。
    if (queryType === 'dual-metric' && startDate && endDate && baselineStart && baselineEnd) {
      // 同 daily-context：startDate/endDate 进入 currentPeriod 直接拼 SQL，须校验格式
      if (
        !isValidDateFormat(baselineStart) || !isValidDateFormat(baselineEnd) ||
        !isValidDateFormat(startDate) || !isValidDateFormat(endDate)
      ) {
        throw new AppError(400, 'Invalid date format. Expected YYYY-MM-DD');
      }

      // 日期由 currentPeriod/baselinePeriod 控制，不进入 WHERE
      const filterParamsNoDates = { ...filterResult.data, startDate: undefined, endDate: undefined };
      const finalWhereClause = buildWhereFromFilterParams(
        filterParamsNoDates,
        req.permissionFilter || '1=1'
      );

      const config: GrowthConfig = {
        growthType: 'custom' as GrowthType,
        timeView: 'daily' as GrowthTimeView,
        whereClause: finalWhereClause,
        currentPeriod: { startDate, endDate },
        baselinePeriod: { startDate: baselineStart, endDate: baselineEnd },
        // 前端默认按机构；groupBy 为空时兜底 org_level_3（生成器要求至少 1 维）
        groupBy: groupBy.length > 0 ? groupBy : ['org_level_3'],
      };

      const sql = generateDualMetricComparisonQuery(config);
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
      // 单指标分组：groupBy 为空则退化为整体汇总（生成器 GROUP BY 'all'）
      groupBy,
      // metric 仅在前端显式传入时覆盖，否则生成器默认 SUM(premium)
      ...(metric ? { metric } : {}),
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
    const cubeResult = await tryGrowthCube(
      sql,
      { whereClause: finalWhereClause, metric, groupBy },
      QUERY_CACHE.hotspotMedium,
      () => duckdbService.query(sql, QUERY_CACHE.hotspotMedium)
    );
    const result = cubeResult ?? await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
