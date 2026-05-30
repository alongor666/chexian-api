/**
 * 车驾意推介率 时间维度汇总 SQL 生成器
 * Cross-Sell Time Period Summary SQL Generator
 *
 * 计算4个时间段(当日/当周/当月/当年) × 4个险别组合(整体/主全/交三/单交) × 3个指标(推介率/件均保费/保费)
 * 时间基准: 数据中 MAX(policy_date)
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory } from './cross-sell/shared.js';
export { VehicleCategory, getVehicleCategoryFilter } from './cross-sell/shared.js';

// ============================================================
// 主查询生成
// ============================================================

/**
 * 生成时间段 FILTER 子句（复用模板减少重复）
 */
function timeFilter(period: 'day' | 'week' | 'month' | 'quarter' | 'year', extra = ''): string {
  const extraClause = extra ? ` AND ${extra}` : '';
  switch (period) {
    case 'day':
      return `FILTER (WHERE pd = tp_day${extraClause})`;
    case 'week':
      return `FILTER (WHERE pd >= tp_week AND pd <= tp_max${extraClause})`;
    case 'month':
      return `FILTER (WHERE pd >= tp_month AND pd <= tp_max${extraClause})`;
    case 'quarter':
      return `FILTER (WHERE pd >= tp_quarter AND pd <= tp_max${extraClause})`;
    case 'year':
      return `FILTER (WHERE pd >= tp_year AND pd <= tp_max${extraClause})`;
  }
}

/**
 * 生成上一时间段 FILTER 子句（用于环比计算）
 * - day: 昨日 (tp_day - 1)
 * - week: 上周 (tp_week - 7 到 tp_week - 1)
 * - month: 上月 (上个月同范围天数)
 * - year: 无环比，返回空
 */
function prevTimeFilter(period: 'day' | 'week' | 'month' | 'quarter' | 'year', extra = ''): string {
  const extraClause = extra ? ` AND ${extra}` : '';
  switch (period) {
    case 'day':
      // 昨日
      return `FILTER (WHERE pd = tp_day - INTERVAL 1 DAY${extraClause})`;
    case 'week':
      // 上周同期（与当前周“从 tp_week 开始到 tp_max”的同天数窗口保持一致）
      return `FILTER (
        WHERE pd >= tp_week - INTERVAL 7 DAY
          AND pd <= tp_week - INTERVAL 7 DAY + DATEDIFF('day', tp_week, tp_max) * INTERVAL 1 DAY
          ${extraClause}
      )`;
    case 'month':
      // 上月同期（与当前月“从 tp_month 开始到 tp_max”的同天数窗口保持一致）
      return `FILTER (
        WHERE pd >= tp_month - INTERVAL 1 MONTH
          AND pd <= tp_month - INTERVAL 1 MONTH + DATEDIFF('day', tp_month, tp_max) * INTERVAL 1 DAY
          ${extraClause}
      )`;
    case 'quarter':
      // 上季度同期（与当前季度“从 tp_quarter 开始到 tp_max”的同天数窗口保持一致）
      return `FILTER (
        WHERE pd >= tp_quarter - INTERVAL 3 MONTH
          AND pd <= tp_quarter - INTERVAL 3 MONTH + DATEDIFF('day', tp_quarter, tp_max) * INTERVAL 1 DAY
          ${extraClause}
      )`;
    case 'year':
      // 当年无环比
      return `FILTER (WHERE 1=0${extraClause})`;
  }
}

/**
 * 生成一组时间段的聚合列（auto_count, driver_count, premium × 4 个时间段）
 */
function generateTimePeriodColumns(): string {
  const periods: Array<'day' | 'week' | 'month' | 'quarter' | 'year'> = ['day', 'week', 'month', 'quarter', 'year'];
  const lines: string[] = [];

  for (const p of periods) {
    lines.push(`COALESCE(SUM(auto_count) ${timeFilter(p)}, 0) AS ${p}_auto_count`);
    lines.push(`COALESCE(SUM(driver_count) ${timeFilter(p)}, 0) AS ${p}_driver_count`);
    lines.push(`COALESCE(SUM(driver_policy_count) ${timeFilter(p)}, 0) AS ${p}_driver_policy_count`);
    lines.push(`COALESCE(SUM(driver_premium) ${timeFilter(p)}, 0) AS ${p}_premium`);
    lines.push(`COALESCE(SUM(auto_premium) ${timeFilter(p)}, 0) AS ${p}_auto_premium`);
  }

  return lines.join(',\n        ');
}

/**
 * 生成上一周期时间段的聚合列（用于环比）
 */
function generatePrevTimePeriodColumns(): string {
  const periods: Array<'day' | 'week' | 'month' | 'quarter'> = ['day', 'week', 'month', 'quarter'];
  const lines: string[] = [];

  for (const p of periods) {
    lines.push(`COALESCE(SUM(auto_count) ${prevTimeFilter(p)}, 0) AS prev_${p}_auto_count`);
    lines.push(`COALESCE(SUM(driver_count) ${prevTimeFilter(p)}, 0) AS prev_${p}_driver_count`);
    lines.push(`COALESCE(SUM(driver_policy_count) ${prevTimeFilter(p)}, 0) AS prev_${p}_driver_policy_count`);
    lines.push(`COALESCE(SUM(driver_premium) ${prevTimeFilter(p)}, 0) AS prev_${p}_premium`);
    lines.push(`COALESCE(SUM(auto_premium) ${prevTimeFilter(p)}, 0) AS prev_${p}_auto_premium`);
  }

  return lines.join(',\n        ');
}

/**
 * 生成计算列（rate, avg_premium × 4 个时间段 + 环比差值）
 */
function generateCalculatedColumns(): string {
  const periods: Array<'day' | 'week' | 'month' | 'quarter' | 'year'> = ['day', 'week', 'month', 'quarter', 'year'];
  const lines: string[] = [];

  // 当期数据
  for (const p of periods) {
    lines.push(`${p}_auto_count`);
    lines.push(`${p}_driver_count`);
    lines.push(`ROUND(${p}_premium, 2) AS ${p}_premium`);
    lines.push(`CASE WHEN ${p}_auto_count = 0 THEN 0 ELSE ROUND(${p}_driver_count * 100.0 / ${p}_auto_count, 2) END AS ${p}_rate`);
    lines.push(`CASE WHEN ${p}_driver_policy_count = 0 THEN 0 ELSE ROUND(${p}_premium / ${p}_driver_policy_count, 2) END AS ${p}_avg_premium`);
    lines.push(`CASE WHEN ${p}_auto_count = 0 THEN 0 ELSE ROUND(${p}_auto_premium / ${p}_auto_count, 2) END AS ${p}_auto_avg_premium`);
  }

  // 上一期数据 (day/week/month/quarter)
  const prevPeriods: Array<'day' | 'week' | 'month' | 'quarter'> = ['day', 'week', 'month', 'quarter'];
  for (const p of prevPeriods) {
    lines.push(`prev_${p}_auto_count`);
    lines.push(`prev_${p}_driver_count`);
    lines.push(`ROUND(prev_${p}_premium, 2) AS prev_${p}_premium`);
    lines.push(`CASE WHEN prev_${p}_auto_count = 0 THEN 0 ELSE ROUND(prev_${p}_driver_count * 100.0 / prev_${p}_auto_count, 2) END AS prev_${p}_rate`);
    lines.push(`CASE WHEN prev_${p}_driver_policy_count = 0 THEN 0 ELSE ROUND(prev_${p}_premium / prev_${p}_driver_policy_count, 2) END AS prev_${p}_avg_premium`);
    lines.push(`CASE WHEN prev_${p}_auto_count = 0 THEN 0 ELSE ROUND(prev_${p}_auto_premium / prev_${p}_auto_count, 2) END AS prev_${p}_auto_avg_premium`);
  }

  return lines.join(',\n      ');
}

/**
 * 生成车驾意推介率 时间维度汇总查询
 *
 * 一次查询返回 4 行（整体/主全/交三/单交），每行包含 4 个时间段的指标。
 * 使用 DuckDB 的 FILTER (WHERE ...) 语法高效计算。
 * 包含环比数据（上一周期）用于计算变化趋势。
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
  const prevAggColumns = generatePrevTimePeriodColumns();
  const calcColumns = generateCalculatedColumns();

  // filtered_data CTE 先用无前缀的 baseWhereClause 过滤数据，
  // 同时计算 time_period 边界并展平为列，供后续 FILTER 子句使用。
  // 这样避免了 baseWhereClause 中列名无前缀与 CROSS JOIN 别名冲突的问题。
  const sql = `
    WITH date_bounds AS (
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date
      FROM CrossSellDailyAgg
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
    ),
    filtered_data AS (
      SELECT
        coverage_combination,
        auto_count,
        driver_count,
        driver_policy_count,
        driver_premium,
        auto_premium,
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
    ),
    by_coverage AS (
      SELECT
        coverage_combination,
        ${aggColumns},
        ${prevAggColumns}
      FROM filtered_data
      GROUP BY coverage_combination
    ),
    total_row AS (
      SELECT
        '整体' AS coverage_combination,
        ${aggColumns},
        ${prevAggColumns}
      FROM filtered_data
      WHERE coverage_combination IN ('主全', '交三')
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
