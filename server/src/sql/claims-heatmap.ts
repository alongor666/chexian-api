/**
 * 理赔热力图 SQL 生成器
 *
 * 双时间轴架构：
 * - 保费侧：PolicyFact 按 insurance_start_date（或 dateField）分配到期间
 * - 赔案侧：ClaimsDetail 按 report_time（报案时间）或 accident_time（出险时间）独立分配到期间
 * - 两侧在 dimension × period 网格上 LEFT JOIN 合并
 *
 * 列逻辑：
 * - 最新日期 = MAX(policy_date) from PolicyFact
 * - 仅统计 insurance_start_date <= 最新日期 的保单
 * - 最近 2 个月按周展示（周六截止），更早的折叠为月
 * - 当周用最新日期截止，其他周用周六截止
 *
 * 端点：/api/query/claims-detail/heatmap
 * @see performance-heatmap.ts 保费热力图（参考实现）
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';
import {
  truthyExpr,
} from './performance-analysis-shared.js';
import type { HeatmapGroupDimension } from './performance-heatmap.js';

export { type HeatmapGroupDimension } from './performance-heatmap.js';

/** 赔案时间字段：报案时间（默认）或出险时间 */
export type ClaimsDateField = 'report_time' | 'accident_time';

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
// 白名单常量
// ============================================================================

const VALID_DATE_FIELDS = new Set(['policy_date', 'insurance_start_date']);
const VALID_CLAIMS_DATE_FIELDS = new Set<ClaimsDateField>(['report_time', 'accident_time']);

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
      // 优先级：新车 → 过户 → 续保 → 转保（见 project_vehicle_type_classification.md）
      return {
        selectExpr: `CASE
          WHEN ${truthyExpr(`${prefix}is_new_car`)} THEN '新保'
          WHEN ${truthyExpr(`${prefix}is_transfer`)} THEN '过户转保'
          WHEN ${truthyExpr(`${prefix}is_renewal`)} THEN '续保'
          ELSE '转保'
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
 * 生成理赔热力图查询（双时间轴）
 *
 * 返回 dimension_value × period 矩阵：
 * - 保费侧按 dateField（默认 insurance_start_date）分配到期间
 * - 赔案侧按 claimsDateField（默认 report_time）独立分配到期间
 * - 前端用相邻 period 计算 WoW，用 yoy_ 前缀计算 YoY
 *
 * @param filters 筛选条件
 * @param dimension 行维度
 * @param dateField 保费时间轴字段（默认 insurance_start_date）
 * @param claimsDateField 赔案时间轴字段（默认 report_time）
 */
export function generateClaimsHeatmapQuery(
  filters: ClaimsHeatmapFilters,
  dimension: HeatmapGroupDimension = 'org_level_3',
  dateField: string = 'insurance_start_date',
  claimsDateField: ClaimsDateField = 'report_time',
): string {
  // 白名单校验，防止 SQL 注入
  const safeDateField = VALID_DATE_FIELDS.has(dateField) ? dateField : 'insurance_start_date';
  const safeClaimsDateField = VALID_CLAIMS_DATE_FIELDS.has(claimsDateField) ? claimsDateField : 'report_time';

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

    -- 2. 周/月边界（近 2 月按周，更早折叠为月）
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

    -- ═══════════════════════════════════════════════════════════
    -- 保费侧：PolicyFact 按 ${safeDateField} 分配到期间
    -- ⚡ 性能热点：PolicyFact 全表扫描，数据量 > 10 万时关注
    -- ═══════════════════════════════════════════════════════════

    -- 5. 当年保费数据
    cur_premium_data AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ap.period_idx,
        p.policy_no,
        p.premium,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1) AS policy_term_days,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          (SELECT max_date FROM ref_date) + INTERVAL 1 DAY), 0) AS elapsed_days
      FROM PolicyFact p
      ${teamJoin}
      JOIN all_periods ap
        ON CAST(p.${safeDateField} AS DATE) >= ap.period_start
        AND CAST(p.${safeDateField} AS DATE) <= ap.period_end
      WHERE EXTRACT(YEAR FROM CAST(p.${safeDateField} AS DATE))
              = EXTRACT(YEAR FROM (SELECT max_date FROM ref_date))
        AND CAST(p.${safeDateField} AS DATE) <= (SELECT max_date FROM ref_date)
        AND COALESCE(p.premium, 0) > 0
        ${policyWhere}
    ),

    -- 6. 当年保费聚合
    cur_premium_agg AS (
      SELECT
        dimension_value,
        period_idx,
        COUNT(DISTINCT policy_no) AS policy_count,
        ROUND(SUM(premium) / 1e4, 4) AS premium_wan,
        ROUND(SUM(premium * LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days) / 1e4, 4) AS earned_premium_wan,
        ROUND(SUM(LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days), 6) AS earned_exposure
      FROM cur_premium_data
      GROUP BY dimension_value, period_idx
    ),

    -- ═══════════════════════════════════════════════════════════
    -- 赔案侧：ClaimsDetail 按 ${safeClaimsDateField} 独立分配到期间
    -- 通过 policy_no JOIN PolicyFact 获取维度属性
    -- ═══════════════════════════════════════════════════════════

    -- 7. 当年赔案数据
    cur_claims_data AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ap.period_idx,
        c.claim_no,
        COALESCE(c.settled_amount, 0) + COALESCE(c.settled_fee, 0) + COALESCE(c.pending_amount, 0) AS claim_amount
      FROM ClaimsDetail c
      JOIN PolicyFact p ON c.policy_no = p.policy_no
      ${teamJoin}
      JOIN all_periods ap
        ON CAST(c.${safeClaimsDateField} AS DATE) >= ap.period_start
        AND CAST(c.${safeClaimsDateField} AS DATE) <= ap.period_end
      WHERE EXTRACT(YEAR FROM CAST(c.${safeClaimsDateField} AS DATE))
              = EXTRACT(YEAR FROM (SELECT max_date FROM ref_date))
        AND CAST(c.${safeClaimsDateField} AS DATE) <= (SELECT max_date FROM ref_date)
        AND COALESCE(p.premium, 0) > 0
        ${policyWhere}
    ),

    -- 8. 当年赔案聚合
    cur_claims_agg AS (
      SELECT
        dimension_value,
        period_idx,
        COUNT(DISTINCT claim_no) AS claim_count,
        ROUND(SUM(claim_amount) / 1e4, 4) AS total_claims_wan
      FROM cur_claims_data
      GROUP BY dimension_value, period_idx
    ),

    -- ═══════════════════════════════════════════════════════════
    -- 去年同期（两侧各自偏移 -1 年）
    -- ═══════════════════════════════════════════════════════════

    -- 9. 去年保费
    prev_premium_data AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ap.period_idx,
        p.policy_no,
        p.premium,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1) AS policy_term_days,
        GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE),
          (SELECT max_date FROM ref_date) - INTERVAL 1 YEAR + INTERVAL 1 DAY), 0) AS elapsed_days
      FROM PolicyFact p
      ${teamJoin}
      JOIN all_periods ap
        ON CAST(p.${safeDateField} AS DATE) >= (ap.period_start - INTERVAL 1 YEAR)::DATE
        AND CAST(p.${safeDateField} AS DATE) <= (ap.period_end - INTERVAL 1 YEAR)::DATE
      WHERE EXTRACT(YEAR FROM CAST(p.${safeDateField} AS DATE))
              = EXTRACT(YEAR FROM (SELECT max_date FROM ref_date)) - 1
        AND CAST(p.${safeDateField} AS DATE) <= (SELECT max_date FROM ref_date) - INTERVAL 1 YEAR
        AND COALESCE(p.premium, 0) > 0
        ${policyWhere}
    ),

    prev_premium_agg AS (
      SELECT
        dimension_value,
        period_idx,
        COUNT(DISTINCT policy_no) AS policy_count,
        ROUND(SUM(premium) / 1e4, 4) AS premium_wan,
        ROUND(SUM(premium * LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days) / 1e4, 4) AS earned_premium_wan,
        ROUND(SUM(LEAST(elapsed_days, policy_term_days)::DOUBLE / policy_term_days), 6) AS earned_exposure
      FROM prev_premium_data
      GROUP BY dimension_value, period_idx
    ),

    -- 10. 去年赔案
    prev_claims_data AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ap.period_idx,
        c.claim_no,
        COALESCE(c.settled_amount, 0) + COALESCE(c.settled_fee, 0) + COALESCE(c.pending_amount, 0) AS claim_amount
      FROM ClaimsDetail c
      JOIN PolicyFact p ON c.policy_no = p.policy_no
      ${teamJoin}
      JOIN all_periods ap
        ON CAST(c.${safeClaimsDateField} AS DATE) >= (ap.period_start - INTERVAL 1 YEAR)::DATE
        AND CAST(c.${safeClaimsDateField} AS DATE) <= (ap.period_end - INTERVAL 1 YEAR)::DATE
      WHERE EXTRACT(YEAR FROM CAST(c.${safeClaimsDateField} AS DATE))
              = EXTRACT(YEAR FROM (SELECT max_date FROM ref_date)) - 1
        AND CAST(c.${safeClaimsDateField} AS DATE) <= (SELECT max_date FROM ref_date) - INTERVAL 1 YEAR
        AND COALESCE(p.premium, 0) > 0
        ${policyWhere}
    ),

    prev_claims_agg AS (
      SELECT
        dimension_value,
        period_idx,
        COUNT(DISTINCT claim_no) AS claim_count,
        ROUND(SUM(claim_amount) / 1e4, 4) AS total_claims_wan
      FROM prev_claims_data
      GROUP BY dimension_value, period_idx
    ),

    -- 11. 维度池（保费和赔案的并集）
    dim_pool AS (
      SELECT DISTINCT dimension_value FROM cur_premium_data
      UNION
      SELECT DISTINCT dimension_value FROM cur_claims_data
    ),

    base_grid AS (
      SELECT dp.dimension_value, ap.period_idx
      FROM dim_pool dp CROSS JOIN all_periods ap
    )

    -- 12. 最终输出：双轴合并
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

      -- 当年保费侧
      COALESCE(cp.policy_count, 0) AS policy_count,
      COALESCE(cp.premium_wan, 0) AS premium_wan,
      COALESCE(cp.earned_premium_wan, 0) AS earned_premium_wan,
      COALESCE(cp.earned_exposure, 0) AS earned_exposure,

      -- 当年赔案侧（按 ${safeClaimsDateField} 归期）
      COALESCE(cc.claim_count, 0) AS claim_count,
      COALESCE(cc.total_claims_wan, 0) AS total_claims_wan,

      -- 计算指标（保费分母来自保费侧，赔案分子来自赔案侧）
      CASE WHEN COALESCE(cp.earned_premium_wan, 0) > 0
        THEN ROUND(COALESCE(cc.total_claims_wan, 0) * 100.0 / cp.earned_premium_wan, 2)
        ELSE NULL END AS loss_ratio_pct,
      CASE WHEN COALESCE(cc.claim_count, 0) > 0
        THEN ROUND(COALESCE(cc.total_claims_wan, 0) * 10000.0 / cc.claim_count, 0)
        ELSE NULL END AS avg_claim,
      CASE WHEN COALESCE(cp.earned_exposure, 0) > 0
        THEN ROUND(COALESCE(cc.claim_count, 0) * 100.0 / cp.earned_exposure, 4)
        ELSE NULL END AS incident_rate_pct,

      -- 去年同期保费侧
      COALESCE(pp.policy_count, 0) AS yoy_policy_count,
      COALESCE(pp.earned_premium_wan, 0) AS yoy_earned_premium_wan,
      COALESCE(pp.earned_exposure, 0) AS yoy_earned_exposure,

      -- 去年同期赔案侧
      COALESCE(pc.claim_count, 0) AS yoy_claim_count,
      COALESCE(pc.total_claims_wan, 0) AS yoy_total_claims_wan,

      -- 去年同期计算指标
      CASE WHEN COALESCE(pp.earned_premium_wan, 0) > 0
        THEN ROUND(COALESCE(pc.total_claims_wan, 0) * 100.0 / pp.earned_premium_wan, 2)
        ELSE NULL END AS yoy_loss_ratio_pct,
      CASE WHEN COALESCE(pc.claim_count, 0) > 0
        THEN ROUND(COALESCE(pc.total_claims_wan, 0) * 10000.0 / pc.claim_count, 0)
        ELSE NULL END AS yoy_avg_claim,
      CASE WHEN COALESCE(pp.earned_exposure, 0) > 0
        THEN ROUND(COALESCE(pc.claim_count, 0) * 100.0 / pp.earned_exposure, 4)
        ELSE NULL END AS yoy_incident_rate_pct,

      (SELECT CAST(max_date AS VARCHAR) FROM ref_date) AS ref_max_date

    FROM base_grid bg
    JOIN all_periods ap ON ap.period_idx = bg.period_idx
    LEFT JOIN cur_premium_agg cp ON cp.dimension_value = bg.dimension_value AND cp.period_idx = bg.period_idx
    LEFT JOIN cur_claims_agg cc ON cc.dimension_value = bg.dimension_value AND cc.period_idx = bg.period_idx
    LEFT JOIN prev_premium_agg pp ON pp.dimension_value = bg.dimension_value AND pp.period_idx = bg.period_idx
    LEFT JOIN prev_claims_agg pc ON pc.dimension_value = bg.dimension_value AND pc.period_idx = bg.period_idx
    ORDER BY bg.dimension_value, ap.period_idx
  `;

  logger.debug('Generated claims heatmap SQL', {
    dimension,
    dateField: safeDateField,
    claimsDateField: safeClaimsDateField,
    sqlLength: sql.length,
  });

  return sql;
}
