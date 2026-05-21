/**
 * Forecast baseline SQL helpers
 *
 * Powers POST /api/agent/forecast/baseline. The baseline endpoint separates
 * "已发生（系统精确给出）" from "未来变量（需要建模假设）" — these queries
 * cover the actual side and the historical samples used to derive
 * percentiles for each unknown variable.
 *
 * Field names are taken from server/src/config/field-registry/fields.json:
 *  - policy_date           — 签单日期（V2 同期增速 + 截止快照过滤）
 *  - insurance_start_date  — 保险起期（已赚天数 + 历史保单年份分组）
 *  - premium               — 签单保费
 *  - fee_amount            — 费用金额
 *  - reported_claims       — 累计已报告赔款（来自 ClaimsAgg）
 *
 * Deduplication rule (B252) — reuses shared buildPolicyDedupCTE so that
 * 同一保单的原单+批改多行被 SUM 累加成净额，而不是只取最新一行。直接照搬
 * cost-ratios.ts / claims-heatmap 里的口径，避免 baseline 产出与既有诊断
 * endpoint 在 premium / fee_amount 上出现批改净值偏差。
 *
 * Cutoff snapshot rule — 所有 4 个查询都附加 policy_date <= cutoff，
 * 用户传一个历史 cutoff 时未来签单不会进入 actual / historical samples。
 */

import { getMetricSql } from '../../config/metric-registry/index.js';
import { buildPolicyDedupCTE } from '../shared/policy-dedup.js';

export interface BaselineQueryConfig {
  cutoffDate: string; // YYYY-MM-DD
  whereClause?: string;
  /** History window in years, used to filter signing-year cohorts. */
  historyWindowYears: number;
  /** Recent-months window for V4 (new-business expense ratio). */
  recentExpenseMonths: number;
}

/**
 * Compose the project-wide PolicyFact dedup CTE with a cutoff snapshot guard.
 *
 * - Reuses buildPolicyDedupCTE → SUM(premium) / SUM(fee_amount) per
 *   (policy_no, insurance_start_date), HAVING SUM(premium) > 0.
 * - Appends `policy_date <= cutoff` so historical cutoffs do not leak
 *   future-signed policies into actual / cohorts / yoy / recent.
 * - extraFields are exposed via ANY_VALUE() per buildPolicyDedupCTE
 *   conventions (cohort/yoy queries need policy_date for downstream
 *   filtering).
 */
function dedupCte(whereClause: string, cutoffDate: string, extraFields: string[] = []): string {
  const guarded = `(${whereClause}) AND policy_date <= DATE '${cutoffDate}'`;
  return buildPolicyDedupCTE('policy_dedup', { whereClause: guarded, extraFields });
}

/**
 * SQL A — Actual baseline: aggregates already-occurred figures up to cutoff.
 */
export function generateBaselineActualQuery(config: BaselineQueryConfig): string {
  const { cutoffDate, whereClause = '1=1' } = config;

  return `
WITH ${dedupCte(whereClause, cutoffDate)},
policy_exposure AS (
  SELECT
    p.policy_no,
    p.premium,
    COALESCE(p.fee_amount, 0) AS fee_amount,
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    -- earned_days +1：含起保当天（与 cost-ratios.ts / sql-builder.ts 口径统一）
    LEAST(
      GREATEST(DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}') + 1, 0),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days,
    COALESCE(c.reported_claims, 0) AS reported_claims
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
)
SELECT
  ROUND(SUM(premium), 2) AS signed_premium,
  ${getMetricSql('earned_premium')},
  ROUND(SUM(reported_claims), 2) AS cumulative_reported_claims,
  ROUND(SUM(fee_amount), 2) AS cumulative_fee,
  CAST(SUM(earned_days) AS BIGINT) AS total_exposure_days,
  CAST(COUNT(DISTINCT policy_no) AS BIGINT) AS policy_count
FROM policy_exposure
  `.trim();
}

/**
 * SQL B — Historical loss-ratio cohorts: per-signing-year ultimate loss ratio.
 *
 * Used to derive V1 (历史保单剩余敞口终极赔付率) and V3 (新签业务终极赔付率)
 * percentile distributions. The ratio is signed-premium-based (累计已报告赔款 /
 * 签单保费), which is a stable approximation for cohorts that have already
 * matured by the cutoff date.
 *
 * Window: cutoff_year - historyWindowYears .. cutoff_year - 1
 * (excludes current cutoff year because those cohorts are still developing).
 */
export function generateHistoricalLossRatioQuery(config: BaselineQueryConfig): string {
  const { cutoffDate, whereClause = '1=1', historyWindowYears } = config;
  const cutoffYear = Number.parseInt(cutoffDate.slice(0, 4), 10);
  const fromYear = cutoffYear - historyWindowYears;
  const toYear = cutoffYear - 1;

  return `
WITH ${dedupCte(whereClause, cutoffDate)},
yearly AS (
  SELECT
    YEAR(p.insurance_start_date) AS signing_year,
    SUM(p.premium) AS year_premium,
    SUM(COALESCE(c.reported_claims, 0)) AS year_claims
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
  WHERE YEAR(p.insurance_start_date) BETWEEN ${fromYear} AND ${toYear}
  GROUP BY YEAR(p.insurance_start_date)
)
SELECT
  signing_year,
  ROUND(year_premium, 2) AS year_premium,
  ROUND(year_claims, 2) AS year_claims,
  CASE
    WHEN year_premium > 0 THEN ROUND(year_claims * 100.0 / year_premium, 4)
    ELSE 0
  END AS year_loss_ratio_pct
FROM yearly
ORDER BY signing_year ASC
  `.trim();
}

/**
 * SQL C — New-business YoY signing-premium growth.
 *
 * Used to derive V2 (未来新签保费增速) percentile distribution. Calls
 * window function on signed-by-policy-date series for the past
 * historyWindowYears + 1 years (so we have N YoY growth values).
 */
export function generateYoYGrowthQuery(config: BaselineQueryConfig): string {
  const { cutoffDate, whereClause = '1=1', historyWindowYears } = config;
  const cutoffYear = Number.parseInt(cutoffDate.slice(0, 4), 10);
  // We need historyWindowYears + 1 years to derive that many YoY values.
  const fromYear = cutoffYear - historyWindowYears - 1;
  const toYear = cutoffYear - 1;

  return `
WITH ${dedupCte(whereClause, cutoffDate, ['policy_date'])},
yearly AS (
  SELECT
    YEAR(p.policy_date) AS year,
    SUM(p.premium) AS premium
  FROM policy_dedup p
  WHERE YEAR(p.policy_date) BETWEEN ${fromYear} AND ${toYear}
  GROUP BY YEAR(p.policy_date)
)
SELECT
  year,
  ROUND(premium, 2) AS year_premium,
  LAG(premium) OVER (ORDER BY year) AS prev_year_premium,
  CASE
    WHEN LAG(premium) OVER (ORDER BY year) > 0
      THEN ROUND((premium - LAG(premium) OVER (ORDER BY year)) * 100.0 / LAG(premium) OVER (ORDER BY year), 4)
    ELSE NULL
  END AS yoy_growth_pct
FROM yearly
ORDER BY year ASC
  `.trim();
}

/**
 * SQL D — Recent-months expense ratio for V4 (新签业务费用率).
 *
 * Returns a single row with the mean expense ratio over the trailing
 * recentExpenseMonths period. Expense ratios are confirmed at signing,
 * so a recent-months mean is a reasonable forward proxy.
 */
export function generateRecentExpenseRatioQuery(config: BaselineQueryConfig): string {
  const { cutoffDate, whereClause = '1=1', recentExpenseMonths } = config;

  return `
WITH ${dedupCte(whereClause, cutoffDate, ['policy_date'])}
SELECT
  ROUND(SUM(p.premium), 2) AS recent_signed_premium,
  ROUND(SUM(COALESCE(p.fee_amount, 0)), 2) AS recent_fee,
  CASE
    WHEN SUM(p.premium) > 0
      THEN ROUND(SUM(COALESCE(p.fee_amount, 0)) * 100.0 / SUM(p.premium), 4)
    ELSE 0
  END AS recent_expense_ratio_pct,
  CAST(COUNT(DISTINCT p.policy_no) AS BIGINT) AS recent_policy_count
FROM policy_dedup p
WHERE p.policy_date BETWEEN (DATE '${cutoffDate}' - INTERVAL '${recentExpenseMonths}' MONTH) AND DATE '${cutoffDate}'
  `.trim();
}
