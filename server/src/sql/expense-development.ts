/**
 * 费用率发展 SQL 生成器
 *
 * 数据源：PolicyFact（保单维度，fee_amount + premium）→ 经 policy_dedup CTE 去重
 * 端点：/api/query/expense-development
 *
 * 日历发展口径：M_N = [年初, 年初+N个月)，累计扩展。
 * M1 = 1月承保保单，M12 = 全年。
 *
 * 口径：与赔付率/综合费用率/变动成本率统一，走 policy_dedup（保单级聚合 + HAVING SUM(premium)>0 排除全退保）。
 */

import { buildPolicyDedupCTE } from './shared/policy-dedup.js';

/**
 * @param whereClause - 由 buildWhereFromFilterParams 生成的 WHERE 条件（不含日期，因为用 cohort year 代替）
 * @param cohortYears - 起保年份列表
 * @param maxDevMonth - 最大发展月数（默认 12）
 */
export function generateExpenseRatioDevelopmentQuery(
  whereClause: string,
  cohortYears: number[] = [2023, 2024, 2025, 2026],
  maxDevMonth: number = 12
): string {
  const yearsIn = cohortYears.join(',');
  // 把 cohort 年限制下推到 dedup CTE 的 WHERE，避免聚合无关年份的批改副本
  const policyDedup = buildPolicyDedupCTE('policy_dedup', {
    whereClause: `(${whereClause}) AND YEAR(insurance_start_date) IN (${yearsIn})`,
  });

  return `
    WITH ${policyDedup},
    policies AS (
      SELECT
        YEAR(insurance_start_date) AS cohort_year,
        policy_no,
        insurance_start_date,
        premium,
        fee_amount
      FROM policy_dedup
    ),
    policy_totals AS (
      SELECT cohort_year,
        COUNT(DISTINCT policy_no) AS total_policies,
        ROUND(SUM(premium) / 1e4, 1) AS total_premium_wan
      FROM policies GROUP BY cohort_year
    ),
    dev_months AS (SELECT UNNEST(RANGE(1, ${maxDevMonth + 1})) AS dev_month),
    calendar_window AS (
      SELECT
        pt.cohort_year,
        m.dev_month,
        MAKE_DATE(pt.cohort_year, 1, 1) AS year_start,
        MAKE_DATE(pt.cohort_year, 1, 1) + to_months(m.dev_month) AS observation_end
      FROM policy_totals pt
      CROSS JOIN dev_months m
      WHERE MAKE_DATE(pt.cohort_year, 1, 1) + to_months(m.dev_month) <= CURRENT_DATE
    ),
    aggregated AS (
      SELECT
        cw.cohort_year,
        cw.dev_month,
        COUNT(DISTINCT p.policy_no) AS dev_policies,
        SUM(p.premium) AS total_premium,
        SUM(p.fee_amount) AS total_fee
      FROM calendar_window cw
      JOIN policies p
        ON p.cohort_year = cw.cohort_year
       AND p.insurance_start_date >= cw.year_start
       AND p.insurance_start_date <  cw.observation_end
      GROUP BY cw.cohort_year, cw.dev_month
    )
    SELECT
      a.cohort_year,
      a.dev_month,
      pt.total_policies,
      pt.total_premium_wan,
      a.dev_policies,
      ROUND(a.total_premium / 1e4, 1) AS dev_premium_wan,
      ROUND(a.total_fee / 1e4, 1) AS dev_fee_wan,
      ROUND(a.total_fee * 100.0 / NULLIF(a.total_premium, 0), 2) AS expense_ratio_pct,
      CASE WHEN a.dev_policies > 0
           THEN ROUND(a.total_fee / a.dev_policies, 0)
           ELSE NULL END AS avg_fee_per_policy,
      ROUND(a.dev_policies * 100.0 / pt.total_policies, 1) AS coverage_pct
    FROM aggregated a
    JOIN policy_totals pt ON a.cohort_year = pt.cohort_year
    ORDER BY a.cohort_year, a.dev_month
  `;
}
