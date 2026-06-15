/**
 * 增长率分析 — 同比增长率查询
 *
 * 同比增长率 = (当期值 - 去年同期值) / 去年同期值
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import {
  GrowthConfig,
  generateTimeExpression,
  generateShiftedTimeExpression,
} from './shared.js';

/**
 * 生成同比增长率查询SQL
 * 同比增长率 = (当期值 - 去年同期值) / 去年同期值
 *
 * DC-001: 支持动态日期字段
 *
 * 实现要点（7a2849 修复）：
 *   1) previous_period 直接把原始日期 +1 年再 DATE_TRUNC，保证 weekly 视图
 *      两侧落在同一周一边界（旧版 `DATE_TRUNC('week',date)` 之后用
 *      `DATE_ADD(p.time_period, INTERVAL '1 year')` 把周一偏到周二，
 *      永不匹配，整列 NULL/-100%）。
 *   2) 用 LEFT JOIN 而非 FULL OUTER JOIN —— FULL OUTER 在 previous 侧未匹配
 *      时输出 time_period=p.time_period（去年时点）、current=0、growth=-100%
 *      的幽灵行，对用户表现为"今年没数据"被报告为"-100% 增长"。
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
  const currentTimeExpr = generateTimeExpression(timeView, dateField);
  // 先位移再截断 —— weekly/monthly/quarterly 两侧边界对齐的关键
  const previousTimeExpr = generateShiftedTimeExpression(timeView, dateField, '1 year');
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';

  return `
    WITH current_period AS (
      SELECT
        ${currentTimeExpr} AS time_period,
        ${metric} AS current_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY ${currentTimeExpr}${groupByClause}
    ),
    previous_period AS (
      SELECT
        ${previousTimeExpr} AS time_period,
        ${metric} AS previous_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY ${previousTimeExpr}${groupByClause}
    )
    SELECT
      c.time_period AS time_period,
      c.current_value AS current_value,
      COALESCE(p.previous_value, 0) AS previous_value,
      CASE
        WHEN COALESCE(p.previous_value, 0) = 0 THEN NULL
        ELSE (c.current_value - COALESCE(p.previous_value, 0)) / p.previous_value
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.map(g => `c.${g} AS ${g}`).join(', ')}` : ''}
    FROM current_period c
    LEFT JOIN previous_period p ON
      c.time_period = p.time_period
      ${groupBy.length > 0 ? `AND ${groupBy.map(g => `c.${g} = p.${g}`).join(' AND ')}` : ''}
    ORDER BY time_period
  `;
}
