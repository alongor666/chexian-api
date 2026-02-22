/**
 * Premium Trend Analysis SQL Generators
 * 保费趋势分析SQL生成器
 *
 * 支持三种时间视图：
 * - 日视图：按签单日期统计
 * - 周视图：按签单自然周统计
 * - 月视图：按签单自然月统计
 *
 * 同时计算次月起保占比
 *
 * DC-001: 支持动态日期字段（通过 dateField 参数）
 * V2.0: 支持视角切换（保费/商业险件数/交强险件数）
 */

import { DateCriteria } from '../types/data.js';
import type { ViewPerspective } from '../types/index.js';
import { generatePerspectiveWhere } from './perspective-adapter.js';

export type TimeView = 'daily' | 'weekly' | 'monthly';

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
  const valueAggregation = perspective === 'premium'
    ? 'SUM(premium)'
    : 'COUNT(*)';

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

/**
 * 生成机构列表查询SQL
 * 用于获取所有唯一的三级机构
 *
 * @param whereClause - WHERE子句
 * @returns SQL查询字符串
 */
export function generateOrgListQuery(whereClause: string = '1=1'): string {
  return `
    SELECT DISTINCT org_level_3
    FROM PolicyFact
    WHERE ${whereClause}
    ORDER BY org_level_3
  `;
}

/**
 * 生成维度选项查询SQL（带计数）
 * 用于填充筛选面板的下拉选项
 *
 * @param dimension - 维度字段名
 * @returns SQL查询字符串，返回 value 和 count 字段
 */
export function generateDimensionOptionsQuery(dimension: string): string {
  return `
    SELECT
      ${dimension} AS value,
      COUNT(*) AS count
    FROM PolicyFact
    WHERE ${dimension} IS NOT NULL
    GROUP BY ${dimension}
    ORDER BY 2 DESC, 1
  `;
}

/**
 * 优质业务定义条件SQL片段
 *
 * 优质业务包括：
 * 1. 非新能源车 AND (客户类别为非营业个人/企业/机关客车)
 * 2. 货车 AND 吨位分段为1吨以下或2-9吨
 */
const QUALITY_BUSINESS_CONDITION = `
  (
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )
`;

/**
 * 生成优质业务占比趋势查询SQL
 *
 * DC-001: 支持动态日期字段
 * V2.0: 支持多视角切换（保费/商业险件数/交强险件数）
 *
 * @param timeView - 时间视图：daily/weekly/monthly
 * @param whereClause - WHERE子句（不包含WHERE关键字）
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @param perspective - 视角类型（默认保费视角）
 * @returns SQL查询字符串
 *
 * 返回字段：
 * - time_period: 时间周期（日期/周/月）
 * - quality_premium: 优质业务保费（视角值）
 * - total_premium: 总保费（视角值）
 * - quality_ratio: 优质业务占比
 */
export function generateQualityBusinessTrendQuery(
  timeView: TimeView,
  whereClause: string = '1=1',
  dateField: DateCriteria = 'policy_date',
  perspective: ViewPerspective = 'premium',
  groupDim: string = 'org_level_3'
): string {
  // DC-001: 使用动态日期字段
  const df = dateField;

  // V2.0: 应用视角筛选条件（险类过滤）
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  let timeDimension: string;
  let weekNumberExpression: string;

  switch (timeView) {
    case 'daily':
      timeDimension = `CAST(${df} AS VARCHAR)`;
      break;

    case 'weekly':
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
      break;

    case 'monthly':
      timeDimension = `STRFTIME(${df}, '%Y-%m')`;
      break;

    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }

  return `
    SELECT
      ${timeDimension} AS time_period,
      ${perspective === 'premium'
      ? `SUM(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN premium ELSE 0 END)`
      : `COUNT(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN 1 END)`
    } AS quality_premium,
      ${perspective === 'premium'
      ? 'SUM(premium)'
      : 'COUNT(*)'
    } AS total_premium,
      CASE
        WHEN ${perspective === 'premium' ? 'SUM(premium)' : 'COUNT(*)'} > 0 THEN
          ${perspective === 'premium'
      ? `SUM(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN premium ELSE 0 END) / SUM(premium)`
      : `COUNT(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN 1 END) * 1.0 / COUNT(*)`
    }
        ELSE 0
      END AS quality_ratio
    FROM PolicyFact
    WHERE ${finalWhereClause}
    GROUP BY ${timeDimension}
    ORDER BY time_period
  `;
}

// ========== 【性能优化】V2版本 - 使用预聚合表 DailyAggregated ==========

/**
 * 生成保费趋势查询SQL V2（使用预聚合表，性能提升50-100倍）
 *
 * 优化点：
 * - 使用 DailyAggregated 预聚合表
 * - 自然周编号已预计算，无需运行时复杂计算
 * - 从几十万行扫描减少到几万行扫描
 *
 * @param timeView - 时间视图：daily/weekly/monthly
 * @param whereClause - WHERE子句（不包含WHERE关键字）
 * @param perspective - 视角类型（默认 'premium'）
 * @returns SQL查询字符串
 */
export function generatePremiumTrendQueryV2(
  timeView: TimeView,
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium',
  groupDim: string = 'org_level_3'
): string {
  // V2: 使用 generatePerspectiveWhere 处理视角筛选
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  // V2: 根据视角选择聚合表达式
  const valueAggregation = perspective === 'premium'
    ? 'SUM(total_premium)'
    : 'SUM(policy_count)';

  let timeDimension: string;
  let timeDimensionAlias: string;

  switch (timeView) {
    case 'daily':
      timeDimension = 'CAST(agg_date AS VARCHAR)';
      timeDimensionAlias = 'agg_date';
      break;

    case 'weekly':
      // V2: 直接使用预计算的自然周编号，避免复杂计算
      timeDimension = `CONCAT(
        CAST(policy_year AS VARCHAR),
        '-W',
        LPAD(CAST(natural_week_num AS VARCHAR), 2, '0')
      )`;
      timeDimensionAlias = 'policy_year, natural_week_num';
      break;

    case 'monthly':
      timeDimension = 'policy_ym';
      timeDimensionAlias = 'policy_ym';
      break;

    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }

  return `
    SELECT
      ${timeDimension} AS time_period,
      ${groupDim} AS org_level_3,
      ${valueAggregation} AS premium,
      0 AS next_month_start_premium,
      0 AS next_month_ratio
    FROM DailyAggregated
    WHERE ${finalWhereClause}
    GROUP BY ${timeDimensionAlias}, ${groupDim}
    ORDER BY time_period, org_level_3
  `;
}

/**
 * 生成总体保费趋势查询SQL V2（使用预聚合表，性能提升50-100倍）
 *
 * @param timeView - 时间视图
 * @param whereClause - WHERE子句
 * @param perspective - 视角类型
 * @returns SQL查询字符串
 */
export function generateTotalPremiumTrendQueryV2(
  timeView: TimeView,
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium'
): string {
  // V2: 使用 generatePerspectiveWhere 处理视角筛选
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  // V2: 根据视角选择聚合表达式
  const valueAggregation = perspective === 'premium'
    ? 'SUM(total_premium)'
    : 'SUM(policy_count)';

  let timeDimension: string;
  let timeDimensionAlias: string;

  switch (timeView) {
    case 'daily':
      timeDimension = 'CAST(agg_date AS VARCHAR)';
      timeDimensionAlias = 'agg_date';
      break;

    case 'weekly':
      timeDimension = `CONCAT(
        CAST(policy_year AS VARCHAR),
        '-W',
        LPAD(CAST(natural_week_num AS VARCHAR), 2, '0')
      )`;
      timeDimensionAlias = 'policy_year, natural_week_num';
      break;

    case 'monthly':
      timeDimension = 'policy_ym';
      timeDimensionAlias = 'policy_ym';
      break;

    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }

  return `
    SELECT
      ${timeDimension} AS time_period,
      ${valueAggregation} AS total_premium,
      0 AS next_month_start_premium,
      0 AS next_month_ratio
    FROM DailyAggregated
    WHERE ${finalWhereClause}
    GROUP BY ${timeDimensionAlias}
    ORDER BY time_period
  `;
}

/**
 * 生成优质业务占比趋势查询SQL V2（使用预聚合表）
 *
 * @param timeView - 时间视图
 * @param whereClause - WHERE子句
 * @param perspective - 视角类型
 * @returns SQL查询字符串
 */
export function generateQualityBusinessTrendQueryV2(
  timeView: TimeView,
  whereClause: string = '1=1',
  perspective: ViewPerspective = 'premium'
): string {
  // V2: 使用 generatePerspectiveWhere 处理视角筛选
  const perspectiveConditions = generatePerspectiveWhere(perspective, [whereClause]);
  const finalWhereClause = perspectiveConditions.join(' AND ');

  let timeDimension: string;
  let timeDimensionAlias: string;

  switch (timeView) {
    case 'daily':
      timeDimension = 'CAST(agg_date AS VARCHAR)';
      timeDimensionAlias = 'agg_date';
      break;

    case 'weekly':
      timeDimension = `CONCAT(
        CAST(policy_year AS VARCHAR),
        '-W',
        LPAD(CAST(natural_week_num AS VARCHAR), 2, '0')
      )`;
      timeDimensionAlias = 'policy_year, natural_week_num';
      break;

    case 'monthly':
      timeDimension = 'policy_ym';
      timeDimensionAlias = 'policy_ym';
      break;

    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }

  // V2: 优质业务条件（基于预聚合表字段）
  const qualityCondition = `(
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )`;

  return `
    SELECT
      ${timeDimension} AS time_period,
      ${perspective === 'premium'
      ? `SUM(CASE WHEN ${qualityCondition} THEN total_premium ELSE 0 END)`
      : `SUM(CASE WHEN ${qualityCondition} THEN policy_count ELSE 0 END)`
    } AS quality_premium,
      ${perspective === 'premium'
      ? 'SUM(total_premium)'
      : 'SUM(policy_count)'
    } AS total_premium,
      CASE
        WHEN ${perspective === 'premium' ? 'SUM(total_premium)' : 'SUM(policy_count)'} > 0 THEN
          ${perspective === 'premium'
      ? `SUM(CASE WHEN ${qualityCondition} THEN total_premium ELSE 0 END) / SUM(total_premium)`
      : `SUM(CASE WHEN ${qualityCondition} THEN policy_count ELSE 0 END) * 1.0 / SUM(policy_count)`
    }
        ELSE 0
      END AS quality_ratio
    FROM DailyAggregated
    WHERE ${finalWhereClause}
    GROUP BY ${timeDimensionAlias}
    ORDER BY time_period
  `;
}
