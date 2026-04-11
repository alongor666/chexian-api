/**
 * 增长率分析 — 双指标对比查询
 *
 * 同时返回保费和件数的当期/基期数据，用于双Y轴图表展示。
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';

/**
 * 双指标对比配置
 */
export interface DualMetricComparisonConfig {
  /** 当期开始日期 */
  currentStartDate: string;
  /** 当期结束日期 */
  currentEndDate: string;
  /** 基期开始日期 */
  previousStartDate: string;
  /** 基期结束日期 */
  previousEndDate: string;
  /** 分组字段 */
  groupBy?: string[];
  /** 附加WHERE条件 */
  whereClause?: string;
}

/**
 * 生成双指标对比查询（保费 + 件数）
 *
 * 同时返回保费和件数的当期/基期数据，用于双Y轴图表展示。
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 双指标对比配置
 * @param dateField - 日期字段（默认policy_date）
 * @returns SQL查询字符串
 *
 * @example
 * ```typescript
 * const sql = generateDualMetricComparisonQuery({
 *   currentStartDate: '2026-01-01',
 *   currentEndDate: '2026-01-31',
 *   previousStartDate: '2025-01-01',
 *   previousEndDate: '2025-01-31',
 *   groupBy: ['org_level_3']
 * });
 * ```
 */
export function generateDualMetricComparisonQuery(
  config: DualMetricComparisonConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  const {
    currentStartDate,
    currentEndDate,
    previousStartDate,
    previousEndDate,
    groupBy = ['org_level_3'],
    whereClause = '1=1'
  } = config;

  const df = dateField === 'insurance_start_date' ? 'start_date' : 'policy_date';
  const groupByClause = groupBy.length > 0 ? groupBy.join(', ') : "'all'";
  const groupBySelect = groupBy.length > 0
    ? groupBy.map(g => `${g}`).join(', ') + ','
    : '';

  return `
WITH current_data AS (
  SELECT
    ${groupBySelect}
    SUM(premium) AS current_premium,
    COUNT(*) AS current_count
  FROM PolicyFact
  WHERE ${whereClause}
    AND CAST(${df} AS DATE) >= '${currentStartDate}'
    AND CAST(${df} AS DATE) <= '${currentEndDate}'
  GROUP BY ${groupByClause}
),
previous_data AS (
  SELECT
    ${groupBySelect}
    SUM(premium) AS previous_premium,
    COUNT(*) AS previous_count
  FROM PolicyFact
  WHERE ${whereClause}
    AND CAST(${df} AS DATE) >= '${previousStartDate}'
    AND CAST(${df} AS DATE) <= '${previousEndDate}'
  GROUP BY ${groupByClause}
)
SELECT
  ${groupBy.length > 0
    ? groupBy.map(g => `COALESCE(c.${g}, p.${g}) AS ${g}`).join(',\n  ') + ','
    : "'all' AS dim_key,"}
  COALESCE(c.current_premium, 0) AS current_premium,
  COALESCE(p.previous_premium, 0) AS previous_premium,
  COALESCE(c.current_count, 0) AS current_count,
  COALESCE(p.previous_count, 0) AS previous_count,
  CASE
    WHEN COALESCE(p.previous_premium, 0) = 0 THEN NULL
    ELSE (COALESCE(c.current_premium, 0) - p.previous_premium) / p.previous_premium
  END AS premium_growth_rate,
  CASE
    WHEN COALESCE(p.previous_count, 0) = 0 THEN NULL
    ELSE (CAST(COALESCE(c.current_count, 0) AS DOUBLE) - p.previous_count) / p.previous_count
  END AS count_growth_rate
FROM current_data c
FULL OUTER JOIN previous_data p ON ${groupBy.length > 0
    ? groupBy.map(g => `c.${g} = p.${g}`).join(' AND ')
    : '1=1'}
ORDER BY COALESCE(c.current_premium, 0) DESC
`.trim();
}
