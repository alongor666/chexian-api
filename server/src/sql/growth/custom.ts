/**
 * 增长率分析 — 自定义比较 + 综合查询 + 预设配置
 *
 * 包含：
 * - generateCustomGrowthQuery()          — 自定义期间比较
 * - generateComprehensiveGrowthQuery()   — 综合增长率分析（路由到具体类型）
 * - generateDailyGrowthWithContextQuery() — 日度增长率（含月累计/年累计上下文）
 * - COMMON_GROWTH_QUERIES               — 预定义常用查询配置
 * - generateGrowthQuery()               — 便捷函数（重载）
 *
 * DC-001: 支持动态日期字段
 */

import { DateCriteria } from '../../types/data.js';
import { GrowthConfig, GrowthType, TimeView } from './shared.js';
import { generateYoYGrowthQuery } from './yoy.js';
import { generateMoMGrowthQuery } from './mom.js';
import { generateYTDGrowthQuery } from './ytd.js';
import { getMetricSql } from '../../config/metric-registry/index.js';

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
