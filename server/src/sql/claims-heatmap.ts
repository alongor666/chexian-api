/**
 * 理赔热力图 SQL 生成器
 *
 * 数据源：PolicyFact（保费收入口径）+ ClaimsDetail（赔案关联）
 * 端点：/api/query/claims-detail/heatmap
 *
 * 列逻辑：
 * - 最新日期 = MAX(policy_date) from PolicyFact
 * - 仅统计 insurance_start_date <= 最新日期 的保单
 * - 最近 2 个月按周展示（周六截止），更早的折叠为月
 * - 当周用最新日期截止，其他周用周六截止
 *
 * @see performance-heatmap.ts 保费热力图（参考实现）
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';
import {
  truthyExpr,
} from './performance-analysis-shared.js';
import type { HeatmapGroupDimension } from './performance-heatmap.js';

export { type HeatmapGroupDimension } from './performance-heatmap.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface ClaimsHeatmapFilters {
  orgName?: string;
  customerCategory?: string;
  isNev?: string;
  coverageCombination?: string;
  isTransfer?: string;
  vehicleQuickFilter?: string;
  businessNature?: string;
  isNewCar?: string;
  isRenewal?: string;
}

// ============================================================================
// 筛选器构建
// ============================================================================

function buildPolicyWhere(filters: ClaimsHeatmapFilters, prefix = 'p.'): string {
  const conditions: string[] = [];
  if (filters.orgName) conditions.push(`${prefix}org_level_3 = '${escapeSqlValue(filters.orgName)}'`);
  if (filters.customerCategory) conditions.push(`${prefix}customer_category = '${escapeSqlValue(filters.customerCategory)}'`);
  if (filters.isNev === '1' || filters.isNev === 'true') conditions.push(`${prefix}is_nev = true`);
  if (filters.isNev === '0' || filters.isNev === 'false') conditions.push(`${prefix}is_nev = false`);
  if (filters.coverageCombination) conditions.push(`${prefix}coverage_combination = '${escapeSqlValue(filters.coverageCombination)}'`);
  if (filters.isTransfer === 'true') conditions.push(`${prefix}is_transfer = true`);
  if (filters.isTransfer === 'false') conditions.push(`${prefix}is_transfer = false`);
  if (filters.isNewCar === 'true') conditions.push(`${prefix}is_new_car = true`);
  if (filters.isNewCar === 'false') conditions.push(`${prefix}is_new_car = false`);
  if (filters.isRenewal === 'true') conditions.push(`${prefix}is_renewal = true`);
  if (filters.isRenewal === 'false') conditions.push(`${prefix}is_renewal = false`);

  if (filters.vehicleQuickFilter) {
    switch (filters.vehicleQuickFilter) {
      case 'home_car':
        conditions.push(`${prefix}customer_category = '非营业个人客车'`);
        break;
      case 'truck_1t':
        conditions.push(`${prefix}customer_category IN ('营业货车', '非营业货车')`);
        conditions.push(`${prefix}tonnage_segment = '1吨以下'`);
        break;
      case 'truck_2_9t':
        conditions.push(`${prefix}customer_category IN ('营业货车', '非营业货车')`);
        conditions.push(`${prefix}tonnage_segment = '2-9吨'`);
        break;
      case 'motorcycle':
        conditions.push(`${prefix}customer_category = '摩托车'`);
        break;
      case 'truck_1_2t':
        conditions.push(`${prefix}customer_category IN ('营业货车', '非营业货车')`);
        conditions.push(`${prefix}tonnage_segment = '1-2吨'`);
        break;
      case 'rental':
        conditions.push(`${prefix}customer_category = '营业出租租赁'`);
        break;
    }
  }

  if (filters.businessNature === 'commercial') {
    conditions.push(`${prefix}customer_category LIKE '营业%'`);
  } else if (filters.businessNature === 'non_commercial') {
    conditions.push(`${prefix}customer_category LIKE '非营业%'`);
  }

  return conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
}

// ============================================================================
// 维度表达式
// ============================================================================

function getDimensionExpr(
  dimension: HeatmapGroupDimension,
  prefix = 'p.'
): { selectExpr: string; alias: string } {
  switch (dimension) {
    case 'team':
      return {
        selectExpr: `COALESCE(tm.team_name, '未归属团队')`,
        alias: 'dimension_value',
      };
    case 'salesman':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}salesman_name AS VARCHAR)), ''), '未知业务员')`,
        alias: 'dimension_value',
      };
    case 'customer_category':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}customer_category AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
      };
    case 'coverage_combination':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}coverage_combination AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
      };
    case 'energy_type':
      return {
        selectExpr: `CASE WHEN ${truthyExpr(`${prefix}is_nev`)} THEN '新能源' ELSE '燃油' END`,
        alias: 'dimension_value',
      };
    case 'business_nature':
      return {
        selectExpr: `CASE
          WHEN ${truthyExpr(`${prefix}is_renewal`)} THEN '续保'
          WHEN ${truthyExpr(`${prefix}is_new_car`)} THEN '新保'
          WHEN ${truthyExpr(`${prefix}is_transfer`)} THEN '过户转保'
          ELSE '非过户转保'
        END`,
        alias: 'dimension_value',
      };
    case 'insurance_grade':
      return {
        selectExpr: `COALESCE(${prefix}insurance_grade, 'X')`,
        alias: 'dimension_value',
      };
    default: // org_level_3
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}org_level_3 AS VARCHAR)), ''), '未知机构')`,
        alias: 'dimension_value',
      };
  }
}

// ============================================================================
// 主查询生成器
// ============================================================================

/**
 * 生成理赔热力图查询
 *
 * 返回 dimension_value × period 矩阵：
 * - 每行含维度值、期间标签、期间类型、原始指标 + 计算指标 + 去年同期
 * - 前端用相邻 period 计算 WoW，用 yoy_ 前缀计算 YoY
 */
export function generateClaimsHeatmapQuery(
  filters: ClaimsHeatmapFilters,
  dimension: HeatmapGroupDimension = 'org_level_3',
): string {
  const dimConfig = getDimensionExpr(dimension, 'p.');
  const needsTeamJoin = dimension === 'team';
  const policyWhere = buildPolicyWhere(filters, 'p.');

  const teamJoin = needsTeamJoin
    ? `LEFT JOIN SalesmanTeamMapping tm ON TRIM(CAST(p.salesman_name AS VARCHAR)) = TRIM(CAST(tm.full_name AS VARCHAR))`
    : '';

  const sql = `
    WITH
    -- 1. 最新签单日期
    ref_date AS (
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date FROM PolicyFact
    ),

    -- 2. 周/月边界
    boundary AS (
      SELECT DATE_TRUNC('month', max_date - INTERVAL 1 MONTH)::DATE AS wb, max_date
      FROM ref_date
    ),

    -- 3a. 月度期间（年初 → boundary 前）
    monthly_periods AS (
      SELECT
        ms::DATE AS period_start,
        (ms + INTERVAL 1 MONTH - INTERVAL 1 DAY)::DATE AS period_end,
        'month' AS period_type,
        CAST(EXTRACT(MONTH FROM ms) AS INT) AS period_month,
        ms::DATE AS sort_key
      FROM boundary b,
      generate_series(
        MAKE_DATE(EXTRACT(YEAR FROM b.max_date)::INT, 1, 1)::TIMESTAMP,
        (b.wb - INTERVAL 1 DAY)::TIMESTAMP,
        INTERVAL 1 MONTH
      ) AS t(ms)
    ),

    -- 3b. 周六截止点 + 最新日期
    week_cutoffs_raw AS (
      SELECT DISTINCT d::DATE AS cutoff
      FROM boundary b,
      generate_series(b.wb::TIMESTAMP, b.max_date::TIMESTAMP, INTERVAL 1 DAY) AS t(d)
      WHERE EXTRACT(DOW FROM d) = 6 AND d::DATE <= b.max_date

      UNION

      SELECT b.max_date FROM boundary b
      WHERE EXTRACT(DOW FROM b.max_date) != 6
    ),

    week_cutoffs AS (
      SELECT cutoff, ROW_NUMBER() OVER (ORDER BY cutoff) AS rn
      FROM week_cutoffs_raw
    ),

    -- 3c. 周度期间
    weekly_periods AS (
      SELECT
        COALESCE(
          (SELECT cutoff + INTERVAL 1 DAY FROM week_cutoffs WHERE rn = wc.rn - 1)::DATE,
          (SELECT wb FROM boundary)
        ) AS period_start,
        wc.cutoff AS period_end,
        'week' AS period_type,
        0 AS period_month,
        wc.cutoff AS sort_key
      FROM week_cutoffs wc
    ),

    -- 4. 合并所有期间
    all_periods AS (
      SELECT
        period_start, period_end, period_type, period_month,
        ROW_NUMBER() OVER (ORDER BY sort_key, period_type DESC) AS period_idx
      FROM (
        SELECT * FROM monthly_periods
        UNION ALL
        SELECT * FROM weekly_periods
      ) combined
    ),

    -- 5. 赔案预聚合（按保单汇总，避免 JOIN 膨胀）
    claims_by_policy AS (
      SELECT
        policy_no,
        COUNT(DISTINCT claim_no) AS claim_cnt,
        SUM(COALESCE(settled_amount, 0) + COALESCE(settled_fee, 0) + COALESCE(pending_amount, 0)) AS claim_total
      FROM ClaimsDetail
      GROUP BY policy_no
    ),

    -- 6. 当年保单 + 赔案汇总
    cur_data AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ap.period_idx,
        p.policy_no,
        p.premium,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1) AS policy_term_days,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          (SELECT max_date FROM ref_date) + INTERVAL 1 DAY), 0) AS elapsed_days,
        COALESCE(cb.claim_cnt, 0) AS claim_cnt,
        COALESCE(cb.claim_total, 0) AS claim_total
      FROM PolicyFact p
      ${teamJoin}
      JOIN all_periods ap
        ON CAST(p.insurance_start_date AS DATE) >= ap.period_start
        AND CAST(p.insurance_start_date AS DATE) <= ap.period_end
      LEFT JOIN claims_by_policy cb ON cb.policy_no = p.policy_no
      WHERE EXTRACT(YEAR FROM CAST(p.insurance_start_date AS DATE))
              = EXTRACT(YEAR FROM (SELECT max_date FROM ref_date))
        AND CAST(p.insurance_start_date AS DATE) <= (SELECT max_date FROM ref_date)
        AND COALESCE(p.premium, 0) > 0
        ${policyWhere}
    ),

    -- 7. 当年聚合
    cur_agg AS (
      SELECT
        dimension_value,
        period_idx,
        COUNT(DISTINCT policy_no) AS policy_count,
        ROUND(SUM(premium) / 1e4, 4) AS premium_wan,
        ROUND(SUM(premium * LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days) / 1e4, 4) AS earned_premium_wan,
        ROUND(SUM(LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days), 6) AS earned_exposure,
        SUM(claim_cnt) AS claim_count,
        ROUND(SUM(claim_total) / 1e4, 4) AS total_claims_wan
      FROM cur_data
      GROUP BY dimension_value, period_idx
    ),

    -- 8. 去年保单 + 赔案汇总
    prev_data AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ap.period_idx,
        p.policy_no,
        p.premium,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1) AS policy_term_days,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          (SELECT max_date FROM ref_date) - INTERVAL 1 YEAR + INTERVAL 1 DAY), 0) AS elapsed_days,
        COALESCE(cb.claim_cnt, 0) AS claim_cnt,
        COALESCE(cb.claim_total, 0) AS claim_total
      FROM PolicyFact p
      ${teamJoin}
      JOIN all_periods ap
        ON CAST(p.insurance_start_date AS DATE) >= (ap.period_start - INTERVAL 1 YEAR)::DATE
        AND CAST(p.insurance_start_date AS DATE) <= (ap.period_end - INTERVAL 1 YEAR)::DATE
      LEFT JOIN claims_by_policy cb ON cb.policy_no = p.policy_no
      WHERE EXTRACT(YEAR FROM CAST(p.insurance_start_date AS DATE))
              = EXTRACT(YEAR FROM (SELECT max_date FROM ref_date)) - 1
        AND CAST(p.insurance_start_date AS DATE) <= (SELECT max_date FROM ref_date) - INTERVAL 1 YEAR
        AND COALESCE(p.premium, 0) > 0
        ${policyWhere}
    ),

    -- 9. 去年聚合
    prev_agg AS (
      SELECT
        dimension_value,
        period_idx,
        COUNT(DISTINCT policy_no) AS policy_count,
        ROUND(SUM(premium) / 1e4, 4) AS premium_wan,
        ROUND(SUM(premium * LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days) / 1e4, 4) AS earned_premium_wan,
        ROUND(SUM(LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days), 6) AS earned_exposure,
        SUM(claim_cnt) AS claim_count,
        ROUND(SUM(claim_total) / 1e4, 4) AS total_claims_wan
      FROM prev_data
      GROUP BY dimension_value, period_idx
    ),

    -- 10. 完整网格
    dim_pool AS (SELECT DISTINCT dimension_value FROM cur_data),

    base_grid AS (
      SELECT dp.dimension_value, ap.period_idx
      FROM dim_pool dp CROSS JOIN all_periods ap
    )

    -- 11. 最终输出
    SELECT
      bg.dimension_value,
      ap.period_idx,
      CASE
        WHEN ap.period_type = 'month'
          THEN CAST(ap.period_month AS VARCHAR) || '月'
        ELSE CAST(EXTRACT(MONTH FROM ap.period_end) AS INT)
             || '.' || CAST(EXTRACT(DAY FROM ap.period_end) AS INT)
      END AS period_label,
      ap.period_type,
      CAST(ap.period_start AS VARCHAR) AS period_start,
      CAST(ap.period_end AS VARCHAR) AS period_end,

      -- 当年指标
      COALESCE(cur.policy_count, 0) AS policy_count,
      COALESCE(cur.premium_wan, 0) AS premium_wan,
      COALESCE(cur.earned_premium_wan, 0) AS earned_premium_wan,
      COALESCE(cur.earned_exposure, 0) AS earned_exposure,
      COALESCE(cur.claim_count, 0) AS claim_count,
      COALESCE(cur.total_claims_wan, 0) AS total_claims_wan,

      -- 计算指标
      CASE WHEN COALESCE(cur.earned_premium_wan, 0) > 0
        THEN ROUND(COALESCE(cur.total_claims_wan, 0) * 100.0 / cur.earned_premium_wan, 2)
        ELSE NULL END AS loss_ratio_pct,
      CASE WHEN COALESCE(cur.claim_count, 0) > 0
        THEN ROUND(COALESCE(cur.total_claims_wan, 0) * 10000.0 / cur.claim_count, 0)
        ELSE NULL END AS avg_claim,
      CASE WHEN COALESCE(cur.earned_exposure, 0) > 0
        THEN ROUND(COALESCE(cur.claim_count, 0) * 100.0 / cur.earned_exposure, 4)
        ELSE NULL END AS incident_rate_pct,

      -- 去年同期原始
      COALESCE(prev.policy_count, 0) AS yoy_policy_count,
      COALESCE(prev.earned_premium_wan, 0) AS yoy_earned_premium_wan,
      COALESCE(prev.claim_count, 0) AS yoy_claim_count,
      COALESCE(prev.total_claims_wan, 0) AS yoy_total_claims_wan,
      COALESCE(prev.earned_exposure, 0) AS yoy_earned_exposure,
      CASE WHEN COALESCE(prev.earned_premium_wan, 0) > 0
        THEN ROUND(COALESCE(prev.total_claims_wan, 0) * 100.0 / prev.earned_premium_wan, 2)
        ELSE NULL END AS yoy_loss_ratio_pct,
      CASE WHEN COALESCE(prev.claim_count, 0) > 0
        THEN ROUND(COALESCE(prev.total_claims_wan, 0) * 10000.0 / prev.claim_count, 0)
        ELSE NULL END AS yoy_avg_claim,
      CASE WHEN COALESCE(prev.earned_exposure, 0) > 0
        THEN ROUND(COALESCE(prev.claim_count, 0) * 100.0 / prev.earned_exposure, 4)
        ELSE NULL END AS yoy_incident_rate_pct,

      (SELECT CAST(max_date AS VARCHAR) FROM ref_date) AS ref_max_date

    FROM base_grid bg
    JOIN all_periods ap ON ap.period_idx = bg.period_idx
    LEFT JOIN cur_agg cur ON cur.dimension_value = bg.dimension_value AND cur.period_idx = bg.period_idx
    LEFT JOIN prev_agg prev ON prev.dimension_value = bg.dimension_value AND prev.period_idx = bg.period_idx
    ORDER BY bg.dimension_value, ap.period_idx
  `;

  logger.debug('Generated claims heatmap SQL', {
    dimension,
    sqlLength: sql.length,
  });

  return sql;
}
