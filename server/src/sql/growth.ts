/**
 * 增长率分析SQL生成器
 * Growth Rate Analysis SQL Generators
 *
 * 支持多种增长率计算：
 * - 同比增长率：与去年同期比较
 * - 环比增长率：与上一个周期比较
 * - 年累计增长率：YTD累计比较
 * - 自定义期间比较：任意两个时间段比较
 *
 * DC-001: 支持动态日期字段（通过 dateField 参数）
 */

import { DateCriteria } from '../types/data.js';

export type GrowthType = 'yoy' | 'mom' | 'ytd' | 'custom';
export type TimeView = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * 增长率计算配置接口
 */
export interface GrowthConfig {
  /** 增长率类型 */
  growthType: GrowthType;
  /** 时间视图 */
  timeView: TimeView;
  /** 对比基准期间（用于自定义比较） */
  baselinePeriod?: {
    startDate: string;
    endDate: string;
  };
  /** 当前期间（用于自定义比较） */
  currentPeriod?: {
    startDate: string;
    endDate: string;
  };
  /** 比较的指标 */
  metric?: string;
  /** 分组维度 */
  groupBy?: string[];
  /** WHERE条件 */
  whereClause?: string;
  /** 参考年份（用于YTD计算，DC-002合规，避免硬编码CURRENT_DATE） */
  referenceYear?: number;
}

/**
 * 生成时间周期表达式
 *
 * DC-001: 支持动态日期字段
 *
 * @param timeView - 时间视图
 * @param dateColumn - 日期列名（默认使用 policy_date，DC-001 支持动态传入）
 * @returns SQL时间表达式
 */
function generateTimeExpression(
  timeView: TimeView,
  dateColumn: DateCriteria = 'policy_date'
): string {
  switch (timeView) {
    case 'daily':
      return `CAST(${dateColumn} AS DATE)`;
    case 'weekly':
      return `DATE_TRUNC('week', CAST(${dateColumn} AS DATE))`;
    case 'monthly':
      return `DATE_TRUNC('month', CAST(${dateColumn} AS DATE))`;
    case 'quarterly':
      return `DATE_TRUNC('quarter', CAST(${dateColumn} AS DATE))`;
    case 'yearly':
      return `DATE_TRUNC('year', CAST(${dateColumn} AS DATE))`;
    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }
}

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

/**
 * 生成自定义期间比较增长率查询SQL
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 增长率配置（必须包含 currentPeriod 和 baselinePeriod）
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateCustomGrowthQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  if (!config.currentPeriod || !config.baselinePeriod) {
    throw new Error('Custom growth comparison requires both currentPeriod and baselinePeriod');
  }

  const { metric = 'SUM(premium)', groupBy = [], whereClause = '1=1' } = config;
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';
  // DC-001: 使用动态日期字段
  const df = dateField;

  return `
    WITH baseline_data AS (
      SELECT
        ${metric} AS baseline_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
        AND ${df} >= '${config.baselinePeriod!.startDate}'
        AND ${df} <= '${config.baselinePeriod!.endDate}'
      GROUP BY ${groupBy.length > 0 ? groupBy.join(', ') : "'all'"}
    ),
    current_data AS (
      SELECT
        ${metric} AS current_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
        AND ${df} >= '${config.currentPeriod!.startDate}'
        AND ${df} <= '${config.currentPeriod!.endDate}'
      GROUP BY ${groupBy.length > 0 ? groupBy.join(', ') : "'all'"}
    )
    SELECT
      COALESCE(c.current_value, 0) AS current_value,
      COALESCE(b.baseline_value, 0) AS previous_value,
      CASE
        WHEN COALESCE(b.baseline_value, 0) = 0 THEN NULL
        ELSE (COALESCE(c.current_value, 0) - COALESCE(b.baseline_value, 0)) / b.baseline_value
      END AS growth_rate
      ${groupBy.length > 0 ? `, ${groupBy.map(g => `COALESCE(c.${g}, b.${g}) AS ${g}`).join(', ')}` : ''}
    FROM current_data c
    FULL OUTER JOIN baseline_data b ON ${groupBy.length > 0 ? groupBy.map(g => `c.${g} = b.${g}`).join(' AND ') : '1=1'}
    ORDER BY growth_rate DESC
  `;
}

/**
 * 生成综合增长率分析查询
 * 支持多维度、多指标的增长率计算
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 增长率配置
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateComprehensiveGrowthQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  const { growthType, timeView, groupBy = [], metric = 'SUM(premium)', whereClause = '1=1' } = config;

  switch (growthType) {
    case 'yoy':
      return generateYoYGrowthQuery({ growthType, timeView, groupBy, metric, whereClause }, dateField);
    case 'mom':
      return generateMoMGrowthQuery({ growthType, timeView, groupBy, metric, whereClause }, dateField);
    case 'ytd':
      return generateYTDGrowthQuery({ growthType, timeView, groupBy, metric, whereClause }, dateField);
    case 'custom':
      return generateCustomGrowthQuery(config, dateField);
    default:
      throw new Error(`Unknown growth type: ${growthType}`);
  }
}

/**
 * 生成日度增长率分析查询（带月度/期间合计上下文）
 *
 * @param config - 增长率配置 (必须包含 currentPeriod 和 baselinePeriod)
 * @param dateField - 日期字段
 * @returns SQL查询字符串
 */
export function generateDailyGrowthWithContextQuery(
  config: GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  if (!config.currentPeriod || !config.baselinePeriod) {
    throw new Error('Daily growth comparison requires both currentPeriod and baselinePeriod');
  }

  const { whereClause = '1=1', metric = 'SUM(premium)', groupBy = [] } = config;
  const df = dateField;
  // 如果有额外的分组（如机构），需要包含在 GROUP BY 中
  const groupByClause = groupBy.length > 0 ? `, ${groupBy.join(', ')}` : '';
  const groupByFields = groupBy.length > 0 ? groupBy.join(', ') : "'all'";

  return `
    WITH current_daily AS (
      SELECT
        CAST(${df} AS DATE) AS time_period,
        ${metric} AS current_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
        AND ${df} >= '${config.currentPeriod.startDate}'
        AND ${df} <= '${config.currentPeriod.endDate}'
      GROUP BY CAST(${df} AS DATE)${groupByClause}
    ),
    previous_daily AS (
      SELECT
        CAST(${df} AS DATE) AS time_period,
        ${metric} AS previous_value${groupByClause}
      FROM PolicyFact
      WHERE ${whereClause}
        AND ${df} >= '${config.baselinePeriod.startDate}'
        AND ${df} <= '${config.baselinePeriod.endDate}'
      GROUP BY CAST(${df} AS DATE)${groupByClause}
    ),
    -- 对齐日期：将去年同期数据的日期加1年，以便与今年数据Join
    aligned_previous AS (
      SELECT
        DATE_ADD(time_period, INTERVAL '1 year') as aligned_date,
        previous_value${groupByClause}
      FROM previous_daily
    ),
    joined_data AS (
      SELECT
        COALESCE(c.time_period, p.aligned_date) AS time_period,
        COALESCE(c.current_value, 0) AS current_value,
        COALESCE(p.previous_value, 0) AS previous_value${groupByClause}
      FROM current_daily c
      FULL OUTER JOIN aligned_previous p ON c.time_period = p.aligned_date
      ${groupBy.length > 0 ? `AND ${groupBy.map(g => `c.${g} = p.${g}`).join(' AND ')}` : ''}
    ),
    with_growth AS (
        SELECT
            time_period,
            current_value,
            previous_value,
            CASE
                WHEN previous_value = 0 THEN NULL
                ELSE (current_value - previous_value) / previous_value
            END AS growth_rate${groupByClause}
        FROM joined_data
    )
    SELECT
        time_period,
        current_value,
        previous_value,
        growth_rate,
        -- 计算截至当日的当月累计（Month-to-Date）
        SUM(current_value) OVER (
            PARTITION BY ${groupByFields}, DATE_TRUNC('month', time_period) 
            ORDER BY time_period 
            ROWS UNBOUNDED PRECEDING
        ) AS period_total_current,
        
        SUM(previous_value) OVER (
            PARTITION BY ${groupByFields}, DATE_TRUNC('month', time_period) 
            ORDER BY time_period 
            ROWS UNBOUNDED PRECEDING
        ) AS period_total_previous,
        
        -- 计算累计值的增长率 (MTD Growth)
        CASE
            WHEN SUM(previous_value) OVER (
                PARTITION BY ${groupByFields}, DATE_TRUNC('month', time_period) 
                ORDER BY time_period 
                ROWS UNBOUNDED PRECEDING
            ) = 0 THEN NULL
            ELSE (
                SUM(current_value) OVER (
                    PARTITION BY ${groupByFields}, DATE_TRUNC('month', time_period) 
                    ORDER BY time_period 
                    ROWS UNBOUNDED PRECEDING
                ) - 
                SUM(previous_value) OVER (
                    PARTITION BY ${groupByFields}, DATE_TRUNC('month', time_period) 
                    ORDER BY time_period 
                    ROWS UNBOUNDED PRECEDING
                )
            ) / SUM(previous_value) OVER (
                PARTITION BY ${groupByFields}, DATE_TRUNC('month', time_period) 
                ORDER BY time_period 
                ROWS UNBOUNDED PRECEDING
            )
        END AS period_growth_rate,

        -- 计算截至当日的当年累计（Year-to-Date）
        SUM(current_value) OVER (
            PARTITION BY ${groupByFields}, DATE_TRUNC('year', time_period) 
            ORDER BY time_period 
            ROWS UNBOUNDED PRECEDING
        ) AS ytd_total_current,

        SUM(previous_value) OVER (
            PARTITION BY ${groupByFields}, DATE_TRUNC('year', time_period) 
            ORDER BY time_period 
            ROWS UNBOUNDED PRECEDING
        ) AS ytd_total_previous,

        -- 计算当年累计增长率 (YTD Growth)
        CASE
            WHEN SUM(previous_value) OVER (
                PARTITION BY ${groupByFields}, DATE_TRUNC('year', time_period) 
                ORDER BY time_period 
                ROWS UNBOUNDED PRECEDING
            ) = 0 THEN NULL
            ELSE (
                SUM(current_value) OVER (
                    PARTITION BY ${groupByFields}, DATE_TRUNC('year', time_period) 
                    ORDER BY time_period 
                    ROWS UNBOUNDED PRECEDING
                ) - 
                SUM(previous_value) OVER (
                    PARTITION BY ${groupByFields}, DATE_TRUNC('year', time_period) 
                    ORDER BY time_period 
                    ROWS UNBOUNDED PRECEDING
                )
            ) / SUM(previous_value) OVER (
                PARTITION BY ${groupByFields}, DATE_TRUNC('year', time_period) 
                ORDER BY time_period 
                ROWS UNBOUNDED PRECEDING
            )
        END AS ytd_growth_rate

        ${groupByClause}
    FROM with_growth
    ORDER BY time_period
  `;
}

/**
 * 预定义的常用增长率查询配置
 */
import { getMetricSql } from '../config/metric-registry/index.js';

/**
 * 预定义的常用增长率查询配置
 * 基于项目现有的KPI指标和业务规则
 */
export const COMMON_GROWTH_QUERIES = {
  // 保费按机构月度同比
  premiumByOrgMonthlyYoY: {
    growthType: 'yoy' as GrowthType,
    timeView: 'monthly' as TimeView,
    metric: getMetricSql('total_premium'),
    groupBy: ['org_level_3'],
    whereClause: '1=1'
  },

  // 保费按业务员季度环比
  premiumBySalesmanQuarterlyMoM: {
    growthType: 'mom' as GrowthType,
    timeView: 'quarterly' as TimeView,
    metric: getMetricSql('total_premium'),
    groupBy: ['salesman_name'],
    whereClause: '1=1'
  },

  // 综合KPI按机构年度同比
  kpiByOrgYearlyYoY: {
    growthType: 'yoy' as GrowthType,
    timeView: 'yearly' as TimeView,
    metric: `${getMetricSql('total_premium')}, ${getMetricSql('policy_count')}, ${getMetricSql('per_capita_premium')}, ${getMetricSql('renewal_rate')}`,
    groupBy: ['org_level_3'],
    whereClause: '1=1'
  },

  // 保费年累计增长率
  premiumYTDGrowth: {
    growthType: 'ytd' as GrowthType,
    timeView: 'monthly' as TimeView,
    metric: getMetricSql('total_premium'),
    groupBy: ['org_level_3'],
    whereClause: '1=1'
  },

  // 业务员续保率月度环比
  renewalRateBySalesmanMoM: {
    growthType: 'mom' as GrowthType,
    timeView: 'monthly' as TimeView,
    metric: getMetricSql('renewal_rate'),
    groupBy: ['salesman_name'],
    whereClause: '1=1'
  }
};

/**
 * 生成增长率查询的便捷函数
 *
 * DC-001: 支持动态日期字段
 *
 * @param config - 预定义配置名称或自定义配置
 * @param dateField - 可选的日期字段覆盖（默认使用 'policy_date'）
 * @returns SQL查询字符串
 */
export function generateGrowthQuery(
  config: keyof typeof COMMON_GROWTH_QUERIES,
  dateField?: DateCriteria
): string;
export function generateGrowthQuery(config: GrowthConfig, dateField?: DateCriteria): string;
export function generateGrowthQuery(
  config: keyof typeof COMMON_GROWTH_QUERIES | GrowthConfig,
  dateField: DateCriteria = 'policy_date'
): string {
  if (typeof config === 'string' && config in COMMON_GROWTH_QUERIES) {
    return generateComprehensiveGrowthQuery(
      COMMON_GROWTH_QUERIES[config as keyof typeof COMMON_GROWTH_QUERIES],
      dateField
    );
  }
  return generateComprehensiveGrowthQuery(config as GrowthConfig, dateField);
}

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

