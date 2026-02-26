/**
 * 机构推介率走势 SQL 生成器
 * Cross-Sell Org Trend SQL Generator
 *
 * 按日分组，返回最近 N 天的车险件数/驾意件数/推介率/件均保费
 * 支持险种组合过滤（交三/主全/单交/整体）
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory } from './cross-sell-summary.js';

export type CoverageCombinationFilter = '整体' | '交三' | '主全' | '单交';

/**
 * 交叉销售判定条件（与其他 SQL 生成器保持一致）
 */
function getCrossSellCondition(): string {
  return `(
    TRY_CAST(is_cross_sell AS BOOLEAN) = true
    OR LOWER(TRIM(CAST(is_cross_sell AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
  )`;
}

/**
 * 生成机构推介率走势查询
 *
 * 返回字段：date, auto_count, driver_count, rate, avg_premium
 * 按最近 days 天每日分组
 *
 * @param baseWhereClause - 基础 WHERE 子句（含日期/org 等过滤）
 * @param vehicleCategory - 车辆类别
 * @param coverageCombination - 险种组合过滤（整体=不限）
 * @param days - 最近天数（默认 14）
 */
export function generateCrossSellOrgTrendQuery(
  baseWhereClause: string,
  vehicleCategory: VehicleCategory,
  coverageCombination: CoverageCombinationFilter = '整体',
  days: number = 14
): string {
  logger.debug('Generating cross-sell org trend query', { vehicleCategory, coverageCombination, days });

  const vehicleFilter = getVehicleCategoryFilter(vehicleCategory);
  const crossSellCond = getCrossSellCondition();
  const safedays = Math.max(1, Math.min(90, days));

  const coverageFilter =
    coverageCombination !== '整体'
      ? `AND coverage_combination = '${coverageCombination}'`
      : '';

  const sql = `
    WITH latest AS (
      -- 以数据中实际最新签单日期为基准，而非 CURRENT_DATE
      SELECT MAX(CAST(policy_date AS DATE)) AS latest_date
      FROM PolicyFact
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
        ${coverageFilter}
    ),
    date_series AS (
      SELECT ((SELECT latest_date FROM latest) - (INTERVAL '1 day' * i)) AS date_val
      FROM generate_series(0, ${safedays - 1}) AS gs(i)
    ),
    filtered AS (
      SELECT
        COALESCE(
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        is_cross_sell,
        cross_sell_premium_driver,
        CAST(policy_date AS DATE) AS pd
      FROM PolicyFact
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
        AND CAST(policy_date AS DATE) >= (SELECT latest_date FROM latest) - INTERVAL '${safedays - 1} days'
        AND CAST(policy_date AS DATE) <= (SELECT latest_date FROM latest)
        ${coverageFilter}
    ),
    daily AS (
      SELECT
        STRFTIME(pd, '%Y-%m-%d') AS date_str,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(DISTINCT CASE WHEN ${crossSellCond} THEN dedup_key END) AS driver_count,
        COALESCE(SUM(CASE WHEN ${crossSellCond} THEN cross_sell_premium_driver ELSE 0 END), 0) AS premium
      FROM filtered
      GROUP BY 1
    )
    SELECT
      STRFTIME(ds.date_val, '%Y-%m-%d') AS date,
      COALESCE(d.auto_count, 0) AS auto_count,
      COALESCE(d.driver_count, 0) AS driver_count,
      CASE
        WHEN COALESCE(d.auto_count, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(d.driver_count, 0) * 100.0 / COALESCE(d.auto_count, 0), 2)
      END AS rate,
      CASE
        WHEN COALESCE(d.driver_count, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(d.premium, 0) / COALESCE(d.driver_count, 0), 2)
      END AS avg_premium
    FROM date_series ds
    LEFT JOIN daily d ON d.date_str = STRFTIME(ds.date_val, '%Y-%m-%d')
    ORDER BY ds.date_val
  `;

  logger.debug('Generated cross-sell org trend SQL', { sqlLength: sql.length });
  return sql;
}
