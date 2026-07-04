/**
 * 核心成本率 SQL 生成器 — 时间分摊口径（与赔款 cohort 同步）
 *
 * 4 种成本率口径：
 * - 赔付率（满期赔付率 + 满期出险率 + 案均赔款）
 * - 费用率
 * - 综合费用率
 * - 变动成本率
 *
 * ⚠️ 口径警告（B304）：本文件输出的 `earned_premium` 是【时间分摊口径】，
 *    用 `LEAST(cutoff - 起保 + 1, policy_term) / policy_term × premium` 计算，
 *    `policy_term = +INTERVAL 1 YEAR`（闰年感知 365/366），**不分险类、无系数**。
 *    与 `cost/earned-premium.ts` 的【财务口径】（+INTERVAL 364 DAY + 险类系数
 *    α=0.82/0.94/0.90）**字段同名但公式不同**，禁止下游混用——会算错赔付率。
 *    详见 `cost/earned-premium.ts` 文件头对照表 + BACKLOG B304。
 *
 * ⚠️ 赔款分子窗口对齐（B299 · 消费侧）：本文件三处 `LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no`
 *    JOIN 的是静态全量快照赔款（无出险日期过滤）。满期保费分母用 `earned_days` 截到 cutoffDate，
 *    但赔款分子未同窗口——**多 cutoff / 历史 YTD 查询**时早期窗口会拿"未来出险赔款 ÷ 过去满期保费"
 *    虚高数倍（duckdb 直查实证：cutoff=2026-03-31 满期赔付率 176.5%→61.5%；cutoff=最新数据日时
 *    窗口=全快照逐分钱一致，看板恒为最新 cutoff 故现状被掩盖）。
 *    根治需把这三处 JOIN 切换为 `domainLoaders.buildWindowedClaimsAggCTE(cutoffDate)` 产出的
 *    局部窗口化 CTE（同口径 + accident_time<=cutoff）。**但该切换是用户决策项**（BACKLOG B299）：
 *    cost 路由有 cube 影子路径，cube 构建期仍 JOIN 静态 ClaimsAgg（cube/cost-cube.ts，不在本任务域），
 *    单改 legacy 会在 cutoff<最新数据日 时与 cube 影子对账出现差异（codex 审计 P1-1）。
 *    完整修复须同步 cube/kpi/comprehensive/forecast 多模块或绑定时间机器特性排期，故本次仅落地
 *    `buildWindowedClaimsAggCTE` 能力 + 单测 + 实证，消费切换待用户拍板。详见 memory
 *    feedback_claims_window_aligned_to_earned。
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
    -- earned_days +1：含起保当天（与 sql-builder.ts 已有的 statMonthEnd 口径统一）
    -- 2026-05-20 对账校准：与 xlsx 周报满期保费偏差 -1.51% → -0.06% PASS
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}') + 1,
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
  // B252：与赔付率/综合费用率/变动成本率口径一致 — 按 (policy_no, insurance_start_date) 去重 + HAVING SUM(premium)>0
  const policyDedup = buildPolicyDedupCTE('policy_dedup', {
    whereClause,
    extraFields: groupByFields,
  });

  return `
WITH ${policyDedup}
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS total_fee,

  -- 费用率 = 费用金额 / 保费 * 100%
  ${getMetricSql('expense_ratio')}

FROM policy_dedup
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
    -- earned_days +1：含起保当天（与 sql-builder.ts 已有的 statMonthEnd 口径统一）
    -- 2026-05-20 对账校准：与 xlsx 周报满期保费偏差 -1.51% → -0.06% PASS
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}') + 1,
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

  -- 费用率（注册表 expense_ratio 唯一事实源 · B333：消除硬编码漂移。
  --   fee_amount 经 Parquet 直查 2.59M 行 0 NULL，故 SUM(fee_amount)≡SUM(COALESCE(fee_amount,0))，KPI 中性）
  ${getMetricSql('expense_ratio')},

  -- 综合费用率 = (赔款 + 费用) / 满期保费 * 100%
  CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN ROUND((SUM(reported_claims) + SUM(fee_amount)) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2)
    ELSE NULL
  END AS comprehensive_cost_ratio,

  -- 满期边际贡献额（仅扣除变动成本）
  ${getMetricSql('earned_margin_amount')},

  -- 预估边际贡献额（仅扣除变动成本）
  ${getMetricSql('projected_margin_amount')}

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
    -- earned_days +1：含起保当天（与 sql-builder.ts 已有的 statMonthEnd 口径统一）
    -- 2026-05-20 对账校准：与 xlsx 周报满期保费偏差 -1.51% → -0.06% PASS
    LEAST(
      GREATEST(
        DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}') + 1,
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

  -- 费用率（注册表 expense_ratio 唯一事实源 · B333：消除硬编码漂移。
  --   fee_amount 经 Parquet 直查 2.59M 行 0 NULL，故 SUM(fee_amount)≡SUM(COALESCE(fee_amount,0))，KPI 中性）
  ${getMetricSql('expense_ratio')},

  -- 变动成本率（注册表 variable_cost_ratio 唯一事实源，消除硬编码漂移；
  --   fee_amount 经 Parquet 直查 2.59M 行 0 NULL，故 SUM(fee_amount)≡SUM(COALESCE(fee_amount,0))，KPI 中性）
  ${getMetricSql('variable_cost_ratio')}

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
