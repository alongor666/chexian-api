/**
 * 维修资源分析路由
 *
 * 数据源：RepairDim TABLE
 * 端点：/api/query/repair/*
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, createDomainMiddleware } from './shared.js';
import {
  generateRepairOverviewQuery,
  generateRepairDetailQuery,
  generateRepairStatusQuery,
  generateRepairMetadataQuery,
  type RepairFilters,
} from '../../sql/repair.js';

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：RepairDim
router.use(createDomainMiddleware('RepairDim'));

const filterSchema = z.object({
  orgName: z.string().optional(),
  is4sShop: z.enum(['true', 'false']).optional(),
  cooperationStatus: z.string().optional(),
  city: z.string().optional(),
});

function parseFilters(query: Record<string, unknown>): RepairFilters {
  const result = filterSchema.safeParse(query);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}

/** GET /api/query/repair/overview — 机构级汇总 */
router.get(
  '/repair/overview',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateRepairOverviewQuery(filters));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/detail — 修理厂明细 */
router.get(
  '/repair/detail',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
    const data = await duckdbService.query(
      generateRepairDetailQuery(filters, pageSize, (page - 1) * pageSize)
    );
    res.json({ success: true, data, page, pageSize });
  })
);

/** GET /api/query/repair/status — 合作状态分布 */
router.get(
  '/repair/status',
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const data = await duckdbService.query(generateRepairStatusQuery(filters));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/metadata — 筛选选项 */
router.get(
  '/repair/metadata',
  asyncHandler(async (_req, res) => {
    const data = await duckdbService.query(generateRepairMetadataQuery());
    res.json({ success: true, data: data[0] ?? {} });
  })
);

export default router;
