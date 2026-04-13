/**
 * 保费趋势分析 SQL 生成器 — 按机构分组趋势查询
 *
 * 从 trend.ts 提取的 generatePremiumTrendQuery 函数。
 */

import { type TimeView, type ViewPerspective, type DateCriteria, generatePerspectiveWhere } from './shared.js';

/**
 * 生成保费趋势查询SQL（按机构分组）
 *
 * DC-001: 支持动态日期字段
 * V2.0: 支持视角切换
 *
 * @param timeView - 时间视图：daily/weekly/monthly
 * @param whereClause - WHERE子句（不包含WHERE关键字）
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @param perspective - 视角类型（默认 'premium'）
 * @returns SQL查询字符串
 *
 * 返回字段：
 * - time_period: 时间周期（日期/周/月）
 * - org_level_3: 三级机构
 * - premium: 聚合值（保费或件数，字段名保持premium以兼容现有代码）
 * - next_month_start_premium: 次月起保值（保费或件数）
 * - next_month_ratio: 当月内累计次月起保占比
 */
export function generatePremiumTrendQuery(
  timeView: TimeView,
  whereClause: string = '1=1',
  dateField: DateCriteria = 'policy_date',
  perspective: ViewPerspective = 'premium',
  groupDim: string = 'org_level_3'
): string {
  // DC-001: 使用动态日期字段（用于时间维度分组）
  const df = dateField;

  // V2.0: 添加视角WHERE条件（如果需要险类筛选）
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  // V2.0: 生成视角聚合表达式（不带AS，稍后在SELECT中添加）
  const valueAggregation = perspective === 'premium'
    ? 'SUM(premium)'
    : 'COUNT(*)';

  let timeDimension: string;
  let monthKeyDimension: string;
  let nextMonthCondition: string;
  let weekNumberExpression: string;

  switch (timeView) {
    case 'daily':
      // 按日统计
      timeDimension = `CAST(${df} AS VARCHAR)`;
      monthKeyDimension = `STRFTIME(${df}, '%Y-%m')`;
      // 次月起保：起保日期在签单日期的次月（同年同月+1，或下一年1月）
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
      // 计算逻辑：
      // 1. 第一周天数 = 8 - ISODOW(1月1日)
      // 2. 如果当天DOY <= 第一周天数，则周编号=1
      // 3. 否则周编号 = CEIL((DOY - 第一周天数) / 7) + 1
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
      // 次月起保：起保周在签单周的次月
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
      // 按月统计
      timeDimension = `STRFTIME(${df}, '%Y-%m')`;
      monthKeyDimension = `STRFTIME(${df}, '%Y-%m')`;
      // 次月起保：起保月在签单月的次月
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
        ${groupDim} AS org_level_3,
        -- Metric 1: Total Value (Bar Chart) - Full Week Sum
        ${valueAggregation} AS premium,

        -- Metric 2: Anchor Month Value (Ratio Denominator) - Filtered by Anchor Month
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

        -- Metric 3: Anchor Month Next Value (Ratio Numerator) - Filtered by Anchor Month AND Next Month Condition
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
      GROUP BY ${timeDimension}, ${monthKeyDimension}, ${groupDim}
    ),
    cumulative_stats AS (
      -- 计算截至当前时间维度的累积签单保费和次月起保保费
      SELECT
        time_period,
        month_key,
        org_level_3,
        premium,
        SUM(anchor_month_premium) OVER (
          PARTITION BY org_level_3, month_key
          ORDER BY time_period
          ROWS UNBOUNDED PRECEDING
        ) AS cumulative_premium,
        SUM(anchor_month_next_premium) OVER (
          PARTITION BY org_level_3, month_key
          ORDER BY time_period
          ROWS UNBOUNDED PRECEDING
        ) AS cumulative_next_month_premium
      FROM base_data
    )
    SELECT
      time_period,
      org_level_3,
      premium,
      0 AS next_month_start_premium,
      CASE
        WHEN cumulative_premium > 0 THEN
          cumulative_next_month_premium / cumulative_premium
        ELSE 0
      END AS next_month_ratio
    FROM cumulative_stats
    ORDER BY time_period, org_level_3
  `;
}
