/**
 * 续保漏斗分析路由
 *
 * 数据源：RenewalFunnel 视图（独立于 PolicyFact）
 * 端点：/api/query/renewal-funnel/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, isValidDateFormat } from './shared.js';
import {
  generateFunnelOverviewQuery,
  generateFunnelTrendQuery,
  generateFunnelTeamQuery,
  generateFunnelSalesmanQuery,
  generateFunnelActionListQuery,
  generateFunnelActionListCountQuery,
  generateFunnelRiskQuery,
  generateFunnelMatrixQuery,
  generateFunnelMetadataBoundsQuery,
  generateFunnelMetadataCategoriesQuery,
  type RenewalFunnelFilters,
} from '../../sql/renewal-funnel.js';

const router = Router();

/**
 * 中间件：确保 RenewalFunnel 视图已加载
 * 如果 Parquet 文件缺失或加载失败，返回 503 而非空数据
 */
router.use(
  asyncHandler(async (_req, _res, next) => {
    try {
      await duckdbService.query('SELECT 1 FROM RenewalFunnel LIMIT 1');
      next();
    } catch {
      throw new AppError(503, '续保漏斗数据未加载，请确认 renewal_funnel_*.parquet 文件存在并重启服务');
    }
  })
);

const funnelFilterSchema = z.object({
  orgName: z.string().optional(),
  teamName: z.string().optional(),
  salesmanName: z.string().optional(),
  month: z.string().optional(),
  maturityFilter: z.enum(['mature', 'pending', 'all']).default('all'),
  insuranceGrade: z.string().optional(),
  daysRange: z.coerce.number().optional(),
  actionPriority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  expiryDateStart: z.string().optional(),
  expiryDateEnd: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
  viewMode: z.enum(['year', 'month']).default('year'),
  customerCategory: z.string().optional(),
  groupBy: z.enum(['org', 'category']).default('org'),
});

function parseFilters(query: Record<string, unknown>): RenewalFunnelFilters {
  const result = funnelFilterSchema.safeParse(query);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0].message);
  }
  const filters = result.data;
  if (filters.expiryDateStart && !isValidDateFormat(filters.expiryDateStart)) {
    throw new AppError(400, 'expiryDateStart 格式无效，需 YYYY-MM-DD');
  }
  if (filters.expiryDateEnd && !isValidDateFormat(filters.expiryDateEnd)) {
    throw new AppError(400, 'expiryDateEnd 格式无效，需 YYYY-MM-DD');
  }
  return filters;
}

/**
 * GET /api/query/renewal-funnel/overview
 * 机构级漏斗总览
 */
router.get(
  '/renewal-funnel/overview',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFunnelOverviewQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/renewal-funnel/trend
 * 月度趋势（含成熟度标记）
 */
router.get(
  '/renewal-funnel/trend',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFunnelTrendQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/renewal-funnel/team
 * 团队排行与对比
 */
router.get(
  '/renewal-funnel/team',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFunnelTeamQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/renewal-funnel/salesman
 * 业务员续保明细
 */
router.get(
  '/renewal-funnel/salesman',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFunnelSalesmanQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/renewal-funnel/action-list
 * 即将到期未续保清单（行动导向）
 */
router.get(
  '/renewal-funnel/action-list',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 200;
    const [data, countResult] = await Promise.all([
      duckdbService.query(generateFunnelActionListQuery(filters)),
      duckdbService.query(generateFunnelActionListCountQuery(filters)),
    ]);
    const total = Number((countResult[0] as Record<string, unknown>)?.total ?? 0);
    res.json({ success: true, data, total, page, pageSize });
  })
);

/**
 * GET /api/query/renewal-funnel/matrix
 * 机构×等级 续保率矩阵
 */
router.get(
  '/renewal-funnel/matrix',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFunnelMatrixQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

/**
 * GET /api/query/renewal-funnel/metadata
 * 数据边界元信息（到期日范围 + 客户类别列表）
 */
router.get(
  '/renewal-funnel/metadata',
  asyncHandler(async (_req, res) => {
    const [boundsResult, categoriesResult] = await Promise.all([
      duckdbService.query(generateFunnelMetadataBoundsQuery()),
      duckdbService.query(generateFunnelMetadataCategoriesQuery()),
    ]);
    const bounds = boundsResult[0] as Record<string, unknown> | undefined;
    const categories = (categoriesResult as Record<string, unknown>[]).map(
      (r) => r.customer_category as string
    );
    res.json({
      success: true,
      data: {
        minExpiryDate: bounds?.min_expiry_date ?? null,
        maxExpiryDate: bounds?.max_expiry_date ?? null,
        categoryCount: Number(bounds?.category_count ?? 0),
        categories,
      },
    });
  })
);

/**
 * GET /api/query/renewal-funnel/risk
 * 风控等级交叉分析
 */
router.get(
  '/renewal-funnel/risk',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const sql = generateFunnelRiskQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
  })
);

export default router;
