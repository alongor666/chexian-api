/**
 * where-matrix.mjs — 边界 WHERE 词元矩阵生成器
 *
 * 生成与 commonFilterSchema 兼容的 filter 对象数组，
 * 覆盖三层笛卡尔组合：basic / org / cross。
 *
 * 纯函数，无 IO 副作用。
 */

// ─── 枚举源（与 customer-categories.ts 同步）───────────────────

/** 11 个客户类别（唯一事实源见 server/src/config/customer-categories.ts）*/
const CUSTOMER_CATEGORIES = [
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
];

/** 三态布尔值（true / false / undefined=全选）*/
const BOOL_STATES = [true, false, undefined];

/** 代表性机构（不需读 Parquet，hardcode 已知三个）*/
const ORG_SAMPLES = ['成都市分公司', '天府分公司', '高新分公司'];

/** 燃料分类（来自 fuelCategory enum）*/
const FUEL_CATEGORIES = ['oil', 'gas', 'electric'];

/** 吨位分段（tonnageSegments 多选，每次单独传一个边界值）*/
const TONNAGE_SAMPLES = ['1吨以下', '1-2吨', '2-9吨', '10吨以上'];

// ─── Tier 常量 ──────────────────────────────────────────────────

export const TIER_BASIC = 'basic';
export const TIER_ORG   = 'org';
export const TIER_CROSS = 'cross';

// ─── 核心函数 ────────────────────────────────────────────────────

/**
 * 生成基础 basic 层矩阵：
 * 11 customer_category × 3 is_nev × 3 is_renewal = 99 个 filter 对象
 *
 * 每个 filter 对象形状：
 *   { customerCategories: string, isNev?: 'true'|'false', isRenewal?: 'true'|'false' }
 *
 * 字段名与 commonFilterSchema 的 query-string key 一致（驼峰）。
 * 布尔值用字符串形式，与 HTTP GET 参数一致。
 */
function buildBasicMatrix() {
  const result = [];
  for (const cat of CUSTOMER_CATEGORIES) {
    for (const nev of BOOL_STATES) {
      for (const renewal of BOOL_STATES) {
        const filter = { customerCategories: cat };
        if (nev !== undefined) filter.isNev = String(nev);
        if (renewal !== undefined) filter.isRenewal = String(renewal);
        result.push(filter);
      }
    }
  }
  return result;
}

/**
 * 生成 org 层矩阵：basic × 3 个代表性机构 = 297 个
 */
function buildOrgMatrix() {
  const basic = buildBasicMatrix();
  const result = [];
  for (const org of ORG_SAMPLES) {
    for (const filter of basic) {
      result.push({ ...filter, orgNames: org });
    }
  }
  return result;
}

/**
 * 生成 cross 层矩阵：org × 3 fuel × 4 tonnage = 297 × 3 × 4 = 3564 个
 *
 * tonnageSegments 仅在非 electric fuelCategory 下传入（electric 驱动的车大多无吨位分段，
 * 但 burn-in 目的是边界覆盖，不做业务排除）。
 */
function buildCrossMatrix() {
  const org = buildOrgMatrix();
  const result = [];
  for (const fuel of FUEL_CATEGORIES) {
    for (const ton of TONNAGE_SAMPLES) {
      for (const filter of org) {
        result.push({ ...filter, fuelCategory: fuel, tonnageSegments: ton });
      }
    }
  }
  return result;
}

/**
 * 根据 tier 返回 filter 对象数组。
 *
 * @param {string} tier - 'basic' | 'org' | 'cross'
 * @returns {Array<Record<string, string>>} filter 对象数组
 */
export function buildWhereMatrix(tier) {
  switch (tier) {
    case TIER_BASIC: return buildBasicMatrix();
    case TIER_ORG:   return buildOrgMatrix();
    case TIER_CROSS: return buildCrossMatrix();
    default:
      throw new Error(`未知 tier：${tier}（合法值：basic | org | cross）`);
  }
}
