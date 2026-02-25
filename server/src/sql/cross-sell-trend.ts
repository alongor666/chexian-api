/**
 * 车驾意推介率走势 SQL 生成器
 * Cross-Sell Recommendation Rate Trend SQL Generator
 *
 * 按日/周/月/季度返回 4 条险别组合（整体/主全/交三/单交）的推介率走势数据
 * 时间基准：自然签单日期
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory } from './cross-sell-summary.js';

export type TrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly';

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
  }
}

/**
 * 交叉销售判定条件（与 cross-sell-summary.ts 保持一致）
 */
function getCrossSellCondition(): string {
  return `(
    TRY_CAST(is_cross_sell AS BOOLEAN) = true
    OR LOWER(TRIM(CAST(is_cross_sell AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
  )`;
}

/**
 * 生成车驾意推介率走势查询
 *
 * 返回字段：time_period, coverage_combination, rate, auto_count
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
  const crossSellCond = getCrossSellCondition();

  const dedup = `COALESCE(
      NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
      NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
    )`;

  const sql = `
    WITH filtered AS (
      SELECT
        ${dedup} AS dedup_key,
        coverage_combination,
        is_cross_sell,
        CAST(policy_date AS DATE) AS pd
      FROM PolicyFact
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
    ),
    by_coverage AS (
      SELECT
        ${timeExpr} AS time_period,
        coverage_combination,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN ${crossSellCond} THEN dedup_key END) AS driver_count
      FROM filtered
      GROUP BY 1, 2
    ),
    total_trend AS (
      SELECT
        ${timeExpr} AS time_period,
        '整体' AS coverage_combination,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN ${crossSellCond} THEN dedup_key END) AS driver_count
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
      auto_count
    FROM combined
    WHERE time_period IS NOT NULL
    ORDER BY time_period, coverage_combination
  `;

  logger.debug('Generated cross-sell trend SQL', { sqlLength: sql.length });
  return sql;
}
