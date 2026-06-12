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

const WHERE_TOKEN_ALLOWLIST = new Set<string>([
  ...CUBE_DIMENSIONS,
  ...CUBE_OPTIONAL_DIMENSIONS,
  'and', 'or', 'in', 'not', 'is', 'null', 'like', 'true', 'false',
]);

export interface CubeServability {
  servable: boolean;
  reason?: string;
}

/** WHERE 子句是否只引用立方体粒度列（token 级白名单校验） */
export function isWhereServableByCube(whereClause: string): CubeServability {
  // 1) 剥离单引号字符串字面量（含 '' 转义），避免值内容干扰 token 解析
  const stripped = whereClause.replace(/'(?:[^']|'')*'/g, "''");
  // 2) 提取标识符 token 逐一校验
  const tokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const token of tokens) {
    if (!WHERE_TOKEN_ALLOWLIST.has(token.toLowerCase())) {
      return { servable: false, reason: `WHERE 含立方体外标识符: ${token}` };
    }
  }
  return { servable: true };
}
