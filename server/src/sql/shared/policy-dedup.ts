/**
 * PolicyFact 去重 CTE 生成器
 *
 * 背景：PolicyFact 不以 policy_no 为主键；同一保单因原单/批改/0 元副本会产生 2-3 行。
 * `LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no` 模式会让赔款虚增 N 倍（N=重复行数）。
 *
 * 修复口径（2026-04-24 B252 与 `claims-heatmap` 的 `eligible_policies` 统一）：
 *   GROUP BY policy_no, CAST(insurance_start_date AS DATE)
 *   HAVING SUM(premium) > 0          -- 排除整张保单净额≤0（全退保/负向批改）
 *   SUM(premium) / SUM(fee_amount)   -- 批改净值
 *   ANY_VALUE(x) for 结构字段（批改通常不改）
 *   COALESCE(ANY_VALUE(CASE WHEN premium > 0 THEN x END), ANY_VALUE(x)) for 批改可变字段
 *
 * ── ANY_VALUE 非确定性：已知可接受口径，禁止"确定化"（2026-06-28 全项目审计沉淀）──
 * 同一 (policy_no, 起保日) 组的多行批改副本绝大多数维度字段一致；极少数"脏组"维度
 * 自相矛盾——DuckDB ANY_VALUE 对同组多行无返回行保证，跨次执行可能取不同值。
 * 实证（SC 全量 254 万去重组，duckdb 直查 fact/policy/current）：
 *   14285 组(0.56%)脏，集中于 is_transfer(13165) 与 customer_category(2384)；
 *   org_level_3 / coverage_combination / is_nev 均 0 脏组（is_new_car 仅 26）。
 * 由此产生的整体满期赔付率抖动约 1.9e-5，业务完全无意义（脏组数据本身自相矛盾，
 * 无"正确"维度归属可言）。本模块所有 TS 消费方（cost-ratios / kpi / comprehensive /
 * claims-detail / repair / cube/cost-cube）共享此口径；脏组对它们的影响同量级或更小
 * （多按 org_level_3 / coverage_combination 切分，零脏组）。
 * 🛑 禁止把 ANY_VALUE 改成 MAX / arg_max / ROW_NUMBER 等确定性聚合来"消除抖动"：
 *   实测确定化会把脏组固定到某一 cell，使整体满期赔付率相对 ANY_VALUE 基线漂移约
 *   -0.13pp，违反"零口径漂移"。正确处置 = 保留 ANY_VALUE + 放宽下游确定性测试阈值
 *   （已落地 PR #843：diagnose_lr_projection 的 test_distinct_on_determinism 1e-5→1e-4）。
 *   根因详见 memory `lr-dedup-anyvalue-nondeterministic`。
 *
 * 相关：BACKLOG B252、PR #843（ANY_VALUE 非确定性审计 + 阈值放宽）、
 *       `feedback_policy_join_dedup`、`project_policy_table_duplicates`
 */

/**
 * 批改可能改变值的字段清单：保单原单 → 批改后的 insurance_grade / 定价系数可能变动。
 * 对这类字段优先取"原单"（premium > 0 的那一行）的值；若不可得则退化为任取一值。
 */
const ORIGINAL_PRIORITY_FIELDS = new Set<string>([
  'insurance_grade',
  'commercial_pricing_factor',
]);

/**
 * 生成单个 ANY_VALUE 字段表达式。
 *
 * @param field 字段名（在原表上的物理列名）
 * @param alias 输出别名（默认等于字段名）
 */
export function dedupFieldSql(field: string, alias?: string): string {
  const outName = alias ?? field;
  if (ORIGINAL_PRIORITY_FIELDS.has(field)) {
    return `COALESCE(ANY_VALUE(CASE WHEN premium > 0 THEN ${field} END), ANY_VALUE(${field})) AS ${outName}`;
  }
  return `ANY_VALUE(${field}) AS ${outName}`;
}

export interface PolicyDedupOptions {
  /** 主 WHERE 条件（默认 '1=1'，会拼接到 policy_dedup CTE 的 WHERE 子句） */
  whereClause?: string;
  /** 需要从源表带出的结构字段（premium/fee_amount/insurance_start_date 已默认包含，无需再传） */
  extraFields?: string[];
  /** 源表或 CTE 名（默认 PolicyFact） */
  sourceTable?: string;
  /** 是否附加 `insurance_start_date IS NOT NULL` 过滤，默认 true（大部分分析口径需要） */
  requireStartDate?: boolean;
}

/**
 * 构建 PolicyFact 去重 CTE 的 body（不含 WITH 关键字）。
 *
 * 调用方示例：
 *   `WITH ${buildPolicyDedupCTE('policy_dedup', { whereClause, extraFields: ['org_level_3'] })}, ...`
 */
export function buildPolicyDedupCTE(
  cteName: string,
  options: PolicyDedupOptions = {}
): string {
  const {
    whereClause = '1=1',
    extraFields = [],
    sourceTable = 'PolicyFact',
    requireStartDate = true,
  } = options;

  const extraFieldLines = extraFields.map((field) => `    ${dedupFieldSql(field)}`);
  const whereFull = requireStartDate
    ? `${whereClause}\n    AND insurance_start_date IS NOT NULL`
    : whereClause;
  const headCols = [
    'policy_no',
    'CAST(insurance_start_date AS DATE) AS insurance_start_date',
    'SUM(premium) AS premium',
    'SUM(COALESCE(fee_amount, 0)) AS fee_amount',
  ];
  const allCols = extraFieldLines.length > 0
    ? `${headCols.map((c) => `    ${c}`).join(',\n')},\n${extraFieldLines.join(',\n')}`
    : headCols.map((c) => `    ${c}`).join(',\n');

  return `${cteName} AS (
  SELECT
${allCols}
  FROM ${sourceTable}
  WHERE ${whereFull}
  GROUP BY policy_no, CAST(insurance_start_date AS DATE)
  HAVING SUM(premium) > 0
)`;
}
