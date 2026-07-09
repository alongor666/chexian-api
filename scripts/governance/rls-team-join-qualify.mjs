/**
 * 分省 RLS × 团队维度 JOIN SalesmanTeamMapping 裸 branch_code 消歧闸
 * （2026-07-09 生产 Binder Error 防回归 · PR #997「qualifyBranchCodeColumn」follow-up）
 *
 * ## 背景（复盘见 memory rls-branch-code-ambiguous-team-join）
 *
 * `permissionMiddleware`（server/src/middleware/permission.ts）为多分公司请求生成
 * `req.permissionFilter`，省份 RLS 用**裸列名**拼接：`branch_code = 'SX'` / `branch_code IN (...)`。
 * 该字符串经 `parseFiltersAndBuildBothWhere` 落到 baseWhereClause / whereWithoutDate，再被手写
 * SQL 生成器注入到形如下面的主查询 WHERE：
 *
 * ```sql
 * FROM PolicyFact p
 * LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name   -- 仅团队维度下钻才 JOIN
 * WHERE ... AND branch_code = 'SX'                                     -- ← 裸 branch_code
 * ```
 *
 * 多分公司下 `SalesmanTeamMapping` **也带 branch_code 列**，裸 `branch_code` 同时匹配
 * `p.branch_code` 与 `tm.branch_code` → DuckDB `Binder Error: Ambiguous reference to column
 * name "branch_code"`。修复 = server/src/utils/branch-rls-qualify.ts:qualifyBranchCodeColumn，
 * 把比较位置的裸 branch_code 绑定到事实表别名（p./c.，隔离键作用在保单行、非 tm）。
 *
 * ## 本闸拦什么（纯静态扫描 server/src/sql/**，不依赖 parquet，永远跑）
 *
 * 任一 SQL 文件若 `JOIN SalesmanTeamMapping <别名>`（**实体表**；`team_mapping` 等 CTE 别名
 * 不算，marketing-report 用 CTE 剥列本就安全），则该文件必须让 permissionFilter 走过
 * qualifyBranchCodeColumn 消歧，否则报红：
 *
 *   违规 A（覆盖缺失）：文件 JOIN 实体表但**全文从不调用** qualifyBranchCodeColumn
 *     → 新增团队维度生成器忘记消歧 / 整体回退到裸 where。
 *   违规 B（裸参数注入）：某条 tm-join 查询「JOIN 之后最近的一处 WHERE ${...}」直接内插
 *     **裸 permissionFilter 参数**（whereWithoutDate / baseWhereClause）而非消歧后的变量
 *     （pfWhere / 构造期已消歧的 fullWhere 等）→ 单行回退 `WHERE ${pfWhere}` → `WHERE ${whereWithoutDate}`。
 *
 * 违规 A 覆盖整体/新增缺口，违规 B 覆盖单行回退（即便 qualify 调用还挂着未删）。两者并存。
 *
 * ## 为什么按「JOIN 后最近一处 WHERE」判 B（避免误报）
 *
 * cross-sell-heatmap.ts 的 usePF 分支 `JOIN SalesmanTeamMapping tm ... WHERE ${pfWhere}`（安全），
 * 另一 Agg 分支 `FROM CrossSellDailyAgg WHERE ${baseWhereClause}`（**无 tm JOIN，裸列不歧义**，安全）。
 * 二者是互斥模板串。若按「文件含 JOIN 且文件含裸 WHERE」判定会误伤——故 B 只看每个 JOIN 字面量
 * 之后、下一个 JOIN 之前区间内的第一处 WHERE ${var}，精确归属该 FROM…JOIN 的治理 WHERE。
 * cross-sell.ts 走「构造期消歧」（fullWhere = join(qualifyBranchCodeColumn(baseWhereClause, 'c.'))），
 * 其 `WHERE ${fullWhere}` 的 fullWhere 非裸参数集成员 → 不误报。
 *
 * ## 逃生阀（合法例外，须带引用）
 *
 * 确有正当理由（如 claims-heatmap 走 eligible_policies CTE，cutoffScope 已隔离 branch_code 且
 * tm-join 作用在不投影 branch_code 的物化 CTE 上，无歧义），在文件任意处写：
 *   `// governance-allow: rls-team-join <B### | #PR | YYYY-MM-DD-uid> <一句理由>`
 * marker 须同时带关键字与一个 backlog-uid / PR 引用，否则视为无效（防裸 marker 留后门，
 * 仿 checkWecomEngineBranchIsolation / checkArchLayerBoundaries）。
 *
 * ## 诚实边界
 *
 * 静态启发式，非证明：只保证「JOIN 实体表 → 必消歧 permissionFilter 或显式豁免」这条覆盖，
 * 与 RLS 路由消费覆盖闸（#RLS路由消费覆盖）同源哲学。运行时真消歧由 branch-rls-injection 单测 +
 * DuckDB oracle 承担（server/src/sql/__tests__/branch-rls-injection.test.ts）。
 *
 * 从 check-governance.mjs 单体抽出（H5 行数棘轮：新增检查一律独立模块），依赖以 { rootDir, io } 注入。
 */

import fs from 'fs';
import path from 'path';

// JOIN 实体表 SalesmanTeamMapping <别名>（team_mapping 等 CTE 别名不匹配 → 天然排除 CTE 剥列方案）
const ENTITY_JOIN_RE = /\bJOIN\s+SalesmanTeamMapping\s+[A-Za-z_]\w*/gi;
// 消歧工具（安全信号）
const QUALIFY_TOKEN = 'qualifyBranchCodeColumn';
// JOIN 之后区间内第一处 WHERE ${某变量}（该 FROM…JOIN 的治理 WHERE）
const FIRST_WHERE_INTERP_RE = /WHERE\s*\$\{\s*(\w+)\s*\}/;
// 裸 permissionFilter 参数名（parseFiltersAndBuildBothWhere 产出的未消歧 where，裸 branch_code 载体）。
// 刻意不含 fullWhere/pfWhere/cfWhere 等——这些是本仓「构造期或改名后已消歧」的变量。
const RAW_WHERE_PARAMS = new Set(['whereWithoutDate', 'baseWhereClause']);
// 逃生阀：文件级 governance-allow（关键字 + backlog-uid/PR 引用）
const ALLOW_RE = /governance-allow:\s*rls-team-join\s+(?:B\d+|#\d+|PR\s*#?\d+|\d{4}-\d{2}-\d{2}[\w-]*)/i;

/** 把注释内容抹成等长空白（保留 \n 与偏移量 → 行号不漂），防注释散文里的
 *  `JOIN SalesmanTeamMapping tm` / `WHERE ${...}` 骗过检测。诚实边界：字符串字面量内的
 *  `//`（如 URL）会被误当行注释截断——本仓 SQL 模板串用 `--` 注释、不含 `//`，故安全。 */
function blankComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank) // 块注释
    .replace(/\/\/[^\n]*/g, blank);      // 行注释
}

/** 递归列出 server/src/sql 下 .ts（排除 __tests__） */
function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : listSqlFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

/**
 * 纯扫描（无 IO，可单测）：给单个 SQL 源文本，返回违规描述数组（空 = 干净）。
 * relLabel 仅用于拼进违规信息里的定位前缀（如 server/src/sql/foo.ts）。
 */
export function scanRlsTeamJoinSource(relLabel, rawSource) {
  // 逃生阀在原文判（marker 本身是注释，抹注释前判否则消失）
  if (ALLOW_RE.test(rawSource)) return [];

  const code = blankComments(rawSource);
  const joins = [...code.matchAll(ENTITY_JOIN_RE)];
  if (joins.length === 0) return []; // 不 JOIN 实体表 → 无歧义向量

  const violations = [];

  // 违规 A：JOIN 实体表但全文从不消歧（整体回退 / 新增生成器忘消歧）
  if (!code.includes(QUALIFY_TOKEN)) {
    const line = code.slice(0, joins[0].index).split('\n').length;
    violations.push(
      `${relLabel}:${line}: JOIN SalesmanTeamMapping 实体表但全文从未调用 ${QUALIFY_TOKEN}` +
      `（多省时 tm 同带 branch_code → permissionFilter 裸 branch_code 二义 → DuckDB Binder Error）`,
    );
    return violations; // A 命中即够，不重复报 B
  }

  // 违规 B：某 tm-join 查询「JOIN 后最近一处 WHERE ${var}」直接内插裸 permissionFilter 参数
  for (let i = 0; i < joins.length; i += 1) {
    const start = joins[i].index + joins[i][0].length;
    const end = i + 1 < joins.length ? joins[i + 1].index : code.length; // 只归属本 JOIN 区间
    const region = code.slice(start, end);
    const wm = region.match(FIRST_WHERE_INTERP_RE);
    if (wm && RAW_WHERE_PARAMS.has(wm[1])) {
      const line = code.slice(0, joins[i].index).split('\n').length;
      violations.push(
        `${relLabel}:${line}: tm-join 查询 WHERE 直接内插裸 \${${wm[1]}}（未经 ${QUALIFY_TOKEN} 消歧）` +
        `— 应绑定事实表别名后再注入（如 const pfWhere = ${QUALIFY_TOKEN}(${wm[1]}, 'p.')）`,
      );
    }
  }
  return violations;
}

export function checkRlsTeamJoinQualify({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查分省 RLS × 团队维度 JOIN SalesmanTeamMapping 裸 branch_code 消歧（2026-07-09 Binder Error 防回归）...');

  const sqlDir = path.join(rootDir, 'server/src/sql');
  const violations = [];

  for (const file of listSqlFiles(sqlDir).sort()) {
    const rel = path.relative(rootDir, file);
    const raw = fs.readFileSync(file, 'utf-8');
    violations.push(...scanRlsTeamJoinSource(rel, raw));
  }

  if (violations.length > 0) {
    error(`分省 RLS × 团队维度 JOIN 消歧缺口 ${violations.length} 处（裸 branch_code × tm.branch_code → 团队维度下钻 Binder Error）：`);
    for (const v of violations) console.log(`    - ${v}`);
    console.log(`    修复：JOIN SalesmanTeamMapping 的查询，其 permissionFilter where 先过 ${QUALIFY_TOKEN}(where, 事实表别名)`);
    console.log('           （事实表 = PolicyFact p. / CrossSellDailyAgg c.；隔离键作用在保单行、非 tm），再注入 WHERE ${消歧后变量}');
    console.log('    依据：server/src/utils/branch-rls-qualify.ts · memory rls-branch-code-ambiguous-team-join · PR #997');
    console.log('    逃生阀：// governance-allow: rls-team-join <B### | #PR | YYYY-MM-DD-uid> <理由>（如 claims-heatmap 走 eligible_policies CTE 不投影 branch_code）');
    return false;
  }
  success('分省 RLS × 团队维度 JOIN 消歧检查通过（所有 JOIN SalesmanTeamMapping 实体表的生成器均经 qualifyBranchCodeColumn 消歧或显式豁免）');
  return true;
}
