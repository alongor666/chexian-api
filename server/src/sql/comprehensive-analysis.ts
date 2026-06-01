/**
 * 综合分析页 SQL 生成器
 * Comprehensive Analysis SQL Generators
 */

import { buildPolicyDedupCTE } from './shared/policy-dedup.js';
import { escapeSqlValue } from '../utils/security.js';
import { getMetricSql } from '../config/metric-registry/index.js';

export type ComprehensiveDimension = 'org' | 'category' | 'business';
export type ComprehensiveGranularity = 'daily' | 'weekly' | 'monthly';

export interface ComprehensiveMetricQueryConfig {
  dimension: ComprehensiveDimension;
  whereClause: string;
  cutoffDate: string;
}

function dimensionField(dimension: ComprehensiveDimension): string {
  switch (dimension) {
    case 'org':
      return 'org_level_3';
    case 'category':
      return 'customer_category';
    case 'business':
    default:
      return 'coverage_combination';
  }
}


function exposureBaseSql(whereClause: string, cutoffDate: string): string {
  // B252：policy_dedup 按 (policy_no, insurance_start_date) 聚合去重，HAVING SUM(premium)>0
  // 防止 LEFT JOIN ClaimsAgg 时因 PolicyFact 原单+批改多行让赔款虚增
  const policyDedup = buildPolicyDedupCTE('policy_dedup', {
    whereClause,
    extraFields: ['org_level_3', 'customer_category', 'coverage_combination'],
  });
  return `
WITH ${policyDedup},
policy_exposure AS (
  SELECT
    p.policy_no,
    p.org_level_3,
    p.customer_category,
    p.coverage_combination,
    p.insurance_start_date,
    p.premium,
    COALESCE(c.reported_claims, 0) AS reported_claims,
    p.fee_amount,
    COALESCE(c.claim_cases, 0) AS claim_cases,
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    -- earned_days +1：含起保当天（与 cost-ratios.ts / sql-builder.ts 口径统一）
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}') + 1,
        0
      ),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
)
  `.trim();
}

/**
 * 按维度聚合综合分析核心指标
 */
export function generateComprehensiveDimensionMetricsQuery(
  config: ComprehensiveMetricQueryConfig
): string {
  const { dimension, whereClause, cutoffDate } = config;
  const dimField = dimensionField(dimension);

  return `
${exposureBaseSql(whereClause, cutoffDate)},
dim_agg AS (
  SELECT
    COALESCE(${dimField}, '未知') AS dim_key,
    CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
    ROUND(SUM(premium), 2) AS signed_premium,
    ROUND(SUM(reported_claims), 2) AS reported_claims,
    -- B305: fee_amount 聚合统一用 COALESCE(fee_amount,0)，与注册表 expense_ratio 等指标依赖口径一致
    ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS fee_amount,
    CAST(SUM(claim_cases) AS INTEGER) AS claim_cases,
    -- B305: 满期保费/费用率/变动成本率/综合费用率均改为引用指标注册表（唯一事实源）
    -- 注册表表达式为聚合级，在 dim_agg 直接计算后由外层 SELECT 透传；
    -- 这些指标自带 COALESCE(fee_amount,0)，对比原硬编码（fee_amount 无 COALESCE）会修正 NULL 值
    ${getMetricSql('earned_premium')},
    ${getMetricSql('expense_ratio')},
    ${getMetricSql('variable_cost_ratio')},
    ${getMetricSql('comprehensive_expense_ratio')},
    -- 满期出险率分子：Σ(claim_cases × policy_term/earned_days)，已按已赚暴露年化（分母用保单件数）
    SUM(
      CAST(claim_cases AS DOUBLE) * CAST(policy_term AS DOUBLE)
      / NULLIF(CAST(earned_days AS DOUBLE), 0)
    ) AS annualized_claim_cases
  FROM policy_exposure
  GROUP BY COALESCE(${dimField}, '未知')
),
totals AS (
  SELECT
    SUM(signed_premium) AS total_signed_premium,
    SUM(reported_claims) AS total_reported_claims,
    SUM(fee_amount) AS total_fee
  FROM dim_agg
)
SELECT
  '${dimension}' AS dim_type,
  d.dim_key,
  d.policy_count,
  d.signed_premium,
  d.reported_claims,
  d.fee_amount,
  d.claim_cases,
  d.earned_premium,
  CASE
    WHEN d.earned_premium > 0
    THEN ROUND(d.reported_claims * 100.0 / d.earned_premium, 2)
    ELSE NULL
  END AS earned_claim_ratio,
  -- B305: 费用率/变动成本率/综合费用率已在 dim_agg 用注册表表达式算好，直接透传
  d.expense_ratio,
  d.variable_cost_ratio,
  CASE
    WHEN d.claim_cases > 0
    THEN ROUND(d.reported_claims / CAST(d.claim_cases AS DOUBLE), 2)
    ELSE NULL
  END AS avg_claim_amount,
  -- 满期出险率 = SUM(claim_cases × policy_term/earned_days) / COUNT(DISTINCT policy_no)
  -- 对齐注册表 earned_loss_frequency SSOT：分子(annualized_claim_cases)已按已赚暴露年化，
  -- 分母用保单件数。⚠️ 不可再除以已赚暴露(Σearned/365)，否则二次按暴露放大出险率
  -- （PR#461 引入、Codex P1 复核确认的回归，此处已修正）。
  CASE
    WHEN d.policy_count > 0 AND d.annualized_claim_cases IS NOT NULL
    THEN ROUND(d.annualized_claim_cases * 100.0 / CAST(d.policy_count AS DOUBLE), 2)
    ELSE NULL
  END AS claim_frequency,
  d.comprehensive_expense_ratio,
  CASE
    WHEN d.policy_count > 0
    THEN ROUND(d.signed_premium / CAST(d.policy_count AS DOUBLE), 2)
    ELSE NULL
  END AS per_vehicle_premium,
  CASE
    WHEN t.total_signed_premium > 0
    THEN ROUND(d.signed_premium * 100.0 / t.total_signed_premium, 2)
    ELSE 0
  END AS premium_share,
  CASE
    WHEN t.total_reported_claims > 0
    THEN ROUND(d.reported_claims * 100.0 / t.total_reported_claims, 2)
    ELSE 0
  END AS claim_share,
  CASE
    WHEN t.total_fee > 0
    THEN ROUND(d.fee_amount * 100.0 / t.total_fee, 2)
    ELSE 0
  END AS expense_share
FROM dim_agg d
CROSS JOIN totals t
ORDER BY d.signed_premium DESC, d.dim_key ASC
  `.trim();
}

/**
 * 综合汇总指标
 */
export function generateComprehensiveSummaryQuery(
  whereClause: string,
  cutoffDate: string
): string {
  return `
${exposureBaseSql(whereClause, cutoffDate)}
SELECT
  ROUND(SUM(premium), 2) AS signed_premium,
  ROUND(SUM(reported_claims), 2) AS reported_claims,
  -- B305: fee_amount 聚合统一用 COALESCE(fee_amount,0)（与注册表指标依赖口径一致）
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS fee_amount,
  -- B305: 满期保费引用指标注册表 earned_premium
  ${getMetricSql('earned_premium')},
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  CAST(SUM(claim_cases) AS INTEGER) AS claim_cases,
  CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN ROUND(
      SUM(reported_claims) * 100.0
      / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)),
      2
    )
    ELSE NULL
  END AS earned_claim_ratio,
  -- B305: 费用率/变动成本率/综合费用率引用注册表（自带 COALESCE(fee_amount,0)，修正原硬编码缺失）
  ${getMetricSql('expense_ratio')},
  ${getMetricSql('variable_cost_ratio')},
  ${getMetricSql('comprehensive_expense_ratio')},
  CASE
    WHEN COUNT(DISTINCT policy_no) > 0
    THEN ROUND(SUM(premium) / CAST(COUNT(DISTINCT policy_no) AS DOUBLE), 2)
    ELSE NULL
  END AS per_vehicle_premium,
  -- 满期出险率 = SUM(claim_cases × policy_term/earned_days) / COUNT(DISTINCT policy_no)
  -- 对齐注册表 earned_loss_frequency SSOT：分子已按已赚暴露年化，分母用保单件数，
  -- 与 dim 行同口径。⚠️ 不可再除以 Σ(earned_days)/365，否则二次按暴露放大
  -- （PR#461 引入、Codex P1 复核确认的回归，此处已修正）。
  CASE
    WHEN COUNT(DISTINCT policy_no) > 0
    THEN ROUND(
      SUM(
        CAST(claim_cases AS DOUBLE) * CAST(policy_term AS DOUBLE)
        / NULLIF(CAST(earned_days AS DOUBLE), 0)
      ) * 100.0 / CAST(COUNT(DISTINCT policy_no) AS DOUBLE),
      2
    )
    ELSE NULL
  END AS claim_frequency
FROM policy_exposure
  `.trim();
}

/**
 * 赔付趋势（供 loss 模块）
 */
export function generateComprehensiveLossTrendQuery(
  whereClause: string,
  cutoffDate: string,
  granularity: ComprehensiveGranularity
): string {
  const timePeriodExpr = (() => {
    switch (granularity) {
      case 'daily':
        return `STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m-%d')`;
      case 'weekly':
        return `STRFTIME(DATE_TRUNC('week', CAST(insurance_start_date AS DATE)), '%Y-%m-%d')`;
      case 'monthly':
      default:
        return `STRFTIME(DATE_TRUNC('month', CAST(insurance_start_date AS DATE)), '%Y-%m')`;
    }
  })();

  return `
${exposureBaseSql(whereClause, cutoffDate)},
period_agg AS (
  SELECT
    ${timePeriodExpr} AS time_period,
    ROUND(SUM(reported_claims), 2) AS reported_claims,
    -- B305: 满期保费引用指标注册表 earned_premium
    ${getMetricSql('earned_premium')}
  FROM policy_exposure
  GROUP BY ${timePeriodExpr}
),
total_claims AS (
  SELECT SUM(reported_claims) AS total_reported_claims FROM period_agg
)
SELECT
  p.time_period,
  p.reported_claims,
  p.earned_premium,
  CASE
    WHEN p.earned_premium > 0
    THEN ROUND(p.reported_claims * 100.0 / p.earned_premium, 2)
    ELSE NULL
  END AS earned_claim_ratio,
  CASE
    WHEN t.total_reported_claims > 0
    THEN ROUND(p.reported_claims * 100.0 / t.total_reported_claims, 2)
    ELSE 0
  END AS claim_share
FROM period_agg p
CROSS JOIN total_claims t
ORDER BY p.time_period ASC
  `.trim();
}

/**
 * 年计划（按机构）查询
 */
export function generateComprehensivePlanByOrgQuery(
  planYear: number,
  orgNames: string[] = []
): string {
  const orgCondition =
    orgNames.length > 0
      ? `AND org_name IN (${orgNames.map((org) => `'${escapeSqlValue(org)}'`).join(', ')})`
      : '';

  return `
SELECT
  org_name AS dim_key,
  ROUND(SUM(plan_vehicle), 2) AS plan_premium
FROM achievement_cache
WHERE plan_year = ${Number(planYear)}
  ${orgCondition}
GROUP BY org_name
  `.trim();
}
