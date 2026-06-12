/**
 * 成本立方体 SQL 模块（通用可加性立方体 · 第三批次：CubeCostDay）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md §2.2 / §3A.2 ①族
 * BACKLOG：uid=2026-06-11-claude-90a92c
 *
 * /api/query/cost 的四类成本分析（赔付率/费用率/综合费用率/变动成本率）今天的
 * 形态是：B252 保单去重 GROUP BY（260 万行）+ LEFT JOIN ClaimsAgg + 逐保单日期
 * 函数 —— 每次请求全量重做。本立方体把这三步全部移到构建期：
 *
 *   构建期（数据装载后一次）：
 *     B252 去重（GROUP BY policy_no, 起保日 + HAVING SUM(premium)>0）
 *     → LEFT JOIN ClaimsAgg（赔款按去重后保单恰好归属一次，B252 坑封死在构建期）
 *     → 按（起保日 × 维度列）聚合成格子（premium_sum / fee_sum / policy_cnt /
 *       claim_cases_sum / reported_claims_sum）
 *
 *   查询期（任意截止日）：
 *     满期天数/保险期限只依赖起保日（格子键），每格一次日期函数即可对【任意
 *     cutoffDate】精确重算满期保费/满期赔付率 —— 不是快照，是可重算的预聚合。
 *
 * 等值的结构性前提（构建期探针逐次验证，不靠假设）：
 *   每个 policy_no 的全部行共享同一起保日与同一组维度值（批改行通常只改保费/
 *   日期戳，不改机构/类别/险别）。探针发现任何"跨格保单"即整体降级回退原路径
 *   —— 因为那时 WHERE 行级过滤与格子过滤不再可交换，且 COUNT(DISTINCT policy_no)
 *   不再等于格子保单数之和。
 *
 * 不可服务而回退的情形（与趋势/增长同一套安全网）：
 *   - WHERE 含 policy_date（签单日窗）：签单日是"行"属性而非"保单"属性——批改行
 *     签单日晚于原单，行级日期窗会把一张保单切开（保费取窗内净额、赔款仍全额），
 *     该语义只能在行级数据上算，结构性回退
 *   - WHERE 含立方体外列（业务员/车型/燃料/续保方式/评分等）：token 白名单回退
 *   - 构建期探针发现跨格保单：降级回退
 */

import { getMetricSql } from '../../config/metric-registry/index.js';
import {
  DIMENSION_FIELD_MAP,
  buildDimKeyExpr,
  type CostAnalysisConfig,
} from '../cost/shared.js';
import {
  buildWhereTokenAllowlist,
  isWhereServableForColumns,
  type CubeServability,
} from './servability.js';

/** 立方体表名（物化逻辑见 services/duckdb-cube.ts） */
export const COST_CUBE_TABLE = 'CubeCostDay';

/**
 * 成本立方体维度列（不含起保日键）。
 * 与趋势立方体的差异：起保日为【日】粒度（满期重算需要）、含 coverage_combination
 * 与 tonnage_segment（成本分析的分组维度 + 货车快捷筛选）、不含 policy_date
 * （见文件头"不可服务情形"——签单日窗结构性回退）。
 */
export const COST_CUBE_DIMENSIONS = [
  'org_level_3',
  'customer_category',
  'coverage_combination',
  'insurance_type',
  'tonnage_segment',
  'is_renewal',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
] as const;

/** 多分公司行级安全列（PolicyFact 存在时纳入粒度，permissionFilter 条件可下推） */
export const COST_CUBE_OPTIONAL_DIMENSIONS = ['branch_code'] as const;

const COST_WHERE_ALLOWLIST = buildWhereTokenAllowlist([
  ...COST_CUBE_DIMENSIONS,
  ...COST_CUBE_OPTIONAL_DIMENSIONS,
  // 起保日是格子键（日粒度），起保日窗过滤与保单去重可交换（去重组内起保日同质）
  'insurance_start_date',
]);

/** /api/query/cost 旧协议四类分析（与 routes/query/cost.ts 的 switch 一一对应） */
export type CostCubeAnalysisType =
  | 'claimRatio'
  | 'expenseRatio'
  | 'comprehensiveCost'
  | 'variableCost';

export interface CostCubeServabilityArgs {
  whereClause: string;
  dimension: CostAnalysisConfig['dimension'];
}

/** 判定一次成本分析请求能否由立方体精确回答（不含新鲜度/探针状态，那在 services 层） */
export function isCostCubeServable(args: CostCubeServabilityArgs): CubeServability {
  const groupByFields = DIMENSION_FIELD_MAP[args.dimension];
  if (!groupByFields) {
    return { servable: false, reason: `dimension=${args.dimension}（未知维度）` };
  }
  const cubeDims: readonly string[] = COST_CUBE_DIMENSIONS;
  for (const field of groupByFields) {
    if (!cubeDims.includes(field)) {
      return { servable: false, reason: `groupBy=${field}（不在成本立方体粒度）` };
    }
  }
  return isWhereServableForColumns(args.whereClause, COST_WHERE_ALLOWLIST);
}

// ── 构建 SQL ─────────────────────────────────────────────────────────────────

/**
 * 生成立方体构建 SQL。
 * 去重 CTE 与 sql/shared/policy-dedup.ts 的 buildPolicyDedupCTE 同口径
 * （GROUP BY policy_no+起保日 / SUM 净额 / HAVING>0 / 维度 ANY_VALUE /
 * 排除起保日为空），赔款按去重后保单归属一次（B252）。
 * @param hasBranchCode - PolicyFact schema 是否含 branch_code（由物化器探测后传入）
 */
export function buildCostCubeSql(hasBranchCode: boolean): string {
  const dims = [
    ...COST_CUBE_DIMENSIONS,
    ...(hasBranchCode ? COST_CUBE_OPTIONAL_DIMENSIONS : []),
  ];
  return `
    CREATE OR REPLACE TABLE ${COST_CUBE_TABLE} AS
    WITH policy_dedup AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS insurance_start_date,
        SUM(premium) AS premium,
        SUM(COALESCE(fee_amount, 0)) AS fee_amount,
        ${dims.map((d) => `ANY_VALUE(${d}) AS ${d}`).join(',\n        ')}
      FROM PolicyFact
      WHERE insurance_start_date IS NOT NULL
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    )
    SELECT
      d.insurance_start_date,
      ${dims.map((d) => `d.${d}`).join(',\n      ')},
      SUM(d.premium) AS premium_sum,
      SUM(d.fee_amount) AS fee_sum,
      COUNT(*) AS policy_cnt,
      SUM(COALESCE(c.claim_cases, 0)) AS claim_cases_sum,
      SUM(COALESCE(c.reported_claims, 0)) AS reported_claims_sum
    FROM policy_dedup d
    LEFT JOIN ClaimsAgg c ON d.policy_no = c.policy_no
    GROUP BY ALL
  `;
}

/**
 * 跨格保单探针：任一 policy_no 的行在（起保日 或 任一维度列）上取值不唯一即"跨格"。
 * 返回 SQL 的结果列 impure_policies > 0 时立方体必须降级（见文件头等值前提）。
 * NULL 与非 NULL 视为不同取值（COALESCE 哨兵参与 DISTINCT 计数）。
 */
export function buildCostCubeProbeSql(hasBranchCode: boolean): string {
  const dims = [
    ...COST_CUBE_DIMENSIONS,
    ...(hasBranchCode ? COST_CUBE_OPTIONAL_DIMENSIONS : []),
  ];
  return `
    SELECT COUNT(*) AS impure_policies
    FROM (
      SELECT policy_no
      FROM PolicyFact
      WHERE insurance_start_date IS NOT NULL
      GROUP BY policy_no
      HAVING COUNT(DISTINCT CAST(insurance_start_date AS DATE)) > 1
        ${dims.map((d) => `OR COUNT(DISTINCT COALESCE(CAST(${d} AS VARCHAR), '__NULL__')) > 1`).join('\n        ')}
    ) t
  `;
}

// ── 查询 SQL ─────────────────────────────────────────────────────────────────

/**
 * 格子展开 CTE：把立方体格子映射成与 cost-ratios.ts 的 policy_exposure 同名同义的
 * 列集（premium/fee_amount/claim_cases/reported_claims/earned_days/policy_term），
 * 使指标注册表的 ratio-of-sums 表达式可原样内联 —— 每格一次日期函数替代每保单一次。
 *
 * 等值依据：格内所有保单共享同一起保日 → earned_days/policy_term 为格内常量 →
 *   SUM(premium × 满期系数) 在"格子和 × 系数"下逐分逐厘相等。
 */
function buildCellExposureCte(cutoffDate: string, whereClause: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
    throw new Error(`[CostCube] 非法 cutoffDate: ${cutoffDate}（期望 YYYY-MM-DD，路由层应已校验）`);
  }
  return `policy_exposure AS (
  SELECT
    org_level_3,
    customer_category,
    coverage_combination,
    premium_sum AS premium,
    fee_sum AS fee_amount,
    policy_cnt,
    claim_cases_sum AS claim_cases,
    reported_claims_sum AS reported_claims,
    DATEDIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    LEAST(
      GREATEST(
        DATEDIFF('day', insurance_start_date, DATE '${cutoffDate}') + 1,
        0
      ),
      DATEDIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days
  FROM ${COST_CUBE_TABLE}
  WHERE ${whereClause}
)`;
}

/**
 * COUNT(DISTINCT policy_no) 的立方体等价物。
 * 探针保证每张保单恰好落在一个格子 → 组内保单数 = 组内格子保单数之和。
 */
const POLICY_COUNT_EXPR = 'CAST(SUM(policy_cnt) AS INTEGER) AS policy_count';

/**
 * 生成立方体版成本分析查询（输出列与 cost-ratios.ts 对应生成器逐列同名同序）。
 * 调用方必须先通过 isCostCubeServable + 物化层新鲜度判定。
 *
 * 注册表表达式（earned_premium/earned_claim_ratio/expense_ratio/avg_claim_amount/
 * earned_margin_amount/projected_margin_amount）均为"和的比值"，对格子行原样内联
 * 即精确；仅三处保单计数语义需立方体等价替换（policy_count / total_exposure_days /
 * avg_exposure_days / earned_loss_frequency 的 COUNT(DISTINCT policy_no) 分母），
 * 等价性由数据级集成测试 + 生产影子对账双重核验。
 */
export function generateCostCubeQuery(
  analysisType: CostCubeAnalysisType,
  config: CostAnalysisConfig
): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');
  const dimKeyExpression = buildDimKeyExpr(groupByFields);
  const exposureCte = buildCellExposureCte(cutoffDate, whereClause);

  if (analysisType === 'claimRatio') {
    return `
WITH ${exposureCte}
SELECT
  ${dimKeyExpression} AS dim_key,
  ${POLICY_COUNT_EXPR},
  ROUND(SUM(premium), 2) AS total_premium,
  CAST(SUM(claim_cases) AS INTEGER) AS total_claim_cases,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ${getMetricSql('avg_claim_amount')},
  ${getMetricSql('earned_premium')},
  CAST(SUM(earned_days * policy_cnt) AS INTEGER) AS total_exposure_days,
  ROUND(SUM(CAST(earned_days AS DOUBLE) * policy_cnt) / NULLIF(SUM(policy_cnt), 0), 1) AS avg_exposure_days,
  ${getMetricSql('earned_claim_ratio')},
  -- 满期出险率（注册表 earned_loss_frequency v2.1.0 的格子等价形）：
  -- 格内保单共享 earned_days/policy_term → SUM(claim_cases×term/earned) 对格子行
  -- 与对保单行同值；保单数分母改用 SUM(policy_cnt)（去重语义由构建期探针保证）
  CASE
    WHEN SUM(policy_cnt) > 0 AND SUM(earned_days * policy_cnt) > 0
    THEN ROUND(
      SUM(claim_cases * 1.0 * policy_term / NULLIF(earned_days, 0))
      / SUM(policy_cnt) * 100.0,
      2
    )
    ELSE NULL
  END AS earned_loss_frequency
FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
    `.trim();
  }

  if (analysisType === 'expenseRatio') {
    return `
WITH ${exposureCte}
SELECT
  ${dimKeyExpression} AS dim_key,
  ${POLICY_COUNT_EXPR},
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS total_fee,
  ${getMetricSql('expense_ratio')}
FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
    `.trim();
  }

  if (analysisType === 'comprehensiveCost') {
    return `
WITH ${exposureCte}
SELECT
  ${dimKeyExpression} AS dim_key,
  ${POLICY_COUNT_EXPR},
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ROUND(SUM(fee_amount), 2) AS total_fee,
  ${getMetricSql('earned_premium')},
  ${getMetricSql('earned_claim_ratio')},
  ${getMetricSql('expense_ratio')},
  -- 综合费用率 = (赔款 + 费用) / 满期保费 * 100%（与 cost-ratios.ts 逐字一致）
  CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN ROUND((SUM(reported_claims) + SUM(fee_amount)) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2)
    ELSE NULL
  END AS comprehensive_cost_ratio,
  ${getMetricSql('earned_margin_amount')},
  ${getMetricSql('projected_margin_amount')}
FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
    `.trim();
  }

  // variableCost
  return `
WITH ${exposureCte}
SELECT
  ${dimKeyExpression} AS dim_key,
  ${POLICY_COUNT_EXPR},
  ROUND(SUM(premium), 2) AS total_premium,
  ${getMetricSql('earned_premium')},
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ROUND(SUM(fee_amount), 2) AS total_fee,
  ${getMetricSql('earned_claim_ratio')},
  ${getMetricSql('expense_ratio')},
  -- 变动成本率 = 赔付率 + 费用率（与 cost-ratios.ts 逐字一致；fee_amount 已 COALESCE）
  CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(reported_claims) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) +
      SUM(fee_amount) * 100.0 / SUM(premium),
      2
    )
    ELSE NULL
  END AS variable_cost_ratio
FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}
