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
export function parseFiltersAndBuildWhere(req: Request): {
  filterData: CommonFilterParams;
  whereClause: string;
} {
  const parseResult = commonFilterSchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new AppError(400, parseResult.error.issues[0].message);
  }

  const whereClause = buildWhereFromFilterParams(
    parseResult.data,
    req.permissionFilter || '1=1'
  );

  return { filterData: parseResult.data, whereClause };
}

/**
 * 解析通用筛选参数并构建双 WHERE 子句（含日期 + 不含日期）
 *
 * 用于需要同时使用两种 WHERE 子句的路由（如 KPI、performance-summary 等）
 */
export type DateFieldType = 'policy_date' | 'insurance_start_date';

export function parseFiltersAndBuildBothWhere(req: Request): {
  filterData: CommonFilterParams;
  whereWithDate: string;
  whereWithoutDate: string;
  dateField: DateFieldType;
} {
  const parseResult = commonFilterSchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new AppError(400, parseResult.error.issues[0].message);
  }

  const permissionFilter = req.permissionFilter || '1=1';
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
