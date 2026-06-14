/**
 * 维修资源分析路由
 *
 * 数据源：RepairDim TABLE
 * 端点：/api/query/repair/*
 */

import { Router, Request } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError, duckdbService, createDomainMiddleware, withRouteCache } from './shared.js';
import {
  generateRepairOverviewQuery,
  generateRepairDetailQuery,
  generateRepairStatusQuery,
  generateRepairMetadataQuery,
  generateRepairCityQuery,
  generateRepairChannelQuery,
  generateRepairCoopTierQuery,
  generateRepairScatterQuery,
  generateRepairLocalResourceQuery,
  generateRepairToPremiumQuery,
  generateRepairDiversionListQuery,
  generateRepairOrphanShopsQuery,
  type RepairFilters,
  type RepairFiltersV2,
} from '../../sql/repair.js';

/**
 * RepairDim 权限过滤适配器（BACKLOG 2026-06-14-claude-9719ff）
 *
 * RepairDim 是维修厂维度表，含 org_level_3，但不含 is_telemarketing / branch_code。
 * 直接将 req.permissionFilter 传给 RepairDim WHERE 子句，电销/多分公司场景会 Binder Error。
 *
 * 策略：
 *  - branch_admin（'1=1'）→ 不限制
 *  - org_user（'org_level_3=...'）→ 直接用（RepairDim 有该字段）
 *  - telemarketing_user（'is_telemarketing=true'）→ 降为 '1=1'
 *    （维修资源无电销概念，允许全量查询）
 *  - 多分公司启用（含 branch_code）→ 只保留 org_level_3 部分
 *    （RepairDim 是全省维度表，不分分公司）
 */
function buildRepairPermissionWhere(req: Request): string {
  const pf = req.permissionFilter;
  if (!pf || pf === '1=1') return '1=1';
  // 提取 org_level_3 = '...' 部分（支持转义单引号 ''）
  const match = pf.match(/org_level_3\s*=\s*'(?:[^']|'')*'/);
  return match ? match[0] : '1=1';
}

const router = Router();

// 集中式惰性域加载中间件（per MAT-01）：RepairDim
router.use(createDomainMiddleware('RepairDim'));

export const filterSchema = z.object({
  orgName: z.string().optional(),
  is4sShop: z.enum(['true', 'false']).optional(),
  cooperationStatus: z.string().optional(),
  city: z.string().optional(),
});

const filterSchemaV2 = filterSchema.extend({
  district: z.string().optional(),
  shopCode: z.string().optional(),
  coopTier: z.enum(['active', 'past', 'none']).optional(),
  timeWindow: z.enum(['ytd', 'rolling12', 'all']).optional(),
});

function parseFilters(query: Record<string, unknown>): RepairFilters {
  const result = filterSchema.safeParse(query);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}

function parseFiltersV2(query: Record<string, unknown>): RepairFiltersV2 {
  const result = filterSchemaV2.safeParse(query);
  if (!result.success) throw new AppError(400, result.error.issues[0].message);
  return result.data;
}

/** GET /api/query/repair/overview — 机构级汇总 */
router.get(
  '/repair/overview',
  withRouteCache('repair-overview'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairOverviewQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/detail — 修理厂明细 */
router.get(
  '/repair/detail',
  withRouteCache('repair-detail'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
    const data = await duckdbService.query(
      generateRepairDetailQuery(filters, pageSize, (page - 1) * pageSize, whereClause)
    );
    res.json({ success: true, data, page, pageSize });
  })
);

/** GET /api/query/repair/status — 合作状态分布 */
router.get(
  '/repair/status',
  withRouteCache('repair-status'),
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairStatusQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/metadata — 筛选选项（按权限限制可见机构范围） */
router.get(
  '/repair/metadata',
  withRouteCache('repair-metadata', 14_400_000),
  asyncHandler(async (req, res) => {
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairMetadataQuery(whereClause));
    res.json({ success: true, data: data[0] ?? {} });
  })
);

// ============================================================================
// v2 路由（2026-04-18 重设计）：单页下钻 + 三态分布 + 本地资源占比 + 导流清单
// ClaimsDetail × RepairDim JOIN 路由需要两个域均已加载
// ============================================================================

// 单页下钻需要 ClaimsDetail 域
const v2Router = Router();
v2Router.use(createDomainMiddleware('ClaimsDetail'));

/** GET /api/query/repair/city — 城市汇总 */
v2Router.get(
  '/repair/city',
  withRouteCache('repair-city'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairCityQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/channel — 渠道 × 4S 交叉 */
v2Router.get(
  '/repair/channel',
  withRouteCache('repair-channel'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairChannelQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/coop-tier — 三态合作分布（含影子网点） */
v2Router.get(
  '/repair/coop-tier',
  withRouteCache('repair-coop-tier'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairCoopTierQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/scatter — 散点图（区县×机构，三态颜色） */
v2Router.get(
  '/repair/scatter',
  withRouteCache('repair-scatter'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairScatterQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/local-resource — 本地资源占比（L4 JOIN） */
v2Router.get(
  '/repair/local-resource',
  withRouteCache('repair-local-resource'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairLocalResourceQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/to-premium — 修保比（维修产值/净保费） */
v2Router.get(
  '/repair/to-premium',
  withRouteCache('repair-to-premium'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const data = await duckdbService.query(generateRepairToPremiumQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/repair/diversion-list — 导流目标保单清单 */
v2Router.get(
  '/repair/diversion-list',
  withRouteCache('repair-diversion-list'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize) || 200));
    const data = await duckdbService.query(
      generateRepairDiversionListQuery(filters, pageSize, (page - 1) * pageSize, whereClause)
    );
    res.json({ success: true, data, page, pageSize });
  })
);

/** GET /api/query/repair/orphan-shops — 影子网点（未合作+地理归属） */
v2Router.get(
  '/repair/orphan-shops',
  withRouteCache('repair-orphan-shops'),
  asyncHandler(async (req, res) => {
    const filters = parseFiltersV2(req.query);
    const whereClause = buildRepairPermissionWhere(req);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const data = await duckdbService.query(generateRepairOrphanShopsQuery(filters, limit, whereClause));
    res.json({ success: true, data });
  })
);

router.use(v2Router);

export default router;
