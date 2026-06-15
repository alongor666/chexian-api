/**
 * 增长率分析 — 年累计增长率查询
 *
 * YTD增长率 = (今年累计 - 去年同期累计) / 去年同期累计
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { GrowthConfig, generateTimeExpression, timeViewToTruncUnit } from './shared.js';

/**
 * 生成年累计增长率查询SQL
 * YTD增长率 = (今年累计 - 去年同期累计) / 去年同期累计
 *
 * DC-001: 支持动态日期字段
 *
 * 实现要点（7a2849 修复）：
 *   1) previous_ytd 在做完 DATE_ADD(+1 year) 之后必须 DATE_TRUNC 回当前粒度，
 *      否则 weekly 视图下"周一+1 年"落到周二，与 current_ytd 的周一边界
 *      永远不等，整列输出 NULL/-100% 幽灵行（monthly/quarterly/yearly
 *      因为本就对齐年首/季首/月首，重新截断是 no-op；daily 在闰年 2-29 上
 *      的小漂移也由此规整）。
 *   2) 改 FULL OUTER JOIN → LEFT JOIN —— 旧版在去年累计有数据但今年同期
 *      尚无数据时（半年报跑全年比较的常见情况）输出幽灵 -100% 行；YTD 报告
 *      只应展示当年已有的累计期间。
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
  const truncUnit = timeViewToTruncUnit(timeView);
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
        -- 7a2849: +1 年后必须按当前粒度重新 DATE_TRUNC，否则 weekly 永不对齐
        DATE_TRUNC('${truncUnit}', time_period + INTERVAL '1 year') AS time_period,
        cumulative_value AS previous_cumulative
        ${groupByClause}
      FROM cumulative_data
      -- DC-002 Exception: YTD查询需要动态获取"去年年份"，使用CURRENT_DATE是合法的
      WHERE year = EXTRACT(YEAR FROM CURRENT_DATE) - 1
    )
    SELECT
      c.time_period AS time_period,
      c.current_cumulative AS current_value,
      COALESCE(p.previous_cumulative, 0) AS previous_value,
      CASE
        WHEN COALESCE(p.previous_cumulative, 0) = 0 THEN NULL
        ELSE (c.current_cumulative - COALESCE(p.previous_cumulative, 0)) / p.previous_cumulative
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.map(g => `c.${g} AS ${g}`).join(', ')}` : ''}
    FROM current_ytd c
    LEFT JOIN previous_ytd p ON c.time_period = p.time_period
      ${groupBy.length > 0 ? `AND ${groupBy.map(g => `c.${g} = p.${g}`).join(' AND ')}` : ''}
    ORDER BY time_period
  `;
}
