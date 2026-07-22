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
import { createLogger } from './logger.js';
import { buildNormalizedAgentNameInCondition } from './agent-name.js';

const log = createLogger('filter-params');

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
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  // 非法布尔值（如 '1' / 'True' / 拼写错误）此前静默降级为"不过滤"，会把全量数据
  // 当作已筛选结果返回，形成难以定位的静默错误。这里不 fail-fast 抛 400（避免历史
  // 松散传值的前端在线上突然 400），但必须留痕，便于排查"筛选未生效"类问题。
  log.warn(`布尔筛选参数收到非法值 "${value}"，已按"不过滤"处理（期望 'true' 或 'false'）`);
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
  agentNames: z.string().optional(),
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

  // 车型快捷筛选（互斥单选）
  vehicleQuickFilter: z.enum(['home_car', 'truck_1t', 'truck_2_9t', 'motorcycle', 'truck_1_2t', 'rental', 'dump', 'tractor', 'general']).optional(),
  // 企客（非营业企业客车，可与家自车同时选）
  enterpriseCar: z.string().optional(),
  // 营业/非营业性质
  businessNature: z.enum(['commercial', 'non_commercial']).optional(),
  // 燃料分类（油/气/电）
  fuelCategory: z.enum(['oil', 'gas', 'electric']).optional(),
  // 险类（交强/商业）
  insuranceType: z.string().optional(),

  // 全国超管「切省 / 全国合并」权限选择器（非数据筛选）。
  //   值 = 省份码（^[A-Z]{2}$，如 SC/SX）或 'ALL'（合并）。省份枚举数据驱动，禁硬编码 → 用 regex 不用 enum。
  //   授权在 permissionMiddleware 按服务端 token 的 visibleBranches 白名单校验（普通用户传参一律忽略），
  //   本处仅作输入形态校验 + 让 route-catalog 参数契约识别为合法全局参数（codex 闸-1 P1-4）。
  //   buildWhereFromFilterParams 不消费本字段（它不是 WHERE 维度），故不影响任何 SQL 筛选口径。
  targetBranch: z.string().regex(/^(ALL|[A-Z]{2})$/).optional(),
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

  // 经代：与 PIVOT agent_name 维度使用同一规范化表达式，只做完整名称精确匹配。
  // 不接受短名/LIKE 归并，避免“中国邮政储蓄银行”被并入“邮政”。
  const agentList = csvToArray(params.agentNames);
  if (agentList) {
    conditions.push(buildNormalizedAgentNameInCondition(agentList));
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

  // 险类筛选（交强/商业）
  if (params.insuranceType === 'true') {
    conditions.push("insurance_type = '交强险'");
  } else if (params.insuranceType === 'false') {
    conditions.push("insurance_type = '商业保险'");
  }

  // 燃料分类（油/气/电）
  if (params.fuelCategory) {
    switch (params.fuelCategory) {
      case 'electric':
        conditions.push('is_nev = true');
        break;
      case 'gas':
        conditions.push("is_nev = false AND fuel_type LIKE '天然气%'");
        break;
      case 'oil':
        conditions.push("is_nev = false AND (fuel_type IS NULL OR fuel_type NOT LIKE '天然气%')");
        break;
    }
  }

  // 车型快捷筛选（home_car 含企客联动需特殊处理，其他 case 走共享 helper）
  if (params.vehicleQuickFilter === 'home_car' && params.enterpriseCar === 'true') {
    // 家自车 + 企客同时选中
    conditions.push("customer_category IN ('非营业个人客车', '非营业企业客车')");
  } else if (params.vehicleQuickFilter) {
    pushVehicleQuickFilterConditions(conditions, params.vehicleQuickFilter);
  }

  // 企客单独选中（无 vehicleQuickFilter 时）
  if (params.enterpriseCar === 'true' && !params.vehicleQuickFilter) {
    conditions.push("customer_category = '非营业企业客车'");
  }

  // 营业/非营业性质
  if (params.businessNature) {
    if (params.businessNature === 'commercial') {
      conditions.push("customer_category LIKE '营业%'");
    } else {
      conditions.push("customer_category LIKE '非营业%'");
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

export const VEHICLE_QUICK_FILTER_VALUES = [
  'home_car',
  'truck_1t',
  'truck_2_9t',
  'motorcycle',
  'truck_1_2t',
  'rental',
  'dump',
  'tractor',
  'general',
] as const;

export type VehicleQuickFilterValue = (typeof VEHICLE_QUICK_FILTER_VALUES)[number];

/**
 * 共享：把 vehicleQuickFilter 翻译成 SQL 条件 push 进 conditions。
 *
 * 唯一事实源 — claims-detail / claims-heatmap / commonFilterSchema 都调用此 helper。
 * 9 个 case 集中在此处维护，避免漂移（参考 BACKLOG: claims-heatmap 漂移 bug）。
 *
 * 注意：home_car + enterpriseCar=true 的联动逻辑保留在 buildConditionsFromFilterParams 中处理，
 * 该 helper 只负责单独 home_car 的"非营业个人客车"语义。
 */
export function pushVehicleQuickFilterConditions(
  conditions: string[],
  value: string,
  prefix: string = ''
): void {
  switch (value) {
    case 'home_car':
      conditions.push(`${prefix}customer_category = '非营业个人客车'`);
      break;
    case 'truck_1t':
      conditions.push(`${prefix}customer_category IN ('营业货车', '非营业货车')`);
      conditions.push(`${prefix}tonnage_segment = '1吨以下'`);
      break;
    case 'truck_2_9t':
      conditions.push(`${prefix}customer_category IN ('营业货车', '非营业货车')`);
      conditions.push(`${prefix}tonnage_segment = '2-9吨'`);
      break;
    case 'motorcycle':
      conditions.push(`${prefix}customer_category = '摩托车'`);
      break;
    case 'truck_1_2t':
      conditions.push(`${prefix}customer_category IN ('营业货车', '非营业货车')`);
      conditions.push(`${prefix}tonnage_segment = '1-2吨'`);
      break;
    case 'rental':
      conditions.push(`${prefix}customer_category = '营业出租租赁'`);
      break;
    case 'dump':
      conditions.push(`${prefix}customer_category = '营业货车'`);
      conditions.push(`${prefix}tonnage_segment = '10吨以上'`);
      conditions.push(`${prefix}vehicle_model LIKE '%自卸%'`);
      break;
    case 'tractor':
      conditions.push(`${prefix}customer_category = '营业货车'`);
      conditions.push(`${prefix}tonnage_segment = '10吨以上'`);
      conditions.push(`${prefix}vehicle_model LIKE '%牵引%'`);
      break;
    case 'general':
      conditions.push(`${prefix}customer_category = '营业货车'`);
      conditions.push(`${prefix}tonnage_segment = '10吨以上'`);
      conditions.push(`${prefix}vehicle_model NOT LIKE '%自卸%'`);
      conditions.push(`${prefix}vehicle_model NOT LIKE '%牵引%'`);
      break;
  }
}
