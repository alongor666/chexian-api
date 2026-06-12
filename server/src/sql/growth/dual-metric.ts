/**
 * 增长率分析 — 双指标（保费 + 件数）自定义期间对比
 *
 * 与 custom.ts 的 generateCustomGrowthQuery（单指标，输出 current_value/previous_value）不同：
 * 本生成器同时聚合 SUM(premium) 与 COUNT(*)，按 groupBy 维度分组，输出前端
 * DualMetricComparisonData 期望的列名：
 *   dim_key / current_premium / previous_premium / current_count / previous_count
 *   / premium_growth_rate / count_growth_rate
 *
 * 日期由 currentPeriod / baselinePeriod 控制（whereClause 中不含日期条件），
 * 与 custom 单指标路径保持一致。
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { buildDateCondition } from '../../utils/sql-sanitizer.js';
import { GrowthConfig } from './shared.js';

/**
 * 生成双指标对比查询 SQL
 *
 * @param config - 增长率配置（必须含 currentPeriod / baselinePeriod / 至少 1 个 groupBy 维度）
 * @param dateField - 可选日期字段覆盖（默认 'policy_date'）
 * @returns SQL 查询字符串
 */
export function generateDualMetricComparisonQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  if (!config.currentPeriod || !config.baselinePeriod) {
    throw new Error('Dual-metric comparison requires both currentPeriod and baselinePeriod');
  }

  const { groupBy = [], whereClause = '1=1' } = config;
  if (groupBy.length === 0) {
    throw new Error('Dual-metric comparison requires at least one groupBy dimension');
  }

  const df = dateField;
  const groupByList = groupBy.join(', ');
  // FULL OUTER JOIN 下某维度可能只在一侧出现 → 用 COALESCE(c.g, b.g) 取分组键
  const dimKeyExpr = groupBy.map((g) => `COALESCE(c.${g}, b.${g})`).join(" || ' - ' || ");
  const joinCond = groupBy.map((g) => `c.${g} = b.${g}`).join(' AND ');

  // 注意：COUNT 返回 BIGINT，件数增长率分子必须 CAST 为 DOUBLE，
  // 否则 (BIGINT - BIGINT) / BIGINT 触发整数除法向下取整，丢失小数。
  // 件数口径 COUNT(DISTINCT policy_no)：原 COUNT(*) 把批改多行各计一件（虚增约 4-5%），
  // 对齐 truck.ts / cost-ratios.ts 全局件数口径。
  return `
    WITH baseline_data AS (
      SELECT
        SUM(premium) AS baseline_premium,
        COUNT(DISTINCT policy_no) AS baseline_count,
        ${groupByList}
      FROM PolicyFact
      WHERE ${whereClause}
        AND ${buildDateCondition(df, '>=', config.baselinePeriod.startDate)}
        AND ${buildDateCondition(df, '<=', config.baselinePeriod.endDate)}
      GROUP BY ${groupByList}
    ),
    current_data AS (
      SELECT
        SUM(premium) AS current_premium,
        COUNT(DISTINCT policy_no) AS current_count,
        ${groupByList}
      FROM PolicyFact
      WHERE ${whereClause}
        AND ${buildDateCondition(df, '>=', config.currentPeriod.startDate)}
        AND ${buildDateCondition(df, '<=', config.currentPeriod.endDate)}
      GROUP BY ${groupByList}
    )
    SELECT
      ${dimKeyExpr} AS dim_key,
      COALESCE(c.current_premium, 0) AS current_premium,
      COALESCE(b.baseline_premium, 0) AS previous_premium,
      COALESCE(c.current_count, 0) AS current_count,
      COALESCE(b.baseline_count, 0) AS previous_count,
      CASE
        WHEN COALESCE(b.baseline_premium, 0) = 0 THEN NULL
        ELSE (COALESCE(c.current_premium, 0) - b.baseline_premium) / b.baseline_premium
      END AS premium_growth_rate,
      CASE
        WHEN COALESCE(b.baseline_count, 0) = 0 THEN NULL
        ELSE (CAST(COALESCE(c.current_count, 0) AS DOUBLE) - b.baseline_count) / b.baseline_count
      END AS count_growth_rate
    FROM current_data c
    FULL OUTER JOIN baseline_data b ON ${joinCond}
    ORDER BY current_premium DESC
  `;
}
