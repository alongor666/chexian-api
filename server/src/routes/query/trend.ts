import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, duckdbService, sendWithEtag, QUERY_CACHE, HTTP_MAX_AGE, parseFiltersAndBuildWhere, resolveGroupDim, withRouteCache } from './shared.js';
import { generatePremiumTrendQuery, generateQualityBusinessTrendQuery, TimeView } from '../../sql/trend.js';
import type { ViewPerspective } from '../../types/view-perspective.js';

const router = Router();

/**
 * 趋势查询请求验证Schema
 * 兼容前端 granularity (day/week/month) 和后端 timeView (daily/weekly/monthly) 两种参数名
 */
export const granularityMap: Record<string, string> = {
  day: 'daily', week: 'weekly', month: 'monthly',
  daily: 'daily', weekly: 'weekly', monthly: 'monthly',
};

export const trendExtraSchema = z.object({
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
  withRouteCache('trend'),
  asyncHandler(async (req, res) => {
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
    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    sendWithEtag(req, res, {
      success: true,
      data: result,
    }, HTTP_MAX_AGE.query);
  })
);

/**
 * GET /api/query/quality-business-trend
 * 获取优质业务占比趋势数据
 */
router.get(
  '/quality-business-trend',
  withRouteCache('quality-business-trend'),
  asyncHandler(async (req, res) => {
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
    const result = await duckdbService.query(sql, QUERY_CACHE.hotspotMedium);

    sendWithEtag(req, res, {
      success: true,
      data: result,
    }, HTTP_MAX_AGE.query);
  })
);

/**
 * GET /api/query/test
 * 测试查询端点（验证数据库连接和权限过滤）
 *
 * 不接 withRouteCache：响应体含 req.user，但 buildRouteCacheKey 仅按
 * routeName + permissionFilter + query 生成键。同 permissionFilter 的
 * 不同用户（如多个 branch_admin / 1=1）会跨用户命中前者缓存导致身份泄露。
 */
router.get(
  '/test',
  asyncHandler(async (req, res) => {
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

export default router;
