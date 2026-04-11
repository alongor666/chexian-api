/**
 * 增长率分析 — 环比增长率查询
 *
 * 环比增长率 = (当期值 - 上一期值) / 上一期值
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { GrowthConfig, generateTimeExpression } from './shared.js';

/**
 * 生成环比增长率查询SQL
 * 环比增长率 = (当期值 - 上一期值) / 上一期值
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 增长率配置
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateMoMGrowthQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  const { timeView, metric = 'SUM(premium)', groupBy = [], whereClause = '1=1' } = config;
  // DC-001: 使用动态日期字段
  const timeExpression = generateTimeExpression(timeView, dateField);
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';

  return `
    WITH period_data AS (
      SELECT
        ${timeExpression} AS time_period,
        ${metric} AS value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY ${timeExpression}${groupByClause}
    ),
    lag_data AS (
      SELECT
        time_period,
        value,
        LAG(value) OVER (
          PARTITION BY ${groupBy.length > 0 ? groupBy.join(', ') : "'all'"}
          ORDER BY time_period
        ) AS previous_value
        ${groupByClause}
      FROM period_data
      ${groupBy.length > 0 ? '' : `CROSS JOIN (SELECT 'all' as all_dummy) dummy`}
    )
    SELECT
      time_period,
      value AS current_value,
      COALESCE(previous_value, 0) AS previous_value,
      CASE
        WHEN COALESCE(previous_value, 0) = 0 THEN NULL
        ELSE (value - COALESCE(previous_value, 0)) / previous_value
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.join(', ')}` : ''}
    FROM lag_data
    ORDER BY time_period
  `;
}
