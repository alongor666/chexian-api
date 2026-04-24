/**
 * 核心成本率 SQL 生成器
 *
 * 4 种成本率口径：
 * - 赔付率（满期赔付率 + 满期出险率 + 案均赔款）
 * - 费用率
 * - 综合费用率
 * - 变动成本率
 */

import { getMetricSql } from '../../config/metric-registry/index.js';
import { buildPolicyDedupCTE } from '../shared/policy-dedup.js';
import {
  type CostAnalysisConfig,
  type CostDimension,
  DIMENSION_FIELD_MAP,
  buildDimKeyExpr,
} from './shared.js';

// ==================== 赔付率 ====================

/**
 * 生成赔付率分析SQL
 *
 * 计算指标：
 * - 保单件数 = COUNT(DISTINCT policy_no)
 * - 赔案件数 = SUM(claim_cases)
 * - 案均赔款 = 已报告赔款 / 赔案件数
 * - 满期保费 = SUM(保费 / policy_term * 满期天数)
 * - 满期赔付率 = 已报告赔款 / 满期保费
 * - 满期出险率 = (赔案件数 * 365) / 满期天数合计 (年化)
 */
export function generateClaimRatioQuery(config: CostAnalysisConfig): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');
  const dimKeyExpression = buildDimKeyExpr(groupByFields);
  // B252：policy_dedup 按 (policy_no, insurance_start_date) 聚合去重，HAVING SUM(premium)>0
  const policyDedup = buildPolicyDedupCTE('policy_dedup', {
    whereClause,
    extraFields: groupByFields,
  });

  return `
WITH ${policyDedup},
policy_exposure AS (
  SELECT
    p.policy_no,
    ${groupByFields.map((f) => `p.${f}`).join(', ')},
    p.premium,
    p.insurance_start_date AS start_date,
    -- 保险期限天数（闰年感知：365或366）
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    -- 满期天数：MIN(统计截止日 - 保险起期, policy_term)，最小为0
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}'),
        0
      ),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days,
    COALESCE(c.claim_cases, 0) AS claim_cases,
    COALESCE(c.reported_claims, 0) AS reported_claims
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
)
SELECT
  ${dimKeyExpression} AS dim_key,
  -- 基础指标（显式转换BigInt为DOUBLE避免JS类型混合错误）
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  CAST(SUM(claim_cases) AS INTEGER) AS total_claim_cases,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,

  -- 案均赔款 = 已报告赔款 / 赔案件数
  ${getMetricSql('avg_claim_amount')},

  -- 满期保费（闰年感知）
  ${getMetricSql('earned_premium')},

  -- 满期天数合计
  CAST(SUM(earned_days) AS INTEGER) AS total_exposure_days,

  -- 平均满期天数
  ROUND(AVG(CAST(earned_days AS DOUBLE)), 1) AS avg_exposure_days,

  -- 满期赔付率 = 已报告赔款 / 满期保费
  ${getMetricSql('earned_claim_ratio')},

  -- 满期出险率（年化）= 赔案件数 * 365 / 满期天数合计 * 100
  -- 公式来源：(赔案件数/保单件数) / (满期天数/365) = 赔案件数 * 365 / (保单件数 * 平均满期天数)
  ${getMetricSql('earned_loss_frequency')}

FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

// ==================== 费用率 ====================

/**
 * 生成费用率分析SQL
 *
 * 费用率 = 费用金额 / 保费 * 100%
 */
export function generateExpenseRatioQuery(config: CostAnalysisConfig): string {
  const { dimension, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');
  const dimKeyExpression = buildDimKeyExpr(groupByFields);

  return `
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS total_fee,

  -- 费用率 = 费用金额 / 保费 * 100%
  ${getMetricSql('expense_ratio')}

FROM PolicyFact
WHERE ${whereClause}
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

// ==================== 综合费用率 ====================

/**
 * 生成综合费用率分析SQL
 *
 * 综合费用率 = (赔款 + 费用) / 满期保费 * 100%
 */
export function generateComprehensiveCostQuery(
  config: CostAnalysisConfig
): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');
  const dimKeyExpression = buildDimKeyExpr(groupByFields);
  // B252：policy_dedup 按 (policy_no, insurance_start_date) 聚合去重，HAVING SUM(premium)>0
  const policyDedup = buildPolicyDedupCTE('policy_dedup', {
    whereClause,
    extraFields: groupByFields,
  });

  return `
WITH ${policyDedup},
policy_exposure AS (
  SELECT
    p.policy_no,
    ${groupByFields.map((f) => `p.${f}`).join(', ')},
    p.premium,
    p.insurance_start_date AS start_date,
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}'),
        0
      ),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days,
    COALESCE(c.claim_cases, 0) AS claim_cases,
    COALESCE(c.reported_claims, 0) AS reported_claims,
    p.fee_amount
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
)
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ROUND(SUM(fee_amount), 2) AS total_fee,
  -- 满期保费（闰年感知）
  ${getMetricSql('earned_premium')},

  -- 满期赔付率
  ${getMetricSql('earned_claim_ratio')},

  -- 费用率（注意：CTE 中 fee_amount 已 COALESCE(fee_amount,0)，字面上不含 COALESCE，保持原样）
  CASE
    WHEN SUM(premium) > 0
    THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2)
    ELSE NULL
  END AS expense_ratio,

  -- 综合费用率 = (赔款 + 费用) / 满期保费 * 100%
  CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN ROUND((SUM(reported_claims) + SUM(fee_amount)) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2)
    ELSE NULL
  END AS comprehensive_cost_ratio

FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

// ==================== 变动成本率 ====================

/**
 * 生成变动成本率分析SQL
 *
 * 变动成本率 = 赔付率 + 费用率（简化定义）
 */
export function generateVariableCostQuery(config: CostAnalysisConfig): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');
  const dimKeyExpression = buildDimKeyExpr(groupByFields);
  // B252：policy_dedup 按 (policy_no, insurance_start_date) 聚合去重，HAVING SUM(premium)>0
  const policyDedup = buildPolicyDedupCTE('policy_dedup', {
    whereClause,
    extraFields: groupByFields,
  });

  return `
WITH ${policyDedup},
policy_exposure AS (
  SELECT
    p.policy_no,
    ${groupByFields.map((f) => `p.${f}`).join(', ')},
    p.premium,
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}'),
        0
      ),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days,
    COALESCE(c.reported_claims, 0) AS reported_claims,
    p.fee_amount
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
)
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  -- 满期保费（闰年感知）
  ${getMetricSql('earned_premium')},
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ROUND(SUM(fee_amount), 2) AS total_fee,

  -- 满期赔付率
  ${getMetricSql('earned_claim_ratio')},

  -- 费用率（注意：CTE 中 fee_amount 已 COALESCE(fee_amount,0)，字面上不含 COALESCE，保持原样）
  CASE
    WHEN SUM(premium) > 0
    THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2)
    ELSE NULL
  END AS expense_ratio,

  -- 变动成本率 = 赔付率 + 费用率（注意：fee_amount 已 COALESCE，保持原样）
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

// ==================== 预设配置 ====================

export const COST_ANALYSIS_PRESETS = {
  /** 按客户类别的赔付率分析 */
  claimByCustomer: {
    dimension: 'customer_category' as CostDimension,
  },
  /** 按机构的赔付率分析 */
  claimByOrg: {
    dimension: 'org_level_3' as CostDimension,
  },
  /** 按险别组合的赔付率分析 */
  claimByCoverage: {
    dimension: 'coverage_combination' as CostDimension,
  },
};
