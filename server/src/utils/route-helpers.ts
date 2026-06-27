/**
 * 路由 Handler 公共逻辑
 * Route Handler Common Helpers
 *
 * 从 query.ts 提取的重复样板代码，包括：
 * - 通用筛选参数解析 + WHERE 子句构建
 * - 权限过滤器应用
 * - 机构/业务员名称提取
 *
 * 所有函数保持与原 query.ts 中内联逻辑完全一致的行为。
 */

import { Request } from 'express';
import { AppError } from '../middleware/error.js';
import { requirePermissionFilter } from '../middleware/permission.js';
import {
  commonFilterSchema,
  buildWhereFromFilterParams,
  buildWhereFromFilterParamsWithoutDate,
  type CommonFilterParams,
} from './filter-params.js';

/**
 * 解析通用筛选参数并构建 WHERE 子句（含日期）
 *
 * 等价于 query.ts 中反复出现的：
 *   const filterResult = commonFilterSchema.safeParse(req.query);
 *   if (!filterResult.success) throw new AppError(400, ...);
 *   const finalWhereClause = buildWhereFromFilterParams(filterResult.data, req.permissionFilter || '1=1');
 */
export function parseFiltersAndBuildWhere(
  req: Request,
  // 净化副本注入口：数据域不支持某些维度列时（如 CrossSellDailyAgg），
  // 传入剥离后的 query 副本，避免 parser 注入不存在的列（Binder Error）。
  // 不传时行为与原签名完全一致。
  queryOverride?: Request['query']
): {
  filterData: CommonFilterParams;
  whereClause: string;
} {
  const parseResult = commonFilterSchema.safeParse(queryOverride ?? req.query);
  if (!parseResult.success) {
    throw new AppError(400, parseResult.error.issues[0].message);
  }

  const whereClause = buildWhereFromFilterParams(
    parseResult.data,
    requirePermissionFilter(req.permissionFilter)
  );

  return { filterData: parseResult.data, whereClause };
}

/**
 * 解析通用筛选参数并构建双 WHERE 子句（含日期 + 不含日期）
 *
 * 用于需要同时使用两种 WHERE 子句的路由（如 KPI、performance-summary 等）
 */
export type DateFieldType = 'policy_date' | 'insurance_start_date';

export function parseFiltersAndBuildBothWhere(
  req: Request,
  queryOverride?: Request['query']
): {
  filterData: CommonFilterParams;
  whereWithDate: string;
  whereWithoutDate: string;
  dateField: DateFieldType;
} {
  const parseResult = commonFilterSchema.safeParse(queryOverride ?? req.query);
  if (!parseResult.success) {
    throw new AppError(400, parseResult.error.issues[0].message);
  }

  const permissionFilter = requirePermissionFilter(req.permissionFilter);
  const dateField: DateFieldType = parseResult.data.dateField || 'policy_date';

  const whereWithDate = buildWhereFromFilterParams(
    parseResult.data,
    permissionFilter
  );
  const whereWithoutDate = buildWhereFromFilterParamsWithoutDate(
    parseResult.data,
    permissionFilter
  );

  return { filterData: parseResult.data, whereWithDate, whereWithoutDate, dateField };
}

/**
 * 从筛选数据和权限过滤器中提取机构名称列表
 *
 * 等价于 query.ts /kpi 路由中的 orgNames 提取逻辑（lines 118-140）
 */
export function extractOrgNames(
  filterData: CommonFilterParams,
  permissionFilter?: string
): string[] {
  const orgNames = filterData.orgNames
    ? filterData.orgNames.split(',').map((item) => item.trim()).filter(Boolean)
    : filterData.orgLevel3
      ? [filterData.orgLevel3]
      : [];

  if (permissionFilter && permissionFilter !== '1=1') {
    const orgMatch = permissionFilter.match(/org_level_3\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
    if (orgMatch && !orgNames.includes(orgMatch[1])) {
      orgNames.push(orgMatch[1]);
    }
  }

  return orgNames;
}

/**
 * 从筛选数据和权限过滤器中提取业务员名称列表
 *
 * 等价于 query.ts /kpi 路由中的 salesmanNames 提取逻辑
 */
export function extractSalesmanNames(
  filterData: CommonFilterParams,
  permissionFilter?: string
): string[] {
  const salesmanNames = filterData.salesmanNames
    ? filterData.salesmanNames.split(',').map((item) => item.trim()).filter(Boolean)
    : filterData.salesmanName
      ? [filterData.salesmanName]
      : [];

  if (permissionFilter && permissionFilter !== '1=1') {
    const salesmanMatch = permissionFilter.match(/salesman_name\s*(?:LIKE|=)\s*'%?([^%']+)%?'/i);
    if (salesmanMatch && !salesmanNames.includes(salesmanMatch[1])) {
      salesmanNames.push(salesmanMatch[1]);
    }
  }

  return salesmanNames;
}

/**
 * 判断当前请求是否选择了特定机构（用于趋势查询的分组维度判断）
 *
 * 等价于 query.ts 趋势路由中的：
 *   const isOrgSelected = filterResult.data.orgLevel3 || (filterResult.data.orgNames && filterResult.data.orgNames.length > 0);
 *   const isOrgUser = req.user?.role === 'org_user';
 *   const groupDim = (isOrgSelected || isOrgUser) ? 'org_level_3' : "'全部'";
 */
export function resolveGroupDim(
  filterData: CommonFilterParams,
  req: Request
): string {
  const isOrgSelected = filterData.orgLevel3 || (filterData.orgNames && filterData.orgNames.length > 0);
  const isOrgUser = req.user?.role === 'org_user';
  return (isOrgSelected || isOrgUser) ? 'org_level_3' : "'全部'";
}

// ── B290 时间口径不变量：ytd-progress 路由禁止自由窗口参数 ────────────────────

/** 自由窗口参数名（用户可任意指定起止日期的窗口口径参数） */
const FREE_WINDOW_PARAMS = ['startDate', 'endDate', 'dateStart', 'dateEnd'] as const;

/** ytd-progress 口径路由声明窗口参数的违规记录 */
export interface TimeWindowParamViolation {
  readonly path: string;
  readonly key: string;
  readonly offendingParams: string[];
}

/**
 * B290 原始事故防回归不变量（编译期/CI 校验）：
 * 「年度计划进度」（ytd-progress）口径的路由禁止声明自由窗口参数。
 *
 * 根因（2026-05-12）：用户给日期窗口（5/1-5/11）却问"完成率"，若 ytd-progress
 * 路由接受 startDate/endDate，参数会被 zod 静默 strip（产出全量 YTD 值）或被 LLM
 * 误解为窗口口径——同一问题不同客户端答案不一致。锁死：ytd-progress 与自由窗口互斥。
 *
 * 纯函数：调用方注入路由元数据 + 参数集合解析器，便于单测覆盖合规/违规两路。
 * 范围（codex 闸-1 P2.4）：仅锁 ytd-progress；snapshot/policy-year 不纳入
 * （snapshot 可能合法按 endDate 取状态快照，blanket 禁会误伤）。
 *
 * @param routes      路由元数据（含 key / path / timeWindow）
 * @param allowedKeysOf  给定 path 返回其合法参数名集合；无契约的路由返回 undefined（跳过）
 */
export function findYtdProgressWindowParamViolations(
  routes: ReadonlyArray<{ readonly key: string; readonly path: string; readonly timeWindow: string }>,
  allowedKeysOf: (path: string) => ReadonlySet<string> | undefined
): TimeWindowParamViolation[] {
  const violations: TimeWindowParamViolation[] = [];
  for (const r of routes) {
    if (r.timeWindow !== 'ytd-progress') continue;
    const keys = allowedKeysOf(r.path);
    if (!keys) continue;
    const offendingParams = FREE_WINDOW_PARAMS.filter((p) => keys.has(p));
    if (offendingParams.length > 0) {
      violations.push({ path: r.path, key: r.key, offendingParams });
    }
  }
  return violations;
}
