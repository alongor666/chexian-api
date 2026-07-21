/**
 * PIVOT 查询生成器
 *
 * 为 /api/query/pivot 提供"维度 × 指标"双维交叉聚合 SQL。
 * 维度白名单在 routes/query/pivot.ts，指标走 metric-registry。
 *
 * 两条生成路径：
 *   - 简单路径（默认）：不用 CTE，直接单层 GROUP BY FROM PolicyFact，保证权限注入路径统一。
 *   - 满期/赔案路径（NEEDS_CLAIMS_JOIN_COLUMNS 命中时启用）：requiredColumns 含
 *     earned_days/policy_term/reported_claims/claim_cases 的指标（如 earned_claim_ratio/
 *     earned_margin_amount/earned_premium/variable_cost_ratio/earned_loss_frequency/
 *     avg_claim_amount）在裸 PolicyFact 单层聚合下无法计算——前两者压根不是 PolicyFact
 *     原始列（只在 kpi.ts 等路由自建的 CTE 里现算），后两者在部分 Parquet 源上是 ETL 兼容
 *     占位列（恒为 0，见 duckdb-materialization.ts「Added N compat columns」），必须改从
 *     ClaimsAgg（policy_no 粒度的赔款/件数唯一权威源）取值。本路径按 policy_no+
 *     insurance_start_date 去重求和保费/费用（防批改副本重复计数，同 kpi.ts B252），
 *     再 LEFT JOIN ClaimsAgg 补齐 reported_claims/claim_cases，现算 earned_days/policy_term
 *     （与 kpi.ts variable_cost_base 同口径）。
 *
 * ⚠️ 已知边界：若维度含 week_number/month_number 等「同一保单可能跨多期出现」的时间类
 *   维度，ClaimsAgg 是保单级（非按期）赔款，会被重复关联到该保单出现的每一期——单期内的
 *   赔付率仍局部自洽，但跨期加总会重复计入赔款。这是政策级 JOIN 与非恒定时间维度组合的
 *   固有局限（kpi.ts 因为不按维度分组从不会遇到），非本次改动引入的新问题；重按维度精确
 *   拆分赔款需要按期归因的赔案口径，超出本次 root-cause 范围，留作后续改进。
 */

import { getMetric, getMetricSql } from '../config/metric-registry/index.js';

export interface PivotDimension {
  /** 列别名（也用作 GROUP BY/ORDER BY 引用） */
  id: string;
  /** 对应 SQL 表达式（已是 PolicyFact 字段或 CASE 包装） */
  sqlExpr: string;
}

export interface GeneratePivotQueryConfig {
  /** 维度数组：1-2 项 */
  dimensions: readonly PivotDimension[];
  /** 指标 id 数组：1-10 项 */
  metricIds: readonly string[];
  /** WHERE 子句（已含 permissionFilter） */
  whereClause: string;
  /** LIMIT 上限 */
  limit: number;
}

/** 触发「满期/赔案路径」的 requiredColumns（PolicyFact 单层裸聚合算不出，须走 ClaimsAgg CTE） */
const NEEDS_CLAIMS_JOIN_COLUMNS = new Set(['earned_days', 'policy_term', 'reported_claims', 'claim_cases']);

function needsClaimsAggCte(metricIds: readonly string[]): boolean {
  return metricIds.some((id) => {
    const metric = getMetric(id);
    return metric ? metric.sql.requiredColumns.some((col) => NEEDS_CLAIMS_JOIN_COLUMNS.has(col)) : false;
  });
}

export function generatePivotQuery(c: GeneratePivotQueryConfig): string {
  if (c.dimensions.length < 1 || c.dimensions.length > 2) {
    throw new Error(`PIVOT: dimensions must be 1-2 items, got ${c.dimensions.length}`);
  }
  if (c.metricIds.length < 1 || c.metricIds.length > 10) {
    throw new Error(`PIVOT: metrics must be 1-10 items, got ${c.metricIds.length}`);
  }

  const dimSelects = c.dimensions.map((d) => `${d.sqlExpr} AS ${d.id}`).join(', ');
  const dimIds = c.dimensions.map((d) => d.id);
  const metricSelects = c.metricIds.map((id) => getMetricSql(id)).join(', ');
  const groupBy = c.dimensions.map((_, i) => String(i + 1)).join(', ');
  // ORDER BY 第一个指标。指标 SQL 形如 `SUM(premium) as total_premium` —
  // 用 metric id 做别名即可，与 metric-registry 约定一致。
  // agent_name 是高基数维度（可超过 MAX_LIMIT）；请求同时带 policy_count 时优先按件数
  // 截断，避免少量保单的极端比率挤占前排，让主要经代稳定可见。其他维度保持既有排序。
  const orderByAlias = dimIds.includes('agent_name') && c.metricIds.includes('policy_count')
    ? 'policy_count'
    : c.metricIds[0];

  if (!needsClaimsAggCte(c.metricIds)) {
    return `SELECT ${dimSelects}, ${metricSelects}
FROM PolicyFact
WHERE ${c.whereClause}
GROUP BY ${groupBy}
ORDER BY ${orderByAlias} DESC
LIMIT ${c.limit}`;
  }

  const dimIdList = dimIds.join(', ');
  const dimIdListPrefixed = dimIds.map((id) => `b.${id}`).join(', ');

  return `WITH base AS (
  SELECT
    policy_no,
    CAST(insurance_start_date AS DATE) AS insurance_start_date,
    CAST(policy_date AS DATE) AS policy_date,
    premium,
    fee_amount,
    ${dimSelects}
  FROM PolicyFact
  WHERE ${c.whereClause}
),
-- 截止日 = 数据内最新签单日（policy_date），非保单起保日；与 kpi.ts latest_context 同口径
latest_context AS (
  SELECT MAX(policy_date) AS latest_policy_date FROM base
),
-- 按 (policy_no, insurance_start_date, 维度) 去重求和，防批改副本致保费/费用重复计数（同 kpi.ts B252）
base_dedup AS (
  SELECT
    policy_no,
    insurance_start_date,
    ${dimIdList},
    SUM(premium) AS premium,
    SUM(COALESCE(fee_amount, 0)) AS fee_amount
  FROM base
  WHERE insurance_start_date IS NOT NULL
  GROUP BY policy_no, insurance_start_date, ${dimIdList}
  HAVING SUM(premium) > 0
),
earned_base AS (
  SELECT
    b.policy_no,
    ${dimIdListPrefixed},
    b.premium,
    COALESCE(ca.reported_claims, 0) AS reported_claims,
    COALESCE(ca.claim_cases, 0) AS claim_cases,
    b.fee_amount,
    DATEDIFF('day', b.insurance_start_date, b.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    -- earned_days +1：含起保当天（与 kpi.ts variable_cost_base 同口径）
    LEAST(
      GREATEST(
        DATEDIFF('day', b.insurance_start_date, lc.latest_policy_date) + 1,
        0
      ),
      DATEDIFF('day', b.insurance_start_date, b.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days
  FROM base_dedup b
  CROSS JOIN latest_context lc
  LEFT JOIN ClaimsAgg ca ON b.policy_no = ca.policy_no
)
SELECT ${dimIdList}, ${metricSelects}
FROM earned_base
GROUP BY ${groupBy}
ORDER BY ${orderByAlias} DESC
LIMIT ${c.limit}`;
}
