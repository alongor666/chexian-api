/**
 * 已赚保费滚动汇总 + 费用查询 SQL 生成器（锚定年参数化）
 *
 * 包含：
 * - 新口径已赚保费汇总（锚定年 Y 的 12 个月 UNION ALL，滚动 12 个月窗口）
 * - 月度费用查询（保单年度 Y-1 / Y）
 *
 * 锚定年 Y 由调用方传入（路由层 resolveCostAnchorYear() 解析），跨年零改代码。
 * 历史 V2 生成器 generatePolicy2025/2026EarnedPremiumQuery 无运行时调用方，
 * 已随本次去硬编码重构删除（月度明细统一走 sql-builder.ts 的
 * generateEarnedPremiumPeriodQuery 参数化基座）。
 */

import { getMonthEndDate } from '../sql-builder.js';
import { SURCHARGE_RATE } from '../../config/fixed-cost-params.js';
import { LINE_FACTOR_CASE_INLINE_SQL } from '../../config/earned-premium-factors.js';
import type { NewEarnedPremiumConfig } from './shared.js';

// ==================== 新口径已赚保费汇总 ====================

/**
 * 生成新口径已赚保费汇总查询SQL
 *
 * 按锚定年 Y 的 12 个月末统计滚动 12 个月已赚保费：
 * - 滚动窗口 = [Y-1 年 M 月 1 日, Y 年 M 月末]
 * - earned_from_prev：Y-1 年保单在窗口内的已赚保费
 * - earned_from_curr：Y 年保单在窗口内的已赚保费
 */
export function generateNewEarnedPremiumSummaryQuery(
  anchorYear: number,
  config: NewEarnedPremiumConfig = {}
): string {
  const { whereClause = '1=1' } = config;
  const prevYear = anchorYear - 1;

  // 生成12个月的UNION ALL查询
  const monthQueries: string[] = [];

  for (let m = 1; m <= 12; m++) {
    const statMonthEnd = getMonthEndDate(anchorYear, m);
    const statMonth = `${anchorYear}-${String(m).padStart(2, '0')}`;

    // 滚动12个月窗口：Y-1年M月1日 ~ Y年M月末
    const windowStartDate = `${prevYear}-${String(m).padStart(2, '0')}-01`;

    // 窗口前一天：Y-1年(M-1)月末，用于计算Y-1年保单在窗口内的增量
    // M=1时，窗口前一天是 Y-2 年 12 月 31 日
    const windowPrevEnd = m === 1
      ? `${prevYear - 1}-12-31`
      : getMonthEndDate(prevYear, m - 1);

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
        -- 上一保单年度（Y-1）保单在滚动12个月窗口内的已赚保费
        -- = 累计(统计月末) - 累计(窗口前一天)
        -- 只计算起保日在窗口内的保单（Y-1年M月及之后起保）
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
            AND CAST(insurance_start_date AS DATE) <= DATE '${prevYear}-12-31'
            AND CAST(insurance_start_date AS DATE) >= DATE '${windowStartDate}'
            AND insurance_type IN ('交强险', '商业保险')
        ) AS earned_from_prev,
        -- 锚定年（Y）保单在窗口内的已赚保费（起保日一定在窗口内，直接累计）
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
            AND CAST(insurance_start_date AS DATE) >= DATE '${anchorYear}-01-01'
            AND CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
            AND insurance_type IN ('交强险', '商业保险')
        ) AS earned_from_curr
    `);
  }

  return `
WITH monthly_stats AS (
  ${monthQueries.join('\n  UNION ALL\n  ')}
)
SELECT
  stat_month,
  ROUND(rolling_12m_premium, 2) AS rolling_12m_premium,
  ROUND(earned_from_prev, 2) AS earned_from_prev,
  ROUND(earned_from_curr, 2) AS earned_from_curr,
  ROUND(earned_from_prev + earned_from_curr, 2) AS total_earned_premium,
  CASE
    WHEN rolling_12m_premium > 0
    THEN ROUND((earned_from_prev + earned_from_curr) * 100.0 / rolling_12m_premium, 2)
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
 * 按起保月统计保费和费用金额,用于计算滚动12个月费用（考虑延迟）。
 * 覆盖保单年度 Y-1 与 Y（与滚动汇总窗口对齐）。
 */
export function generateMonthlyExpenseQuery(
  anchorYear: number,
  config: NewEarnedPremiumConfig = {}
): string {
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
  AND CAST(insurance_start_date AS DATE) BETWEEN DATE '${anchorYear - 1}-01-01' AND DATE '${anchorYear}-12-31'
GROUP BY STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m')
ORDER BY policy_month
  `.trim();
}
