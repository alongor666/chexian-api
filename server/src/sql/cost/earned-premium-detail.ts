/**
 * 已赚保费月度明细 + 费用查询 SQL 生成器
 *
 * 包含：
 * - 2025年保单月度已赚保费（含26年各月增量）
 * - 2026年保单月度已赚保费（含26年+27年各月增量）
 * - 新口径已赚保费汇总（12个月 UNION ALL）
 * - 月度费用查询
 */

import {
  buildEarnedPremiumCase,
  getMonthEndDate,
} from '../sql-builder.js';
import { SURCHARGE_RATE } from '../../config/fixed-cost-params.js';
import {
  EARNED_PREMIUM_LINE_FACTORS,
  LINE_FACTOR_CASE_INLINE_SQL,
} from '../../config/earned-premium-factors.js';
import type { NewEarnedPremiumConfig } from './shared.js';

// ==================== 2025年保单月度已赚 ====================

/**
 * 生成2025年保单已赚保费查询SQL
 *
 * 字段：起保月（1-12）、保费、截至25年末已赚保费、26年各月当期新增已赚保费（12个字段）
 *
 * 验证规则：保费 ≈ 13个已赚保费字段之和（差异来自首日费用折扣 P×F×(1-α)，约2-3%）
 */
export function generatePolicy2025EarnedPremiumQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  // 生成26年各月的当期新增已赚保费字段（增量而非累计）
  const earned2026Fields: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentMonthEnd = getMonthEndDate(2026, m);
    // 上一期末：1月用25年12月末，2月及以后用上一个月末
    const prevMonthEnd = m === 1 ? getMonthEndDate(2025, 12) : getMonthEndDate(2026, m - 1);

    // 当期新增 = 截至当月末累计 - 截至上月末累计
    earned2026Fields.push(
      `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}) - SUM(${buildEarnedPremiumCase(prevMonthEnd).trim()}), 2) AS earned_2026_${String(m).padStart(2, '0')}`
    );
  }

  return `
WITH policy_base AS (
  SELECT
    policy_no,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    EXTRACT(MONTH FROM CAST(insurance_start_date AS DATE)) AS policy_month,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN ${EARNED_PREMIUM_LINE_FACTORS.compulsory}
      WHEN '商业保险' THEN ${EARNED_PREMIUM_LINE_FACTORS.commercial}
      ELSE ${EARNED_PREMIUM_LINE_FACTORS.other}
    END AS line_factor,
    insurance_start_date
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025
    AND insurance_type IN ('交强险', '商业保险')
)
SELECT
  CAST(policy_month AS INTEGER) AS policy_month,
  ROUND(SUM(premium), 2) AS premium,
  -- 截至25年末已赚保费（归于2025年）
  ROUND(SUM(${buildEarnedPremiumCase(getMonthEndDate(2025, 12)).trim()}), 2) AS earned_2025_12,
  -- 26年各月当期新增已赚保费（增量）
  ${earned2026Fields.join(',\n  ')},
  -- 已赚合计 = 截至25年末 + 26年各月增量 = 满期已赚
  ROUND(SUM(${buildEarnedPremiumCase(getMonthEndDate(2026, 12)).trim()}), 2) AS earned_total,
  -- 验证差异 = 保费 - 满期已赚（预期差异约2-3%，来自首日费用折扣 P×F×(1-α)）
  ROUND(
    SUM(premium) - SUM(${buildEarnedPremiumCase(getMonthEndDate(2026, 12)).trim()}),
    2
  ) AS validation_diff
FROM policy_base
GROUP BY policy_month
ORDER BY policy_month
  `.trim();
}

// ==================== 2026年保单月度已赚 ====================

/**
 * 生成2026年保单已赚保费查询SQL
 *
 * 字段：起保月、保费、26年各月当期已赚保费（12个字段）、27年各月当期已赚保费（12个字段）
 */
export function generatePolicy2026EarnedPremiumQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  // 生成26年各月的当期已赚保费字段
  const earned2026Fields: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentMonthEnd = getMonthEndDate(2026, m);
    if (m === 1) {
      // 第一期：直接是截至1月末的累计值（含首日费用）
      earned2026Fields.push(
        `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}), 2) AS earned_2026_01`
      );
    } else {
      // 后续月份：当期新增 = 当月末累计 - 上月末累计
      const prevMonthEnd = getMonthEndDate(2026, m - 1);
      earned2026Fields.push(
        `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}) - SUM(${buildEarnedPremiumCase(prevMonthEnd).trim()}), 2) AS earned_2026_${String(m).padStart(2, '0')}`
      );
    }
  }

  // 生成27年各月的当期已赚保费字段
  const earned2027Fields: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentMonthEnd = getMonthEndDate(2027, m);
    // 上一期末：1月用26年12月末，后续用27年上一个月末
    const prevMonthEnd = m === 1 ? getMonthEndDate(2026, 12) : getMonthEndDate(2027, m - 1);
    earned2027Fields.push(
      `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}) - SUM(${buildEarnedPremiumCase(prevMonthEnd).trim()}), 2) AS earned_2027_${String(m).padStart(2, '0')}`
    );
  }

  return `
WITH policy_base AS (
  SELECT
    policy_no,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    EXTRACT(MONTH FROM CAST(insurance_start_date AS DATE)) AS policy_month,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN ${EARNED_PREMIUM_LINE_FACTORS.compulsory}
      WHEN '商业保险' THEN ${EARNED_PREMIUM_LINE_FACTORS.commercial}
      ELSE ${EARNED_PREMIUM_LINE_FACTORS.other}
    END AS line_factor,
    insurance_start_date
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026
    AND insurance_type IN ('交强险', '商业保险')
)
SELECT
  CAST(policy_month AS INTEGER) AS policy_month,
  ROUND(SUM(premium), 2) AS premium,
  -- 26年各月当期已赚保费
  ${earned2026Fields.join(',\n  ')},
  -- 27年各月当期已赚保费
  ${earned2027Fields.join(',\n  ')}
FROM policy_base
GROUP BY policy_month
ORDER BY policy_month
  `.trim();
}

// ==================== 新口径已赚保费汇总 ====================

/**
 * 生成新口径已赚保费汇总查询SQL
 *
 * 按2026年12个月末统计滚动12个月已赚保费
 */
export function generateNewEarnedPremiumSummaryQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  // 生成12个月的UNION ALL查询
  const monthQueries: string[] = [];

  for (let m = 1; m <= 12; m++) {
    const statMonthEnd = getMonthEndDate(2026, m);
    const statMonth = `2026-${String(m).padStart(2, '0')}`;

    // 滚动12个月窗口：2025年M月1日 ~ 2026年M月末
    const windowStartDate = `2025-${String(m).padStart(2, '0')}-01`;

    // 窗口前一天：2025年(M-1)月末，用于计算2025年保单在窗口内的增量
    // M=1时，窗口前一天是2024-12-31
    const windowPrevEnd = m === 1
      ? '2024-12-31'
      : getMonthEndDate(2025, m - 1);

    monthQueries.push(`
      SELECT
        '${statMonth}' AS stat_month,
        -- 滚动12个月保费：起保日在 [窗口起点, 统计月末] 之间的保费
        (
          SELECT COALESCE(SUM(premium), 0)
          FROM PolicyFact
          WHERE ${whereClause}
            AND insurance_start_date IS NOT NULL
            AND insurance_type IN ('交强险', '商业保险')
            AND CAST(insurance_start_date AS DATE) >= DATE '${windowStartDate}'
            AND CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
        ) AS rolling_12m_premium,
        -- 2025年保单在滚动12个月窗口内的已赚保费
        -- = 累计(统计月末) - 累计(窗口前一天)
        -- 只计算起保日在窗口内的保单（2025年M月及之后起保）
        (
          SELECT COALESCE(SUM(
            -- 累计已赚保费（到统计月末）
            (premium * (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END) *
             (${LINE_FACTOR_CASE_INLINE_SQL}) +
             premium * (1 - (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END)) *
             LEAST(
               GREATEST(DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1, 0),
               DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
             ) * 1.0 / DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR))
            -
            -- 减去截至窗口前一天的已赚保费
            (premium * (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END) *
             (${LINE_FACTOR_CASE_INLINE_SQL}) *
             (CASE WHEN CAST(insurance_start_date AS DATE) <= DATE '${windowPrevEnd}' THEN 1 ELSE 0 END) +
             premium * (1 - (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END)) *
             LEAST(
               GREATEST(DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${windowPrevEnd}') + 1, 0),
               DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
             ) * 1.0 / DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR))
          ), 0)
          FROM PolicyFact
          WHERE ${whereClause}
            AND insurance_start_date IS NOT NULL
            AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025
            AND CAST(insurance_start_date AS DATE) >= DATE '${windowStartDate}'
            AND insurance_type IN ('交强险', '商业保险')
        ) AS earned_from_2025,
        -- 2026年保单在窗口内的已赚保费（起保日一定在窗口内，直接累计）
        (
          SELECT COALESCE(SUM(
            CASE
              WHEN CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
              THEN
                premium * (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END) *
                (${LINE_FACTOR_CASE_INLINE_SQL}) +
                premium * (1 - (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END)) *
                LEAST(
                  GREATEST(DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1, 0),
                  DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
                ) * 1.0 / DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
              ELSE 0
            END
          ), 0)
          FROM PolicyFact
          WHERE ${whereClause}
            AND insurance_start_date IS NOT NULL
            AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026
            AND CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
            AND insurance_type IN ('交强险', '商业保险')
        ) AS earned_from_2026
    `);
  }

  return `
WITH monthly_stats AS (
  ${monthQueries.join('\n  UNION ALL\n  ')}
)
SELECT
  stat_month,
  ROUND(rolling_12m_premium, 2) AS rolling_12m_premium,
  ROUND(earned_from_2025, 2) AS earned_from_2025,
  ROUND(earned_from_2026, 2) AS earned_from_2026,
  ROUND(earned_from_2025 + earned_from_2026, 2) AS total_earned_premium,
  CASE
    WHEN rolling_12m_premium > 0
    THEN ROUND((earned_from_2025 + earned_from_2026) * 100.0 / rolling_12m_premium, 2)
    ELSE 0
  END AS earned_ratio
FROM monthly_stats
ORDER BY stat_month
  `.trim();
}

// ==================== 月度费用 ====================

/**
 * 生成月度费用数据查询SQL
 *
 * 按起保月统计保费和费用金额,用于计算滚动12个月费用（考虑延迟）
 */
export function generateMonthlyExpenseQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  return `
SELECT
  STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS policy_month,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS total_fee,
  ROUND(SUM(premium) * ${SURCHARGE_RATE}, 2) AS tax,
  ROUND(SUM(COALESCE(fee_amount, 0)) + SUM(premium) * ${SURCHARGE_RATE}, 2) AS total_expense
FROM PolicyFact
WHERE ${whereClause}
  AND insurance_start_date IS NOT NULL
  AND (
    (EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025)
    OR
    (EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026)
  )
GROUP BY STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m')
ORDER BY policy_month
  `.trim();
}
