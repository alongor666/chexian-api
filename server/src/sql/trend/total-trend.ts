/**
 * 保费趋势分析 SQL 生成器 — 总体趋势查询
 *
 * 从 trend.ts 提取的 generateTotalPremiumTrendQuery 函数。
 */

import { type TimeView, type ViewPerspective, type DateCriteria, generatePerspectiveWhere } from './shared.js';

/**
 * 生成总体保费趋势查询SQL（不分机构）
 *
 * DC-001: 支持动态日期字段
 * V2.0: 支持多视角切换（保费/商业险件数/交强险件数）
 *
 * @param timeView - 时间视图
 * @param whereClause - WHERE子句
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @param perspective - 视角类型（默认保费视角）
 * @returns SQL查询字符串
 *
 * 返回字段：
 * - time_period: 时间周期
 * - total_premium: 总签单保费（视角值）
 * - next_month_start_premium: 次月起保保费
 * - next_month_ratio: 当月内累计次月起保占比
 */
export function generateTotalPremiumTrendQuery(
  timeView: TimeView,
  whereClause: string = '1=1',
  dateField: DateCriteria = 'policy_date',
  perspective: ViewPerspective = 'premium'
): string {
  // DC-001: 使用动态日期字段
  const df = dateField;

  // V2.0: 应用视角筛选条件（险类过滤）
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  // V2.0: 根据视角选择聚合表达式
  // 件数口径 COUNT(DISTINCT policy_no)（原 COUNT(*) 把批改多行各计一件，虚增约 4-5%），对齐 truck.ts/cost-ratios.ts
  const valueAggregation = perspective === 'premium'
    ? 'SUM(premium)'
    : 'COUNT(DISTINCT policy_no)';

  let timeDimension: string;
  let monthKeyDimension: string;
  let nextMonthCondition: string;
  let weekNumberExpression: string;

  switch (timeView) {
    case 'daily':
      timeDimension = `CAST(${df} AS VARCHAR)`;
      monthKeyDimension = `STRFTIME(${df}, '%Y-%m')`;
      nextMonthCondition = `
        (EXTRACT(YEAR FROM insurance_start_date) = EXTRACT(YEAR FROM ${df})
         AND EXTRACT(MONTH FROM insurance_start_date) = EXTRACT(MONTH FROM ${df}) + 1)
        OR
        (EXTRACT(YEAR FROM insurance_start_date) = EXTRACT(YEAR FROM ${df}) + 1
         AND EXTRACT(MONTH FROM ${df}) = 12
         AND EXTRACT(MONTH FROM insurance_start_date) = 1)
      `;
      break;

    case 'weekly':
      // 按自然周统计（自定义周逻辑：第一周从1月1日开始到第一个周一前一天）
      weekNumberExpression = `
        CASE
          WHEN DAYOFYEAR(${df}) <= (8 - ISODOW(DATE_TRUNC('year', ${df})))
          THEN 1
          ELSE CAST(CEIL((DAYOFYEAR(${df}) - (8 - ISODOW(DATE_TRUNC('year', ${df})))) / 7.0) AS INTEGER) + 1
        END
      `;
      timeDimension = `CONCAT(
        CAST(YEAR(${df}) AS VARCHAR),
        '-W',
        LPAD(
          CAST(
            ${weekNumberExpression} AS VARCHAR
          ),
          2,
          '0'
        )
      )`;
      monthKeyDimension = `
        STRFTIME(
          CASE
            WHEN ${weekNumberExpression} = 1
            THEN CAST(DATE_TRUNC('year', ${df}) AS DATE)
            ELSE CAST(DATE_TRUNC('year', ${df}) AS DATE)
              + INTERVAL '1 day' * (
                (8 - ISODOW(DATE_TRUNC('year', ${df})))
                + (${weekNumberExpression} - 2) * 7
                + 1
              )
          END,
          '%Y-%m'
        )
      `;
      nextMonthCondition = `
        (YEAR(insurance_start_date) = YEAR(${df})
         AND MONTH(insurance_start_date) = MONTH(${df}) + 1)
        OR
        (YEAR(insurance_start_date) = YEAR(${df}) + 1
         AND MONTH(${df}) = 12
         AND MONTH(insurance_start_date) = 1)
      `;
      break;

    case 'monthly':
      timeDimension = `STRFTIME(${df}, '%Y-%m')`;
      monthKeyDimension = `STRFTIME(${df}, '%Y-%m')`;
      nextMonthCondition = `
        (YEAR(insurance_start_date) = YEAR(${df})
         AND MONTH(insurance_start_date) = MONTH(${df}) + 1)
        OR
        (YEAR(insurance_start_date) = YEAR(${df}) + 1
         AND MONTH(${df}) = 12
         AND MONTH(insurance_start_date) = 1)
      `;
      break;

    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }

  return `
    WITH base_data AS (
      SELECT
        ${timeDimension} AS time_period,
        ${monthKeyDimension} AS month_key,
        -- Metric 1: Total Premium (Bar Chart) - Full Week Sum
        ${valueAggregation} AS total_premium,

        -- Metric 2: Anchor Month Premium (Ratio Denominator) - Filtered by Anchor Month
        ${perspective === 'premium'
      ? `SUM(CASE
            WHEN STRFTIME(${df}, '%Y-%m') = ${monthKeyDimension}
            THEN premium
            ELSE 0
          END)`
      : `COUNT(CASE
            WHEN STRFTIME(${df}, '%Y-%m') = ${monthKeyDimension}
            THEN 1
          END)`
    } AS anchor_month_premium,

        -- Metric 3: Anchor Month Next Premium (Ratio Numerator) - Filtered by Anchor Month AND Next Month Condition
        ${perspective === 'premium'
      ? `SUM(CASE
            WHEN STRFTIME(${df}, '%Y-%m') = ${monthKeyDimension}
                 AND (${nextMonthCondition})
            THEN premium
            ELSE 0
          END)`
      : `COUNT(CASE
            WHEN STRFTIME(${df}, '%Y-%m') = ${monthKeyDimension}
                 AND (${nextMonthCondition})
            THEN 1
          END)`
    } AS anchor_month_next_premium
      FROM PolicyFact
      WHERE ${finalWhereClause}
      GROUP BY ${timeDimension}, ${monthKeyDimension}
    ),
    cumulative_stats AS (
      -- 计算截至当前时间维度的累积签单保费和次月起保保费
      SELECT
        time_period,
        month_key,
        total_premium,
        SUM(anchor_month_premium) OVER (
          PARTITION BY month_key
          ORDER BY time_period
          ROWS UNBOUNDED PRECEDING
        ) AS cumulative_premium,
        SUM(anchor_month_next_premium) OVER (
          PARTITION BY month_key
          ORDER BY time_period
          ROWS UNBOUNDED PRECEDING
        ) AS cumulative_next_month_premium
      FROM base_data
    )
    SELECT
      time_period,
      total_premium,
      0 AS next_month_start_premium,
      CASE
        WHEN cumulative_premium > 0 THEN
          cumulative_next_month_premium / cumulative_premium
        ELSE 0
      END AS next_month_ratio
    FROM cumulative_stats
    ORDER BY time_period
  `;
}
