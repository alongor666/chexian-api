/**
 * 续保漏斗分析路由
 *
 * 数据源：RenewalFunnel 视图（独立于 PolicyFact）
 * 端点：/api/query/renewal-funnel/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService } from './shared.js';
import {
  generateFunnelOverviewQuery,
  generateFunnelTrendQuery,
  generateFunnelTeamQuery,
  generateFunnelSalesmanQuery,
  generateFunnelActionListQuery,
  generateFunnelRiskQuery,
  generateFunnelMatrixQuery,
  type RenewalFunnelFilters,
} from '../../sql/renewal-funnel.js';

const router = Router();

const funnelFilterSchema = z.object({
  orgName: z.string().optional(),
  teamName: z.string().optional(),
  salesmanName: z.string().optional(),
  month: z.string().optional(),
  maturityFilter: z.enum(['mature', 'pending', 'all']).default('all'),
  insuranceGrade: z.string().optional(),
  daysRange: z.coerce.number().optional(),
  actionPriority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
});

function parseFilters(query: Record<string, unknown>): RenewalFunnelFilters {
  const result = funnelFilterSchema.safeParse(query);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0].message);
  }
  return result.data;
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
    const sql = generateFunnelActionListQuery(filters);
    const data = await duckdbService.query(sql);
    res.json({ success: true, data });
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
