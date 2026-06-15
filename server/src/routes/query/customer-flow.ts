/**
 * 客户来源去向分析路由
 *
 * 数据源：CustomerFlow VIEW（派生自 PolicyFact，BACKLOG 86d10f）
 * 端点：/api/query/customer-flow/*
 * RLS：消费 req.permissionFilter，org_user/telemarketing_user/branch_admin 自动按权限隔离
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, createDomainMiddleware, withRouteCache, parseFiltersAndBuildWhere } from './shared.js';
import {
  generateInflowQuery,
  generateOutflowQuery,
  generateFlowTrendQuery,
  generateFlowSummaryQuery,
  generateFlowMetadataQuery,
  type CustomerFlowFilters,
} from '../../sql/customer-flow.js';

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：CustomerFlow
router.use(createDomainMiddleware('CustomerFlow'));

export const filterSchema = z.object({
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
  withRouteCache('customer-flow-summary'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const data = await duckdbService.query(generateFlowSummaryQuery(filters, whereClause));
    res.json({ success: true, data: data[0] ?? {} });
  })
);

/** GET /api/query/customer-flow/inflow — 转入分析 */
router.get(
  '/customer-flow/inflow',
  withRouteCache('customer-flow-inflow'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const data = await duckdbService.query(generateInflowQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/outflow — 流失分析 */
router.get(
  '/customer-flow/outflow',
  withRouteCache('customer-flow-outflow'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const data = await duckdbService.query(generateOutflowQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/trend — 月度趋势 */
router.get(
  '/customer-flow/trend',
  withRouteCache('customer-flow-trend'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const data = await duckdbService.query(generateFlowTrendQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/metadata — 元数据 */
router.get(
  '/customer-flow/metadata',
  withRouteCache('customer-flow-metadata', 14_400_000),
  asyncHandler(async (req, res) => {
    const { whereClause } = parseFiltersAndBuildWhere(req);
    const data = await duckdbService.query(generateFlowMetadataQuery(whereClause));
    res.json({ success: true, data: data[0] ?? {} });
  })
);

export default router;
