/**
 * 车驾意推介率 TOP20 业务员分析 SQL 生成器
 * Cross-Sell Top Salesman SQL Generator
 *
 * 基于主全、交三维度分析业务员推介率 TOP 20
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory } from './cross-sell-summary.js';

export type TopSalesmanCoverage = '主全' | '交三';

/**
 * 生成 TOP20 业务员查询
 */
export function generateCrossSellTopSalesmanQuery(
  baseWhereClause: string,
  vehicleCategory: VehicleCategory,
  coverage: TopSalesmanCoverage,
  timePeriod: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' = 'daily'
): string {
  logger.debug('Generating cross-sell top salesman query', { vehicleCategory, coverage });

  const vehicleFilter = getVehicleCategoryFilter(vehicleCategory);

  const sql = `
    WITH date_bounds AS (
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date
      FROM CrossSellDailyAgg
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
    ),
    time_filtered AS (
      SELECT
        salesman_name,
        org_level_3,
        coverage_combination,
        auto_count,
        driver_count,
        driver_policy_count,
        driver_premium,
        CAST(policy_date AS DATE) AS pd,
        (SELECT max_date FROM date_bounds) AS tp_max,
        (SELECT max_date FROM date_bounds) AS tp_day,
        CAST(DATE_TRUNC('week', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_week,
        CAST(DATE_TRUNC('month', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_month,
        CAST(DATE_TRUNC('quarter', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_quarter,
        CAST(DATE_TRUNC('year', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_year
      FROM CrossSellDailyAgg
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
        AND coverage_combination = '${coverage}'
        AND salesman_name IS NOT NULL
        AND TRIM(salesman_name) != ''
    ),
    filtered AS (
      SELECT * FROM time_filtered
      WHERE CASE 
        WHEN '${timePeriod}' = 'daily' THEN pd = tp_day
        WHEN '${timePeriod}' = 'weekly' THEN pd >= tp_week AND pd <= tp_max
        WHEN '${timePeriod}' = 'monthly' THEN pd >= tp_month AND pd <= tp_max
        WHEN '${timePeriod}' = 'quarterly' THEN pd >= tp_quarter AND pd <= tp_max
        WHEN '${timePeriod}' = 'yearly' THEN pd >= tp_year AND pd <= tp_max
        ELSE pd = tp_day
      END
    ),
    salesman_summary AS (
      SELECT
        salesman_name,
        MAX(org_level_3) AS org_level_3,
        COALESCE(SUM(auto_count), 0) AS auto_count,
        COALESCE(SUM(driver_count), 0) AS driver_count,
        COALESCE(SUM(driver_policy_count), 0) AS driver_policy_count,
        COALESCE(SUM(driver_premium), 0) AS driver_premium
      FROM filtered
      GROUP BY salesman_name
    ),
    calculated AS (
      SELECT
        salesman_name,
        org_level_3,
        auto_count,
        driver_count,
        ROUND(driver_premium, 2) AS driver_premium,
        CASE WHEN auto_count = 0 THEN 0
             ELSE ROUND(driver_count * 100.0 / auto_count, 2)
        END AS rate,
        CASE WHEN driver_policy_count = 0 THEN 0
             ELSE ROUND(driver_premium / driver_policy_count, 2)
        END AS avg_premium
      FROM salesman_summary
    )
    SELECT
      salesman_name,
      org_level_3,
      driver_premium,
      auto_count,
      rate,
      avg_premium
    FROM calculated
    ORDER BY auto_count DESC, rate DESC
    LIMIT 20
  `;

  logger.debug('Generated cross-sell top salesman SQL', { sqlLength: sql.length });
  return sql;
}
