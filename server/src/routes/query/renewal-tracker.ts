/**
 * 续保追踪路由 — /api/query/renewal-tracker
 *
 * 数据源：RenewalTrackerFact（派生域，惰性加载）
 * 不走 parseFiltersAndBuildWhere（它会引用 PolicyFactRealtime 特有的列），
 * 改用专用受限筛选器解析 — 只支持 RenewalTrackerFact 已预派生的字段。
 *
 * 时间维度：expiry_date + cutoff 独立参数
 * 非时间维度：
 *   - orgNames / salesmanNames / customerCategories（原有）
 *   - coverageCombinations / fuelCategories / usedTransferTypes / renewalTypes（快捷筛选新增）
 *   - isNev / isNewCar / isTransfer / isRenewal（来自 QuickFilterBar 的布尔开关）
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
  withRouteCache,
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
 * 解析 'true' / 'false' 字符串为布尔条件；其他值返回 null（不添加筛选）
 */
function parseBooleanCondition(value: unknown, column: string): string | null {
  if (value === 'true') return `${column} = true`;
  if (value === 'false') return `${column} = false`;
  return null;
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
 *   coverageCombinations (CSV) 可选 — 险别组合筛选（主全/交三/单交）
 *   fuelCategories (CSV) 可选 — 能源类型（油/电）
 *   usedTransferTypes (CSV) 可选 — 新旧过户（新车/旧车过户/旧车非过户）
 *   renewalTypes (CSV) 可选 — 续转新车（新车/续保/转保）
 *   isNev / isNewCar / isTransfer / isRenewal (true/false) 可选
 */
router.get(
  '/renewal-tracker',
  withRouteCache('renewal-tracker'),
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

    const extraConditions: string[] = [];

    // 原有 3 个维度（字符串多选 → IN 条件）
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

    // 新增 4 个派生维度（快捷筛选）
    const coverageCombinations = csvToArray(req.query.coverageCombinations);
    if (coverageCombinations.length > 0) {
      extraConditions.push(buildInCondition('coverage_combination', coverageCombinations));
    }

    const fuelCategories = csvToArray(req.query.fuelCategories);
    if (fuelCategories.length > 0) {
      extraConditions.push(buildInCondition('fuel_category', fuelCategories));
    }

    const usedTransferTypes = csvToArray(req.query.usedTransferTypes);
    if (usedTransferTypes.length > 0) {
      extraConditions.push(buildInCondition('used_transfer_type', usedTransferTypes));
    }

    const renewalTypes = csvToArray(req.query.renewalTypes);
    if (renewalTypes.length > 0) {
      extraConditions.push(buildInCondition('renewal_type', renewalTypes));
    }

    // 4 个布尔开关（QuickFilterBar 直接写入）
    const boolParams: Array<[string, string]> = [
      ['isNev', 'is_nev'],
      ['isNewCar', 'is_new_car'],
      ['isTransfer', 'is_transfer'],
      ['isRenewal', 'is_renewal'],
    ];
    for (const [queryKey, column] of boolParams) {
      const cond = parseBooleanCondition(req.query[queryKey], column);
      if (cond) extraConditions.push(cond);
    }

    // 权限过滤
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
      coverage_combination: string | null;
      fuel_category: string | null;
      used_transfer_type: string | null;
      renewal_type: string | null;
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

    // 数值规范化（DuckDB BIGINT 可能返回 BigInt）
    const normalized = rows.map(r => ({
      ...r,
      A: Number(r.A) || 0,
      B: Number(r.B) || 0,
      C: Number(r.C) || 0,
    }));

    // 按 row_level 拆分到 6 组（基础 4 层 + 5 个维度，每个维度跨 4 层）
    const BASE_LEVELS = ['overall', 'org', 'team', 'salesman'];
    const CATEGORY_LEVELS = ['overall_category', 'org_category', 'team_category', 'salesman_category'];
    const COVERAGE_LEVELS = ['overall_coverage', 'org_coverage', 'team_coverage', 'salesman_coverage'];
    const FUEL_LEVELS = ['overall_fuel', 'org_fuel', 'team_fuel', 'salesman_fuel'];
    const USED_TRANSFER_LEVELS = ['overall_used_transfer', 'org_used_transfer', 'team_used_transfer', 'salesman_used_transfer'];
    const RENEWAL_TYPE_LEVELS = ['overall_renewal_type', 'org_renewal_type', 'team_renewal_type', 'salesman_renewal_type'];

    const orgRows = normalized.filter(r => BASE_LEVELS.includes(r.row_level));
    const categoryRows = normalized.filter(r => CATEGORY_LEVELS.includes(r.row_level));
    const coverageRows = normalized.filter(r => COVERAGE_LEVELS.includes(r.row_level));
    const fuelRows = normalized.filter(r => FUEL_LEVELS.includes(r.row_level));
    const usedTransferRows = normalized.filter(r => USED_TRANSFER_LEVELS.includes(r.row_level));
    const renewalTypeRows = normalized.filter(r => RENEWAL_TYPE_LEVELS.includes(r.row_level));
    const overall = normalized.find(r => r.row_level === 'overall') || null;

    sendWithEtag(
      req,
      res,
      {
        success: true,
        data: {
          orgRows,
          categoryRows,
          coverageRows,
          fuelRows,
          usedTransferRows,
          renewalTypeRows,
          overall,
        },
        meta: metaRows[0] || null,
      },
      HTTP_MAX_AGE.query
    );
  })
);

export default router;
