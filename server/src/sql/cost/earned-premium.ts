/**
 * 已赚保费 SQL 生成器（滚动12个月口径 + V3 期间委托）
 *
 * 包含：
 * - 滚动12个月窗口计算
 * - 已赚保费明细查询
 * - 已赚保费汇总查询（按机构）
 * - V3 期间已赚保费包装器（委托 sql-builder.ts）
 */

import { formatDate } from '../../utils/date.js';
import { generateEarnedPremiumPeriodQuery } from '../sql-builder.js';
import type { EarnedPremiumConfig, NewEarnedPremiumConfig } from './shared.js';

// ==================== 滚动12个月窗口 ====================

/**
 * 计算滚动12个月窗口的起始日期
 * 窗口 = [统计日 - 364天, 统计日]（共365天）
 */
export function getRolling12MonthWindowStart(cutoffDate: string): string {
  const [year, month, day] = cutoffDate.split('-').map((v) => Number(v));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 364);
  return formatDate(date);
}

// ==================== 已赚保费明细 ====================

/**
 * 生成已赚保费明细查询SQL（滚动12个月口径）
 *
 * 滚动12个月财务口径：
 * - 窗口 = [统计日 - 364天, 统计日]
 * - 保单筛选：承保期间与窗口有交集的所有保单
 *
 * 计算公式：
 * - 期间已赚保费 = 首日费用部分 + 时间分摊部分
 * - 首日费用部分 = P × F × α × I（I=1当起保日在窗口内，否则0）
 * - 时间分摊部分 = P × (1-F) × (窗口内在保天数/365)
 */
export function generateEarnedPremiumQuery(config: EarnedPremiumConfig): string {
  const { cutoffDate, whereClause = '1=1', policyMonth, orgLevel3 } = config;

  // 滚动12个月窗口
  const windowStart = getRolling12MonthWindowStart(cutoffDate);

  // 构建明细筛选条件
  const detailFilters: string[] = [];
  if (policyMonth && policyMonth !== 'all') {
    detailFilters.push(`policy_month = '${policyMonth}'`);
  }
  if (orgLevel3 && orgLevel3 !== 'all') {
    detailFilters.push(`org_level_3 = '${orgLevel3}'`);
  }
  const detailFilterClause = detailFilters.length > 0
    ? `AND ${detailFilters.join(' AND ')}`
    : '';

  return `
WITH policy_earned AS (
  SELECT
    policy_no,
    org_level_3,
    insurance_type,
    STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS policy_month,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    -- 终保日 = 起保日 + 364天（一年期保单）
    CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY AS end_date,
    -- 保险期限天数（闰年感知：365/366），用于时间分摊分母
    DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR) AS policy_term,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    -- 起保日是否在窗口内（用于首日费用计算）
    CASE
      WHEN CAST(insurance_start_date AS DATE) >= DATE '${windowStart}'
       AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
      THEN 1 ELSE 0
    END AS start_in_window,
    -- 窗口内在保天数 = max(0, min(终保日, 统计日) - max(起保日, 窗口起点) + 1)
    GREATEST(
      0,
      DATEDIFF('day',
        GREATEST(CAST(insurance_start_date AS DATE), DATE '${windowStart}'),
        LEAST(CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY, DATE '${cutoffDate}')
      ) + 1
    ) AS days_in_window
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND insurance_type IN ('交强险', '商业保险')
    -- 滚动12个月口径：保单承保期间与窗口有交集
    -- 条件：起保日 <= 统计日 AND 终保日 >= 窗口起点
    AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
    AND (CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY) >= DATE '${windowStart}'
)
SELECT
  COALESCE(org_level_3, '未知') AS org_level_3,
  COALESCE(insurance_type, '未知') AS insurance_type,
  COALESCE(policy_month, '未知') AS policy_month,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(fee_amount), 2) AS total_fee,
  -- 平均费用率（%）= SUM(费用)/SUM(保费)
  ROUND(SUM(fee_amount) / NULLIF(SUM(premium), 0) * 100, 2) AS fee_rate,
  -- 险类系数
  ROUND(AVG(line_factor), 2) AS line_factor,
  -- 平均窗口内在保天数
  ROUND(AVG(CAST(days_in_window AS DOUBLE)), 1) AS avg_elapsed_days,
  -- 首日费用部分 = SUM(P × F × α × I)
  ROUND(SUM(premium * fee_rate * line_factor * start_in_window), 2) AS first_day_part,
  -- 时间分摊部分 = SUM(P × (1-F) × (窗口内天数/policy_term))（闰年感知）
  ROUND(SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / CAST(policy_term AS DOUBLE))), 2) AS time_part,
  -- 期间已赚保费
  ROUND(
    SUM(premium * fee_rate * line_factor * start_in_window) +
    SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / CAST(policy_term AS DOUBLE))),
    2
  ) AS earned_premium_cum
FROM policy_earned
WHERE 1=1 ${detailFilterClause}
GROUP BY org_level_3, insurance_type, policy_month
ORDER BY org_level_3, insurance_type, policy_month
  `.trim();
}

// ==================== 已赚保费汇总 ====================

/**
 * 生成已赚保费汇总查询SQL（滚动12个月口径，按三级机构分组）
 */
export function generateEarnedPremiumSummaryQuery(config: EarnedPremiumConfig): string {
  const { cutoffDate, whereClause = '1=1' } = config;
  const windowStart = getRolling12MonthWindowStart(cutoffDate);

  return `
WITH policy_earned AS (
  SELECT
    policy_no,
    org_level_3,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    -- 起保日是否在窗口内
    CASE
      WHEN CAST(insurance_start_date AS DATE) >= DATE '${windowStart}'
       AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
      THEN 1 ELSE 0
    END AS start_in_window,
    -- 保险期限天数（闰年感知：365/366），用于时间分摊分母
    DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR) AS policy_term,
    -- 窗口内在保天数
    GREATEST(
      0,
      DATEDIFF('day',
        GREATEST(CAST(insurance_start_date AS DATE), DATE '${windowStart}'),
        LEAST(CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY, DATE '${cutoffDate}')
      ) + 1
    ) AS days_in_window
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND insurance_type IN ('交强险', '商业保险')
    -- 滚动12个月口径：保单承保期间与窗口有交集
    AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
    AND (CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY) >= DATE '${windowStart}'
),
aggregated AS (
  SELECT
    COALESCE(org_level_3, '未知') AS org_level_3,
    CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
    SUM(premium) AS total_premium,
    SUM(fee_amount) AS total_fee,
    SUM(fee_amount) / NULLIF(SUM(premium), 0) AS avg_fee_rate,
    -- 首日费用部分 = SUM(P × F × α × I)
    SUM(premium * fee_rate * line_factor * start_in_window) AS total_first_day_part,
    -- 时间分摊部分 = SUM(P × (1-F) × (窗口内天数/policy_term))（闰年感知）
    SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / CAST(policy_term AS DOUBLE))) AS total_time_part
  FROM policy_earned
  GROUP BY org_level_3
),
with_totals AS (
  SELECT * FROM aggregated
  UNION ALL
  SELECT
    '合计' AS org_level_3,
    SUM(policy_count) AS policy_count,
    SUM(total_premium) AS total_premium,
    SUM(total_fee) AS total_fee,
    SUM(total_fee) / NULLIF(SUM(total_premium), 0) AS avg_fee_rate,
    SUM(total_first_day_part) AS total_first_day_part,
    SUM(total_time_part) AS total_time_part
  FROM aggregated
)
SELECT
  org_level_3,
  policy_count,
  ROUND(total_premium, 2) AS total_premium,
  ROUND(total_fee, 2) AS total_fee,
  ROUND(avg_fee_rate * 100, 2) AS avg_fee_rate,
  ROUND(total_first_day_part, 2) AS total_first_day_part,
  ROUND(total_time_part, 2) AS total_time_part,
  ROUND(total_first_day_part + total_time_part, 2) AS total_earned_premium,
  -- 已赚保费率
  CASE
    WHEN total_premium > 0
    THEN ROUND((total_first_day_part + total_time_part) * 100.0 / total_premium, 2)
    ELSE 0
  END AS earned_ratio
FROM with_totals
ORDER BY
  CASE org_level_3
    WHEN '四川' THEN 1
    WHEN '同城' THEN 2
    WHEN '异地' THEN 3
    WHEN '合计' THEN 4
    ELSE 5
  END
  `.trim();
}

// ==================== V3 期间已赚保费包装器 ====================

/** 2025年保单在2025年的已赚保费 */
export function generatePolicy2025In2025Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2025,
    earnedYear: 2025,
    isSameYear: true,
    whereClause: config.whereClause ?? '1=1',
  });
}

/** 2025年保单在2026年的已赚保费 */
export function generatePolicy2025In2026Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2025,
    earnedYear: 2026,
    isSameYear: false,
    whereClause: config.whereClause ?? '1=1',
  });
}

/** 2026年保单在2026年的已赚保费 */
export function generatePolicy2026In2026Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2026,
    earnedYear: 2026,
    isSameYear: true,
    whereClause: config.whereClause ?? '1=1',
  });
}

/** 2026年保单在2027年的已赚保费 */
export function generatePolicy2026In2027Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2026,
    earnedYear: 2027,
    isSameYear: false,
    whereClause: config.whereClause ?? '1=1',
  });
}
