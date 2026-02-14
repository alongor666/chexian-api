/**
 * 车驾意推介率 时间维度汇总 SQL 生成器
 * Cross-Sell Time Period Summary SQL Generator
 *
 * 计算4个时间段(当日/当周/当月/当年) × 4个险别组合(整体/主全/交三/单交) × 3个指标(推介率/件均保费/保费)
 * 时间基准: 数据中 MAX(policy_date)
 */

import { logger } from '../utils/logger.js';

// ============================================================
// 车辆类别过滤
// ============================================================

export type VehicleCategory = 'passenger' | 'truck' | 'motorcycle';

export function getVehicleCategoryFilter(category: VehicleCategory, colPrefix = ''): string {
  switch (category) {
    case 'passenger':
      return `${colPrefix}customer_category IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')`;
    case 'truck':
      return `${colPrefix}customer_category LIKE '%货车%'`;
    case 'motorcycle':
      return `${colPrefix}customer_category = '摩托车'`;
  }
}

// ============================================================
// 主查询生成
// ============================================================

/**
 * 生成时间段 FILTER 子句（复用模板减少重复）
 */
function timeFilter(period: 'day' | 'week' | 'month' | 'year', extra = ''): string {
  const extraClause = extra ? ` AND ${extra}` : '';
  switch (period) {
    case 'day':
      return `FILTER (WHERE pd = tp_day${extraClause})`;
    case 'week':
      return `FILTER (WHERE pd >= tp_week AND pd <= tp_max${extraClause})`;
    case 'month':
      return `FILTER (WHERE pd >= tp_month AND pd <= tp_max${extraClause})`;
    case 'year':
      return `FILTER (WHERE pd >= tp_year AND pd <= tp_max${extraClause})`;
  }
}

/**
 * 生成一组时间段的聚合列（auto_count, driver_count, premium × 4 个时间段）
 */
function generateTimePeriodColumns(): string {
  const periods: Array<'day' | 'week' | 'month' | 'year'> = ['day', 'week', 'month', 'year'];
  const lines: string[] = [];

  for (const p of periods) {
    lines.push(`COUNT(DISTINCT policy_no) ${timeFilter(p)} AS ${p}_auto_count`);
    lines.push(`COUNT(DISTINCT policy_no) ${timeFilter(p, 'is_cross_sell = true')} AS ${p}_driver_count`);
    lines.push(`COALESCE(SUM(cross_sell_premium_driver) ${timeFilter(p, 'is_cross_sell = true')}, 0) AS ${p}_premium`);
  }

  return lines.join(',\n        ');
}

/**
 * 生成计算列（rate, avg_premium × 4 个时间段）
 */
function generateCalculatedColumns(): string {
  const periods: Array<'day' | 'week' | 'month' | 'year'> = ['day', 'week', 'month', 'year'];
  const lines: string[] = [];

  for (const p of periods) {
    lines.push(`${p}_auto_count`);
    lines.push(`${p}_driver_count`);
    lines.push(`ROUND(${p}_premium, 2) AS ${p}_premium`);
    lines.push(`CASE WHEN ${p}_auto_count = 0 THEN 0 ELSE ROUND(${p}_driver_count * 100.0 / ${p}_auto_count, 2) END AS ${p}_rate`);
    lines.push(`CASE WHEN ${p}_driver_count = 0 THEN 0 ELSE ROUND(${p}_premium / ${p}_driver_count, 2) END AS ${p}_avg_premium`);
  }

  return lines.join(',\n      ');
}

/**
 * 生成车驾意推介率 时间维度汇总查询
 *
 * 一次查询返回 4 行（整体/主全/交三/单交），每行包含 4 个时间段的指标。
 * 使用 DuckDB 的 FILTER (WHERE ...) 语法高效计算。
 *
 * @param baseWhereClause - 基础 WHERE 子句（来自筛选器 + 权限过滤，无表前缀）
 * @param vehicleCategory - 车辆类别过滤
 * @returns SQL 查询字符串
 */
export function generateCrossSellTimePeriodQuery(
  baseWhereClause: string,
  vehicleCategory: VehicleCategory
): string {
  logger.debug('Generating cross-sell time period summary query', { baseWhereClause, vehicleCategory });

  const vehicleFilter = getVehicleCategoryFilter(vehicleCategory);
  const aggColumns = generateTimePeriodColumns();
  const calcColumns = generateCalculatedColumns();

  // filtered_data CTE 先用无前缀的 baseWhereClause 过滤数据，
  // 同时计算 time_period 边界并展平为列，供后续 FILTER 子句使用。
  // 这样避免了 baseWhereClause 中列名无前缀与 CROSS JOIN 别名冲突的问题。
  const sql = `
    WITH date_bounds AS (
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date
      FROM PolicyFact
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
    ),
    filtered_data AS (
      SELECT
        policy_no,
        coverage_combination,
        is_cross_sell,
        cross_sell_premium_driver,
        CAST(policy_date AS DATE) AS pd,
        (SELECT max_date FROM date_bounds) AS tp_max,
        (SELECT max_date FROM date_bounds) AS tp_day,
        CAST(DATE_TRUNC('week', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_week,
        CAST(DATE_TRUNC('month', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_month,
        CAST(DATE_TRUNC('year', (SELECT max_date FROM date_bounds)) AS DATE) AS tp_year
      FROM PolicyFact
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
    ),
    by_coverage AS (
      SELECT
        coverage_combination,
        ${aggColumns}
      FROM filtered_data
      GROUP BY coverage_combination
    ),
    total_row AS (
      SELECT
        '整体' AS coverage_combination,
        ${aggColumns}
      FROM filtered_data
    ),
    combined AS (
      SELECT * FROM total_row
      UNION ALL
      SELECT * FROM by_coverage
    )
    SELECT
      coverage_combination,
      ${calcColumns}
    FROM combined
    ORDER BY
      CASE coverage_combination
        WHEN '整体' THEN 1
        WHEN '主全' THEN 2
        WHEN '交三' THEN 3
        WHEN '单交' THEN 4
        ELSE 5
      END
  `;

  logger.debug('Generated cross-sell time period summary SQL', { sqlLength: sql.length });
  return sql;
}
