/**
 * 客户来源去向分析路由
 *
 * 数据源：CustomerFlow VIEW（派生自 PolicyFact，BACKLOG 86d10f）
 * 端点：/api/query/customer-flow/*
 * RLS：消费 req.permissionFilter，org_user/telemarketing_user/branch_admin 自动按权限隔离
 */

import { Router } from 'express';
import type { Request } from 'express';
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

/**
 * 共享 parser（parseFiltersAndBuildWhere）里 CustomerFlow 视图不支持的通用参数
 * （BACKLOG 8f71c0 · 2026-06-27 山西 13 账号验证撞出，与省份无关）。
 * CustomerFlow 是 loadCustomerFlow 的 10 列显式投影视图（duckdb-domain-loaders.ts），
 * 不含 policy_date/salesman_name/renewal_mode/tonnage_segment/insurance_grade 及
 * is_renewal 等 PolicyFact 其余列，共享 parser 按这些参数注入 WHERE 会触发
 * DuckDB Binder Error → HTTP 400「列不存在：policy_date」（duckdb-error-classifier）。
 */
const FLOW_UNSUPPORTED_COMMON_PARAMS = [
  'salesmanNames', 'salesmanName',
  'renewalModes', 'tonnageSegments', 'insuranceGrades',
  'isRenewal', 'isNewCar', 'isTransfer', 'isNev',
  'isRenewable', 'isCrossSell', 'isCommercialInsure',
  'fuelCategory', // 三个取值均依赖 is_nev/fuel_type 列（本视图无）
] as const;

/**
 * 净化副本（与 cross-sell sanitizeAggQuery 同款模式，不修改 req.query）：
 *   - startDate/endDate 保留，dateField 强制 'insurance_start_date'（本视图唯一日期列，
 *     与本域 year 筛选同口径）—— 保留调用方「时间窗」意图，不静默丢弃，同时杜绝共享
 *     parser 默认 policy_date 口径造成的 Binder Error；
 *   - 视图不存在列的维度参数防御性剥离，不做语义映射；
 *   - vehicleQuickFilter 仅保留只用 customer_category 的取值（home_car/motorcycle/rental），
 *     其余取值依赖 tonnage_segment/vehicle_model（本视图无）→ 剥离。
 *
 * 🔒 RLS 不变量：净化只作用于用户 query 参数维度，不触碰 permissionFilter 通道——
 * buildWhereFromFilterParams 把 requirePermissionFilter(req.permissionFilter) 独立 AND 到
 * WHERE 尾部（filter-params.ts），org_level_3/branch_code/is_telemarketing 三个 RLS 列
 * 本视图均真实存在且不在剥离清单内，权限隔离不受净化影响。
 */
export function sanitizeFlowQuery(query: Request['query']): Request['query'] {
  const out = { ...query };
  for (const key of FLOW_UNSUPPORTED_COMMON_PARAMS) {
    delete out[key];
  }
  if (out.startDate !== undefined || out.endDate !== undefined || out.dateField !== undefined) {
    out.dateField = 'insurance_start_date';
  }
  const vqf = out.vehicleQuickFilter;
  if (vqf !== undefined && vqf !== 'home_car' && vqf !== 'motorcycle' && vqf !== 'rental') {
    delete out.vehicleQuickFilter;
  }
  return out;
}

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
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
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
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
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
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
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
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
    const data = await duckdbService.query(generateFlowTrendQuery(filters, whereClause));
    res.json({ success: true, data });
  })
);

/** GET /api/query/customer-flow/metadata — 元数据 */
router.get(
  '/customer-flow/metadata',
  withRouteCache('customer-flow-metadata', 14_400_000),
  asyncHandler(async (req, res) => {
    const { whereClause } = parseFiltersAndBuildWhere(req, sanitizeFlowQuery(req.query));
    const data = await duckdbService.query(generateFlowMetadataQuery(whereClause));
    res.json({ success: true, data: data[0] ?? {} });
  })
);

export default router;
