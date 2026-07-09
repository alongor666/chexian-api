/**
 * 分省 RLS 隔离键 branch_code 消歧工具
 *
 * ## 背景（2026-07-09 生产 Binder Error）
 *
 * `permissionMiddleware`（middleware/permission.ts）为多分公司（multiProvince）请求生成
 * `req.permissionFilter`，其中省份 RLS 用**裸列名**拼接：`branch_code = 'SX'` /
 * `branch_code IN ('SC', 'SX')`。该字符串经 `buildWhereFromFilterParams` 拼进 baseWhereClause /
 * whereWithoutDate，再被手写 SQL 生成器注入形如下面的主查询 WHERE：
 *
 * ```sql
 * FROM PolicyFact p
 * LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
 * WHERE ... AND branch_code = 'SX'   -- ← 裸 branch_code
 * ```
 *
 * 多分公司下 `SalesmanTeamMapping` **也带 branch_code 列**（duckdb-domain-loaders.ts），于是
 * 裸 `branch_code` 同时匹配 `p.branch_code` 与 `tm.branch_code`，DuckDB 抛：
 *   `Binder Error: Ambiguous reference to column name "branch_code"`。
 * 该 tm JOIN 仅在**按团队维度下钻**（needsTeamJoin）时生效，故 bug 仅在团队维度触发。
 *
 * ## 隔离键语义（.claude/rules/data-pipeline.md「省份数据隔离」）
 *
 * 分省 RLS 必须作用在 **policy 行**——省份归属是保单事实，不是团队映射的属性。故 branch_code
 * 应绑定到事实表别名（PolicyFact `p.` / CrossSellDailyAgg `c.`），**不是** SalesmanTeamMapping（`tm.`）。
 *
 * ## 为什么只消歧 branch_code
 *
 * SalesmanTeamMapping 的列为 business_no / salesman_name / full_name / team_name / organization
 * (+ 多省时 branch_code)。permissionFilter 另外两类列 `org_level_3`、`is_telemarketing` 只存在于
 * PolicyFact（tm 用的是 `organization` 而非 `org_level_3`），JOIN tm 后不歧义——**唯 branch_code 冲突**。
 * 因此外科式只把 branch_code 绑定到事实表，其余裸列自然解析到唯一持有它的事实表，无需改动。
 */

/**
 * 把 WHERE 子句片段中的裸 branch_code（来自 permissionFilter 的省份 RLS）限定到指定事实表别名，
 * 消除与 JOIN SalesmanTeamMapping 时的 DuckDB Ambiguous reference。
 *
 * 行为：
 * - 仅替换**比较位置**（`branch_code = ...` / `branch_code IN (...)` / `branch_code LIKE ...`）的裸列名。
 * - 已带前缀（`p.` / `tm.` / `m.` / `c.` …）的不动 → **幂等**，重复调用安全。
 * - 字符串字面量内的 `'...branch_code...'`、以及 `xbranch_code` / `branch_code_x` 等子串不动。
 * - `tableAlias` 为空串时**原样返回**（无 JOIN 场景：裸列不歧义，保持逐字节等价 = 字节安全）。
 *
 * @param whereClause - WHERE 片段（可能含 permissionFilter 的裸 branch_code）
 * @param tableAlias  - 事实表别名前缀，**含点**，如 `'p.'` / `'c.'`；`''` 表示不限定
 * @returns 消歧后的 WHERE 片段
 */
export function qualifyBranchCodeColumn(whereClause: string, tableAlias: string): string {
  if (!tableAlias) return whereClause;
  // (?<![\w.'"])  前面不是标识符字符/点/引号 → 排除 p.branch_code 与字符串字面量内命中
  // \b            后界 → 排除 branch_code_xxx
  // (?=\s*(?:=|IN\b|LIKE\b))  仅限比较位置（列引用），进一步排除误伤
  return whereClause.replace(
    /(?<![\w.'"])branch_code\b(?=\s*(?:=|IN\b|LIKE\b))/gi,
    `${tableAlias}branch_code`,
  );
}
