/**
 * 增长率分析 — 同比增长率查询
 *
 * 同比增长率 = (当期值 - 去年同期值) / 去年同期值
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { GrowthConfig, generateTimeExpression } from './shared.js';

/**
 * 生成同比增长率查询SQL
 * 同比增长率 = (当期值 - 去年同期值) / 去年同期值
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 增长率配置
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateYoYGrowthQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  const { timeView, metric = 'SUM(premium)', groupBy = [], whereClause = '1=1' } = config;
  // DC-001: 使用动态日期字段
  const timeExpression = generateTimeExpression(timeView, dateField);
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';

  return `
    WITH current_period AS (
      SELECT
        ${timeExpression} AS time_period,
        ${metric} AS current_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY ${timeExpression}${groupByClause}
    ),
    previous_period AS (
      SELECT
        ${timeExpression} AS time_period,
        ${metric} AS previous_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY ${timeExpression}${groupByClause}
    )
    SELECT
      COALESCE(c.time_period, p.time_period) AS time_period,
      COALESCE(c.current_value, 0) AS current_value,
      COALESCE(p.previous_value, 0) AS previous_value,
      CASE
        WHEN COALESCE(p.previous_value, 0) = 0 THEN NULL
        ELSE (COALESCE(c.current_value, 0) - COALESCE(p.previous_value, 0)) / p.previous_value
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.map(g => `COALESCE(c.${g}, p.${g}) AS ${g}`).join(', ')}` : ''}
    FROM current_period c
    FULL OUTER JOIN previous_period p ON
      c.time_period = DATE_ADD(p.time_period, INTERVAL '1 year')
      ${groupBy.length > 0 ? `AND ${groupBy.map(g => `c.${g} = p.${g}`).join(' AND ')}` : ''}
    ORDER BY time_period
  `;
}
