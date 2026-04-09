/**
 * 客户来源去向分析路由
 *
 * 数据源：CustomerFlow VIEW
 * 端点：/api/query/customer-flow/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService } from './shared.js';
import {
  generateInflowQuery,
  generateOutflowQuery,
  generateFlowTrendQuery,
  generateFlowSummaryQuery,
  generateFlowMetadataQuery,
  type CustomerFlowFilters,
} from '../../sql/customer-flow.js';

const router = Router();

router.use(
  asyncHandler(async (_req, _res, next) => {
    try {
      await duckdbService.query('SELECT 1 FROM CustomerFlow LIMIT 1');
      next();
    } catch {
      throw new AppError(503, '客户来源去向数据未加载');
    }
  })
);

const filterSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030).optional(),
});

function parseFilters(query: Record<string, unknown>): CustomerFlowFilters {
  const result = filterSchema.safeParse(query);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}

/** GET /api/query/customer-flow/summary — 总览统计 */
router.get(
  '/customer-flow/summary',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateFlowSummaryQuery(filters));
    res.json({ success: true, data: data[0] ?? {} });
  })
);

/** GET /api/query/customer-flow/inflow — 转入分析 */
router.get(
  '/customer-flow/inflow',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateInflowQuery(filters));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/outflow — 流失分析 */
router.get(
  '/customer-flow/outflow',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateOutflowQuery(filters));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/trend — 月度趋势 */
router.get(
  '/customer-flow/trend',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateFlowTrendQuery(filters));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/metadata — 元数据 */
router.get(
  '/customer-flow/metadata',
  asyncHandler(async (_req, res) => {
    const data = await duckdbService.query(generateFlowMetadataQuery());
    res.json({ success: true, data: data[0] ?? {} });
  })
);

export default router;
