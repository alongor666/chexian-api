/**
 * 立方体可服务性判定 — 共享 WHERE token 白名单（通用可加性立方体）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md §2.3
 * 原则：白名单而非黑名单 —— whereClause 由 buildWhereFromFilterParams +
 * permissionMiddleware 受控产出，剥离引号字符串后逐 token 校验，出现任何
 * 立方体粒度外的列（业务员/险别组合/吨位/燃料/车型等）即回退原路径。
 * 未来新增筛选列时默认安全回退，不会静默出错。
 */

/** 立方体公共粒度维度列（CubeTrendDay 的 10 列；growth 复用同一张表） */
export const CUBE_DIMENSIONS = [
  'policy_date',
  'insurance_start_date',
  'org_level_3',
  'customer_category',
  'insurance_type',
  'is_renewal',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
] as const;

/** 多分公司行级安全列（PolicyFact 存在时纳入粒度，permissionFilter 条件可下推） */
export const CUBE_OPTIONAL_DIMENSIONS = ['branch_code'] as const;

/** SQL 关键词白名单（列名之外允许出现的标识符 token） */
const WHERE_TOKEN_KEYWORDS = [
  'and', 'or', 'in', 'not', 'is', 'null', 'like', 'true', 'false',
] as const;

const TREND_WHERE_TOKEN_ALLOWLIST = new Set<string>([
  ...CUBE_DIMENSIONS,
  ...CUBE_OPTIONAL_DIMENSIONS,
  ...WHERE_TOKEN_KEYWORDS,
]);

export interface CubeServability {
  servable: boolean;
  reason?: string;
}

/** 组装某立方体的 WHERE token 白名单（列 + SQL 关键词） */
export function buildWhereTokenAllowlist(columns: readonly string[]): ReadonlySet<string> {
  return new Set<string>([...columns.map((c) => c.toLowerCase()), ...WHERE_TOKEN_KEYWORDS]);
}

/**
 * WHERE 子句是否只引用给定白名单内的标识符（token 级校验，参数化版本）。
 * 各立方体（趋势/成本/…）粒度列不同，传入各自 buildWhereTokenAllowlist 的产物。
 */
export function isWhereServableForColumns(
  whereClause: string,
  allowlist: ReadonlySet<string>
): CubeServability {
  // 1) 剥离单引号字符串字面量（含 '' 转义），避免值内容干扰 token 解析
  const stripped = whereClause.replace(/'(?:[^']|'')*'/g, "''");
  // 2) 提取标识符 token 逐一校验
  const tokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const token of tokens) {
    if (!allowlist.has(token.toLowerCase())) {
      return { servable: false, reason: `WHERE 含立方体外标识符: ${token}` };
    }
  }
  return { servable: true };
}

/** WHERE 子句是否只引用趋势立方体（CubeTrendDay）粒度列 */
export function isWhereServableByCube(whereClause: string): CubeServability {
  return isWhereServableForColumns(whereClause, TREND_WHERE_TOKEN_ALLOWLIST);
}
