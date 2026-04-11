/**
 * 增长率分析 — 年累计增长率查询
 *
 * YTD增长率 = (今年累计 - 去年同期累计) / 去年同期累计
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { GrowthConfig, generateTimeExpression } from './shared.js';

/**
 * 生成年累计增长率查询SQL
 * YTD增长率 = (今年累计 - 去年同期累计) / 去年同期累计
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 增长率配置
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateYTDGrowthQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  const { timeView = 'monthly', metric = 'SUM(premium)', groupBy = [], whereClause = '1=1' } = config;
  // DC-001: 使用动态日期字段
  const df = dateField;
  const timeExpression = generateTimeExpression(timeView, dateField);
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';

  return `
    WITH yearly_data AS (
      SELECT
        EXTRACT(YEAR FROM CAST(${df} AS DATE)) AS year,
        ${timeExpression} AS time_period,
        ${metric} AS value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY year, ${timeExpression}${groupByClause}
    ),
    cumulative_data AS (
      SELECT
        year,
        time_period,
        value,
        SUM(value) OVER (
          PARTITION BY year${groupBy.length > 0 ? `, ${groupBy.join(', ')}` : ''}
          ORDER BY time_period
          ROWS UNBOUNDED PRECEDING
        ) AS cumulative_value
        ${groupByClause}
      FROM yearly_data
    ),
    current_ytd AS (
      SELECT
        time_period,
        cumulative_value AS current_cumulative
        ${groupByClause}
      FROM cumulative_data
      -- DC-002 Exception: YTD查询需要动态获取"当前年份"，使用CURRENT_DATE是合法的
      -- 未来应从filters.analysis_year读取，但需修改函数签名（影响调用方）
      WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)
    ),
    previous_ytd AS (
      SELECT
        DATE_ADD(time_period, INTERVAL '1 year') AS time_period,
        cumulative_value AS previous_cumulative
        ${groupByClause}
      FROM cumulative_data
      -- DC-002 Exception: YTD查询需要动态获取"去年年份"，使用CURRENT_DATE是合法的
      WHERE year = EXTRACT(YEAR FROM CURRENT_DATE) - 1
    )
    SELECT
      COALESCE(c.time_period, p.time_period) AS time_period,
      COALESCE(c.current_cumulative, 0) AS current_value,
      COALESCE(p.previous_cumulative, 0) AS previous_value,
      CASE
        WHEN COALESCE(p.previous_cumulative, 0) = 0 THEN NULL
        ELSE (COALESCE(c.current_cumulative, 0) - COALESCE(p.previous_cumulative, 0)) / p.previous_cumulative
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.map(g => `COALESCE(c.${g}, p.${g}) AS ${g}`).join(', ')}` : ''}
    FROM current_ytd c
    FULL OUTER JOIN previous_ytd p ON c.time_period = p.time_period
      ${groupBy.length > 0 ? `AND ${groupBy.map(g => `c.${g} = p.${g}`).join(' AND ')}` : ''}
    ORDER BY time_period
  `;
}
