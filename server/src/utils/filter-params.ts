/**
 * 统一筛选参数解析工具
 * Unified Filter Parameters Parser
 *
 * 从 HTTP 查询参数中解析高级筛选条件，构建安全的 WHERE 子句。
 * 所有后端路由共用此模块，确保筛选器参数完整传递。
 *
 * 参数名与前端 filterParams.ts 的 buildFilterParams 保持一致。
 */

import { z } from 'zod';
import {
  isValidDateFormat,
  escapeSqlString,
  buildDateCondition,
  buildInCondition,
} from './sql-sanitizer.js';
import { AppError } from '../middleware/error.js';

/**
 * 将逗号分隔字符串转为数组（过滤空值）
 */
function csvToArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const arr = value.split(',').map(s => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/**
 * 将字符串转为三态布尔值
 */
function toBoolOrUndefined(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * 通用筛选参数 Zod schema（所有查询路由共用）
 *
 * 注意：Zod 默认会 strip 未知字段，所以路由特有的参数
 * 需要通过 .merge() 或 .extend() 添加。
 */
export const commonFilterSchema = z.object({
  // 日期
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dateField: z.enum(['policy_date', 'insurance_start_date']).optional(),

  // 多选（逗号分隔字符串）
  orgNames: z.string().optional(),
  salesmanNames: z.string().optional(),
  customerCategories: z.string().optional(),
  coverageCombinations: z.string().optional(),
  renewalModes: z.string().optional(),
  tonnageSegments: z.string().optional(),
  insuranceGrades: z.string().optional(),

  // 兼容旧参数名（单值）
  orgLevel3: z.string().optional(),
  orgName: z.string().optional(),
  salesmanName: z.string().optional(),

  // 三态布尔
  isRenewal: z.string().optional(),
  isNewCar: z.string().optional(),
  isTransfer: z.string().optional(),
  isNev: z.string().optional(),
  isTelemarketing: z.string().optional(),
  isCommercialInsure: z.string().optional(),
  isRenewable: z.string().optional(),
  isCrossSell: z.string().optional(),
});

export type CommonFilterParams = z.infer<typeof commonFilterSchema>;

/**
 * 从筛选参数构建安全的 WHERE 条件数组
 *
 * @param params - 通过 commonFilterSchema 解析后的参数
 * @returns SQL 条件数组（不含 WHERE 关键字）
 */
export function buildConditionsFromFilterParams(
  params: CommonFilterParams,
  options: { includeDate?: boolean } = {}
): string[] {
  const conditions: string[] = ['1=1'];
  const dateField = params.dateField || 'policy_date';
  const includeDate = options.includeDate !== false;

  // 日期范围
  if (includeDate) {
    if (params.startDate) {
      if (!isValidDateFormat(params.startDate)) {
        throw new AppError(400, `Invalid startDate format: ${params.startDate}`);
      }
      conditions.push(buildDateCondition(dateField, '>=', params.startDate));
    }
    if (params.endDate) {
      if (!isValidDateFormat(params.endDate)) {
        throw new AppError(400, `Invalid endDate format: ${params.endDate}`);
      }
      conditions.push(buildDateCondition(dateField, '<=', params.endDate));
    }
  }

  // 机构（兼容新旧参数名）
  const orgList = csvToArray(params.orgNames);
  if (orgList) {
    conditions.push(buildInCondition('org_level_3', orgList));
  } else if (params.orgLevel3) {
    conditions.push(`org_level_3 = '${escapeSqlString(params.orgLevel3)}'`);
  } else if (params.orgName) {
    conditions.push(`org_level_3 = '${escapeSqlString(params.orgName)}'`);
  }

  // 业务员
  const salesmanList = csvToArray(params.salesmanNames);
  if (salesmanList) {
    conditions.push(buildInCondition('salesman_name', salesmanList));
  } else if (params.salesmanName) {
    conditions.push(`salesman_name = '${escapeSqlString(params.salesmanName)}'`);
  }

  // 客户类别
  const customerCategories = csvToArray(params.customerCategories);
  if (customerCategories) {
    conditions.push(buildInCondition('customer_category', customerCategories));
  }

  // 险别组合
  const coverageCombinations = csvToArray(params.coverageCombinations);
  if (coverageCombinations) {
    conditions.push(buildInCondition('coverage_combination', coverageCombinations));
  }

  // 续保模式（支持 __NULL__ 标记）
  const renewalModes = csvToArray(params.renewalModes);
  if (renewalModes) {
    const hasNull = renewalModes.includes('__NULL__');
    const nonNull = renewalModes.filter(v => v !== '__NULL__');

    const modeConds: string[] = [];
    if (nonNull.length > 0) {
      modeConds.push(buildInCondition('renewal_mode', nonNull));
    }
    if (hasNull) {
      modeConds.push('renewal_mode IS NULL');
    }

    if (modeConds.length === 1) {
      conditions.push(modeConds[0]);
    } else if (modeConds.length > 1) {
      conditions.push(`(${modeConds.join(' OR ')})`);
    }
  }

  // 吨位分段
  const tonnageSegments = csvToArray(params.tonnageSegments);
  if (tonnageSegments) {
    conditions.push(buildInCondition('tonnage_segment', tonnageSegments));
  }

  // 新增评分字段
  const insuranceGrades = csvToArray(params.insuranceGrades);
  if (insuranceGrades) {
    conditions.push(buildInCondition('insurance_grade', insuranceGrades));
  }

  // 三态布尔字段
  const booleanFields: Array<{ param: string; sqlField: string; special?: 'commercial' }> = [
    { param: 'isRenewal', sqlField: 'is_renewal' },
    { param: 'isNewCar', sqlField: 'is_new_car' },
    { param: 'isTransfer', sqlField: 'is_transfer' },
    { param: 'isNev', sqlField: 'is_nev' },
    { param: 'isTelemarketing', sqlField: 'is_telemarketing' },
    { param: 'isRenewable', sqlField: 'is_renewable' },
    { param: 'isCrossSell', sqlField: 'is_cross_sell' },
    { param: 'isCommercialInsure', sqlField: 'is_commercial_insure', special: 'commercial' },
  ];

  for (const { param, sqlField, special } of booleanFields) {
    const val = toBoolOrUndefined((params as Record<string, string | undefined>)[param]);
    if (val !== undefined) {
      if (special === 'commercial') {
        // is_commercial_insure 是字符串字段，值为 '套单'
        conditions.push(val ? `${sqlField} = '套单'` : `${sqlField} != '套单'`);
      } else {
        conditions.push(`${sqlField} = ${val}`);
      }
    }
  }

  return conditions;
}

/**
 * 从筛选参数构建完整 WHERE 子句（含权限过滤）
 *
 * @param params - 通过 commonFilterSchema 解析后的参数
 * @param permissionFilter - 权限过滤条件
 * @returns 完整 WHERE 子句字符串
 */
export function buildWhereFromFilterParams(
  params: CommonFilterParams,
  permissionFilter: string = '1=1'
): string {
  const conditions = buildConditionsFromFilterParams(params);
  const userWhere = conditions.join(' AND ');

  if (permissionFilter && permissionFilter !== '1=1') {
    return `${userWhere} AND ${permissionFilter}`;
  }
  return userWhere;
}
export function buildWhereFromFilterParamsWithoutDate(
  params: CommonFilterParams,
  permissionFilter: string = '1=1'
): string {
  const conditions = buildConditionsFromFilterParams(params, { includeDate: false });
  const userWhere = conditions.join(' AND ');

  if (permissionFilter && permissionFilter !== '1=1') {
    return `${userWhere} AND ${permissionFilter}`;
  }
  return userWhere;
}
