/**
 * 续保追踪路由 — /api/query/renewal-tracker
 *
 * 数据源：RenewalTrackerFact（派生域，惰性加载）
 * 不走 parseFiltersAndBuildWhere（它会引用 is_renewal/fuel_type/vehicle_model 等
 * PolicyFactRealtime 特有的列），改用专用受限筛选器解析 —
 * 只支持 orgNames / salesmanNames / customerCategories 三个非时间维度，
 * 时间维度用 expiry_date + cutoff 独立参数。
 */

import { Router } from 'express';
import {
  asyncHandler,
  AppError,
  duckdbService,
  isValidDateFormat,
  QUERY_CACHE,
  HTTP_MAX_AGE,
  sendWithEtag,
  createDomainMiddleware,
} from './shared.js';
import { buildInCondition } from '../../utils/sql-sanitizer.js';
import {
  generateRenewalTrackerQuery,
  generateRenewalTrackerMetaQuery,
} from '../../sql/renewal-tracker.js';

const router = Router();

// 惰性加载 RenewalTracker 域（首次访问触发）
router.use(createDomainMiddleware('RenewalTracker'));

/**
 * 把逗号分隔字符串转数组（过滤空值）
 */
function csvToArray(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * GET /api/query/renewal-tracker
 *
 * Query params:
 *   start         (YYYY-MM-DD) 必须 — expiry_date 范围起
 *   end           (YYYY-MM-DD) 必须 — expiry_date 范围止
 *   cutoff        (YYYY-MM-DD) 必须 — 报价/续保截至日
 *   orgNames      (CSV) 可选 — 三级机构筛选
 *   salesmanNames (CSV) 可选 — 业务员筛选
 *   customerCategories (CSV) 可选 — 客户类别筛选
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       orgRows:      RenewalRow[]  (overall + org + team + salesman)
 *       categoryRows: RenewalRow[]  (category + org_category)
 *       overall:      RenewalRow | null
 *     },
 *     meta: {
 *       exposure_row_count, distinct_vehicle_count,
 *       distinct_source_policy_count, latest_data_date
 *     }
 *   }
 */
router.get(
  '/renewal-tracker',
  asyncHandler(async (req, res) => {
    const { start, end, cutoff } = req.query;

    // 参数校验
    if (typeof start !== 'string' || !isValidDateFormat(start)) {
      throw new AppError(400, `Invalid or missing 'start' (expected YYYY-MM-DD)`);
    }
    if (typeof end !== 'string' || !isValidDateFormat(end)) {
      throw new AppError(400, `Invalid or missing 'end' (expected YYYY-MM-DD)`);
    }
    if (typeof cutoff !== 'string' || !isValidDateFormat(cutoff)) {
      throw new AppError(400, `Invalid or missing 'cutoff' (expected YYYY-MM-DD)`);
    }
    if (start > end) {
      throw new AppError(400, `'start' must be <= 'end'`);
    }

    // 构建非时间筛选条件（受限对齐：只支持 org/salesman/category 三维度）
    const extraConditions: string[] = [];

    const orgNames = csvToArray(req.query.orgNames);
    if (orgNames.length > 0) {
      extraConditions.push(buildInCondition('org_level_3', orgNames));
    }

    const salesmanNames = csvToArray(req.query.salesmanNames);
    if (salesmanNames.length > 0) {
      extraConditions.push(buildInCondition('salesman_name', salesmanNames));
    }

    const customerCategories = csvToArray(req.query.customerCategories);
    if (customerCategories.length > 0) {
      extraConditions.push(buildInCondition('customer_category', customerCategories));
    }

    // 权限过滤（permissionMiddleware 注入的 permissionFilter 针对 org_level_3 / salesman_name，
    // RenewalTrackerFact 都有这两列，可直接追加）
    const permissionFilter = req.permissionFilter;
    if (permissionFilter && permissionFilter !== '1=1') {
      extraConditions.push(`(${permissionFilter})`);
    }

    // 主查询
    const mainSql = generateRenewalTrackerQuery({ start, end, cutoff, extraConditions });
    const rows = await duckdbService.query<{
      row_level: string;
      org_level_3: string | null;
      team_name: string | null;
      salesman_name: string | null;
      customer_category: string | null;
      A: number;
      B: number;
      C: number;
    }>(mainSql, QUERY_CACHE.hotspotShort);

    // 元数据查询（universe 统计，无筛选，命中缓存效率高）
    const metaSql = generateRenewalTrackerMetaQuery();
    const metaRows = await duckdbService.query<{
      exposure_row_count: number;
      distinct_vehicle_count: number;
      distinct_source_policy_count: number;
      latest_data_date: string | null;
    }>(metaSql, QUERY_CACHE.hotspotLong);

    // 按 row_level 拆分
    const normalized = rows.map(r => ({
      ...r,
      A: Number(r.A) || 0,
      B: Number(r.B) || 0,
      C: Number(r.C) || 0,
    }));
    const orgRows = normalized.filter(r =>
      ['overall', 'org', 'team', 'salesman'].includes(r.row_level)
    );
    const categoryRows = normalized.filter(r =>
      ['category', 'org_category'].includes(r.row_level)
    );
    const overall = normalized.find(r => r.row_level === 'overall') || null;

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: { orgRows, categoryRows, overall },
        meta: metaRows[0] || null,
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
