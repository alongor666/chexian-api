/**
 * 车驾意推介率走势 SQL 生成器
 * Cross-Sell Recommendation Rate Trend SQL Generator
 *
 * 按日/周/月/季度返回 4 条险别组合（整体/主全/交三/单交）的推介率走势数据
 * 时间基准：自然签单日期
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory } from './cross-sell-summary.js';

export type TrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * 生成时间分组表达式（pd = CAST(policy_date AS DATE)）
 */
function getTimeGroupExpr(granularity: TrendGranularity): string {
  switch (granularity) {
    case 'daily':
      return `STRFTIME(pd, '%Y-%m-%d')`;
    case 'weekly':
      return `STRFTIME(DATE_TRUNC('week', pd), '%Y-%m-%d')`;
    case 'monthly':
      return `STRFTIME(DATE_TRUNC('month', pd), '%Y-%m')`;
    case 'quarterly':
      return `CAST(EXTRACT(YEAR FROM pd) AS VARCHAR) || '-Q' || CAST(EXTRACT(QUARTER FROM pd) AS VARCHAR)`;
    case 'yearly':
      return `STRFTIME(DATE_TRUNC('year', pd), '%Y')`;
  }
}

/**
 * 生成车驾意推介率走势查询
 *
 * 返回字段：time_period, coverage_combination, rate, avg_premium, auto_count
 * 按时间分组，包含 整体/主全/交三/单交 四条线
 *
 * @param baseWhereClause - 基础 WHERE 子句
 * @param vehicleCategory - 车辆类别过滤
 * @param granularity - 时间粒度（日/周/月/季）
 */
export function generateCrossSellTrendQuery(
  baseWhereClause: string,
  vehicleCategory: VehicleCategory,
  granularity: TrendGranularity
): string {
  logger.debug('Generating cross-sell trend query', { vehicleCategory, granularity });

  const vehicleFilter = getVehicleCategoryFilter(vehicleCategory);
  const timeExpr = getTimeGroupExpr(granularity);

  const sql = `
    WITH filtered AS (
      SELECT
        coverage_combination,
        auto_count,
        driver_count,
        driver_premium,
        CAST(policy_date AS DATE) AS pd
      FROM CrossSellDailyAgg
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
    ),
    by_coverage AS (
      SELECT
        ${timeExpr} AS time_period,
        coverage_combination,
        COALESCE(SUM(auto_count), 0) AS auto_count,
        COALESCE(SUM(driver_count), 0) AS driver_count,
        COALESCE(SUM(driver_premium), 0) AS premium
      FROM filtered
      GROUP BY 1, 2
    ),
    total_trend AS (
      SELECT
        ${timeExpr} AS time_period,
        '整体' AS coverage_combination,
        COALESCE(SUM(auto_count), 0) AS auto_count,
        COALESCE(SUM(driver_count), 0) AS driver_count,
        COALESCE(SUM(driver_premium), 0) AS premium
      FROM filtered
      GROUP BY 1
    ),
    combined AS (
      SELECT * FROM total_trend
      UNION ALL
      SELECT * FROM by_coverage
      WHERE coverage_combination IN ('主全', '交三', '单交')
    )
    SELECT
      time_period,
      coverage_combination,
      CASE WHEN auto_count = 0 THEN 0
           ELSE ROUND(driver_count * 100.0 / auto_count, 2)
      END AS rate,
      CASE WHEN driver_count = 0 THEN 0
           ELSE ROUND(premium / driver_count, 2)
      END AS avg_premium,
      auto_count
    FROM combined
    WHERE time_period IS NOT NULL
    ORDER BY time_period, coverage_combination
  `;

  logger.debug('Generated cross-sell trend SQL', { sqlLength: sql.length });
  return sql;
}
