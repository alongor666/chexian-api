/**
 * 客户类别枚举集中治理（服务端副本）
 *
 * 唯一事实源：数据管理/knowledge/rules/车险数据业务规则字典.md §4
 *
 * 注意：前后端分离构建，服务端不能 import src/shared/，故保留此副本。
 * 修改时请同步更新 src/shared/config/customer-categories.ts。
 */

// ─── 11 个枚举值（与 Parquet 字段 customer_category 一一对应）───

export const CUSTOMER_CATEGORIES = [
  '非营业个人客车',
  '摩托车',
  '非营业货车',
  '非营业企业客车',
  '营业货车',
  '营业出租租赁',
  '特种车',
  '营业公路客运',
  '挂车',
  '非营业机关客车',
  '营业城市公交',
] as const;

/** 客户类别联合类型 */
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

// ─── 分组常量 ───────────────────────────────────────────────────

/** 客车类（非营业客车） */
export const CAR_CATEGORIES = [
  '非营业个人客车',
  '非营业企业客车',
  '非营业机关客车',
] as const satisfies ReadonlyArray<CustomerCategory>;

/** 货车类 */
export const TRUCK_CATEGORIES = [
  '营业货车',
  '非营业货车',
] as const satisfies ReadonlyArray<CustomerCategory>;

/** 营业性车辆（含出租/公路/公交） */
export const COMMERCIAL_CATEGORIES = [
  '营业货车',
  '营业出租租赁',
  '营业公路客运',
  '营业城市公交',
] as const satisfies ReadonlyArray<CustomerCategory>;

/** 支持吨位分段分析的类别（营业货车 + 非营业货车） */
export const TONNAGE_ELIGIBLE_CATEGORIES = [
  '营业货车',
  '非营业货车',
] as const satisfies ReadonlyArray<CustomerCategory>;

// ─── 辅助函数 ────────────────────────────────────────────────────

/** 是否为货车类别（支持吨位分段） */
export function isTruckCategory(cat: string): cat is '营业货车' | '非营业货车' {
  return (TONNAGE_ELIGIBLE_CATEGORIES as ReadonlyArray<string>).includes(cat);
}

/** 是否为客车类别（非营业个人/企业/机关） */
export function isCarCategory(cat: string): cat is (typeof CAR_CATEGORIES)[number] {
  return (CAR_CATEGORIES as ReadonlyArray<string>).includes(cat);
}

/** 是否为营业性车辆 */
export function isCommercialCategory(cat: string): cat is (typeof COMMERCIAL_CATEGORIES)[number] {
  return (COMMERCIAL_CATEGORIES as ReadonlyArray<string>).includes(cat);
}

// ─── 常用单值常量（避免散落的字符串字面量）─────────────────────

/** 最大占比（58.8%）的主力险种 */
export const CAT_NON_COMMERCIAL_PERSONAL = '非营业个人客车' as const satisfies CustomerCategory;
export const CAT_MOTORCYCLE = '摩托车' as const satisfies CustomerCategory;
export const CAT_COMMERCIAL_TRUCK = '营业货车' as const satisfies CustomerCategory;
export const CAT_NON_COMMERCIAL_TRUCK = '非营业货车' as const satisfies CustomerCategory;
export const CAT_NON_COMMERCIAL_ENTERPRISE = '非营业企业客车' as const satisfies CustomerCategory;
export const CAT_NON_COMMERCIAL_AGENCY = '非营业机关客车' as const satisfies CustomerCategory;
export const CAT_RENTAL = '营业出租租赁' as const satisfies CustomerCategory;
export const CAT_SPECIAL = '特种车' as const satisfies CustomerCategory;
export const CAT_HIGHWAY_PASSENGER = '营业公路客运' as const satisfies CustomerCategory;
export const CAT_TRAILER = '挂车' as const satisfies CustomerCategory;
export const CAT_CITY_BUS = '营业城市公交' as const satisfies CustomerCategory;
