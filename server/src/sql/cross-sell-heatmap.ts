/**
 * 交叉销售热力图 SQL 生成器
 * Cross-Sell Heatmap SQL Generator
 *
 * 按时间粒度（日/周/月/季）+三级机构分组，返回最近14个时段的数据
 * 支持推介率、件均保费、计划达成率
 * 颜色映射：优秀(绿)/健康(蓝)/异常(橙)/危险(红)
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory } from './cross-sell-summary.js';
import { escapeSqlValue } from '../utils/security.js';

export interface CrossSellHeatmapDrillStep {
  dimension: string;
  value: string;
}

function crossSellDrillToWhere(steps: CrossSellHeatmapDrillStep[]): string {
  if (!steps || steps.length === 0) return '';
  const clauses = steps.map((step) => {
    const v = `'${escapeSqlValue(step.value)}'`;
    switch (step.dimension) {
      case 'org_level_3':
        return `TRIM(CAST(org_level_3 AS VARCHAR)) = ${v}`;
      case 'customer_category':
        return `TRIM(CAST(customer_category AS VARCHAR)) = ${v}`;
      case 'coverage_combination':
        return `TRIM(CAST(coverage_combination AS VARCHAR)) = ${v}`;
      case 'energy_type':
        return step.value === '新能源'
          ? `(COALESCE(CAST(is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE'))`
          : `NOT (COALESCE(CAST(is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE'))`;
      case 'business_nature':
        switch (step.value) {
          case '续保': return `COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          case '新车': return `COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          case '过户': return `COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          default: return `NOT COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1','true','TRUE') AND NOT COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1','true','TRUE') AND NOT COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1','true','TRUE')`;
        }
      default:
        return 'TRUE';
    }
  });
  return clauses.join(' AND ');
}

type CrossSellHeatmapTimePeriod = 'day' | 'week' | 'month' | 'quarter';

export interface HeatmapRow {
  date: string;
  org_level_3: string;
  auto_count: number;
  driver_count: number;
  rate: number;
  avg_premium: number;
  achievement_rate: number | null;
}

/**
 * 根据 timePeriod 获取计划分母（年计划除以多少得到单期计划）
 */
function getDriverPlanDenominator(timePeriod: CrossSellHeatmapTimePeriod): number {
  switch (timePeriod) {
    case 'day': return 365;
    case 'week': return 52;
    case 'month': return 12;
    case 'quarter': return 4;
    default: return 365;
  }
}

/**
 * 热力图维度分组类型（驾乘险）
 */
export type CrossSellHeatmapGroupDimension =
  | 'org_level_3'
  | 'customer_category'
  | 'coverage_combination'
  | 'energy_type'
  | 'business_nature';

function getCrossSellHeatmapDimExpr(
  dimension: CrossSellHeatmapGroupDimension
): { selectExpr: string; alias: string } {
  switch (dimension) {
    case 'customer_category':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(customer_category AS VARCHAR)), ''), '未知')`,
        alias: 'dim_value',
      };
    case 'coverage_combination':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(coverage_combination AS VARCHAR)), ''), '未知')`,
        alias: 'dim_value',
      };
    case 'energy_type':
      return {
        selectExpr: `CASE WHEN COALESCE(CAST(is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '新能源' ELSE '燃油' END`,
        alias: 'dim_value',
      };
    case 'business_nature':
      return {
        selectExpr: `CASE
          WHEN COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '续保'
          WHEN COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '新车'
          WHEN COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '过户'
          ELSE '转保'
        END`,
        alias: 'dim_value',
      };
    default: // org_level_3
      return {
        selectExpr: 'org_level_3',
        alias: 'dim_value',
      };
  }
}

/**
 * 生成交叉销售热力图查询（支持多时间粒度 + 计划达成率 + 多维度分组）
 *
 * 返回字段：date, org_level_3, auto_count, driver_count, rate, avg_premium, achievement_rate
 * 按最近15个时间窗口 + 所有分组维度分组
 *
 * @param baseWhereClause - 基础 WHERE 子句（含 RBAC + org 过滤）
 * @param vehicleCategory - 车辆类别
 * @param seatCoverageClause - 座位险保额过滤子句（可选）
 * @param timePeriod - 时间粒度 day/week/month/quarter（默认 day）
 * @param groupByDimension - 分组维度（默认 org_level_3）
 */
export function generateCrossSellHeatmapQuery(
  baseWhereClause: string,
  vehicleCategory: VehicleCategory,
  seatCoverageClause?: string,
  timePeriod: CrossSellHeatmapTimePeriod = 'day',
  groupByDimension: CrossSellHeatmapGroupDimension = 'org_level_3',
  drillFilter: CrossSellHeatmapDrillStep[] = []
): string {
  logger.debug('Generating cross-sell heatmap query', { vehicleCategory, hasSeatClause: !!seatCoverageClause, timePeriod, groupByDimension, drillFilterCount: drillFilter.length });

  const vehicleFilter = getVehicleCategoryFilter(vehicleCategory);
  const seatClause = seatCoverageClause ? `AND ${seatCoverageClause}` : '';
  const drillWhereClause = crossSellDrillToWhere(drillFilter);
  const drillAnd = drillWhereClause ? `AND ${drillWhereClause}` : '';
  const safePeriods = 15;
  const planDenom = getDriverPlanDenominator(timePeriod);
  const dimConfig = getCrossSellHeatmapDimExpr(groupByDimension);

  // 根据 timePeriod 动态生成 SQL 片段
  let truncExpr: string;
  let windowOffset: string;
  let seriesStep: string;

  switch (timePeriod) {
    case 'week':
      truncExpr = `DATE_TRUNC('week', pd)::DATE`;
      windowOffset = `${safePeriods - 1} WEEK`;
      seriesStep = 'INTERVAL 1 WEEK';
      break;
    case 'month':
      truncExpr = `DATE_TRUNC('month', pd)::DATE`;
      windowOffset = `${safePeriods - 1} MONTH`;
      seriesStep = 'INTERVAL 1 MONTH';
      break;
    case 'quarter':
      truncExpr = `DATE_TRUNC('quarter', pd)::DATE`;
      windowOffset = `${(safePeriods - 1) * 3} MONTH`;
      seriesStep = 'INTERVAL 3 MONTH';
      break;
    default: // 'day'
      truncExpr = 'pd';
      windowOffset = `${safePeriods - 1} DAY`;
      seriesStep = 'INTERVAL 1 DAY';
      break;
  }

  const refDateExpr = timePeriod === 'day'
    ? 'MAX(pd)'
    : `DATE_TRUNC('${timePeriod === 'quarter' ? 'quarter' : timePeriod}', MAX(pd))::DATE`;

  const sql = `
    WITH filtered AS (
      SELECT
        CAST(policy_date AS DATE) AS pd,
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        SUM(auto_count) AS auto_count,
        SUM(driver_count) AS driver_count,
        SUM(driver_policy_count) AS driver_policy_count,
        SUM(driver_premium) AS driver_premium
      FROM CrossSellDailyAgg
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
        ${seatClause}
        ${drillAnd}
        AND org_level_3 IS NOT NULL
        AND TRIM(org_level_3) != ''
      GROUP BY pd, ${dimConfig.alias}
    ),
    period_bounds AS (
      SELECT
        ${refDateExpr} AS ref_date,
        ${refDateExpr} - INTERVAL ${windowOffset} AS start_date
      FROM filtered
    ),
    window_rows AS (
      SELECT f.*, ${truncExpr} AS period_key
      FROM filtered f
      CROSS JOIN period_bounds pb
      WHERE f.pd >= pb.start_date AND f.pd <= pb.ref_date ${timePeriod !== 'day' ? `+ INTERVAL ${timePeriod === 'quarter' ? '3 MONTH' : '1 ' + timePeriod} - INTERVAL 1 DAY` : ''}
    ),
    dim_period AS (
      SELECT
        wr.${dimConfig.alias},
        wr.period_key,
        SUM(wr.auto_count) AS auto_count,
        SUM(wr.driver_count) AS driver_count,
        SUM(wr.driver_policy_count) AS driver_policy_count,
        SUM(wr.driver_premium) AS driver_premium
      FROM window_rows wr
      GROUP BY wr.${dimConfig.alias}, wr.period_key
    ),
    dim_pool AS (
      SELECT DISTINCT ${dimConfig.alias} FROM window_rows
    ),
    period_pool AS (
      SELECT d::DATE AS period_key
      FROM period_bounds pb,
      generate_series(pb.start_date, pb.ref_date, ${seriesStep}) AS t(d)
    ),
    base_grid AS (
      SELECT o.${dimConfig.alias}, pp.period_key
      FROM dim_pool o
      CROSS JOIN period_pool pp
    ),
    driver_plan AS (
      SELECT
        level_key AS plan_org,
        plan_premium AS plan_premium_wan
      FROM KpiPlanConfig
      WHERE business_line = 'driver'
        AND level = 'org'
        AND plan_year = COALESCE(
          CAST(EXTRACT(YEAR FROM (SELECT ref_date FROM period_bounds LIMIT 1)) AS INTEGER),
          EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
        )
    )
    SELECT
      bg.${dimConfig.alias} AS org_level_3,
      STRFTIME(bg.period_key, '%Y-%m-%d') AS date,
      COALESCE(cur.auto_count, 0) AS auto_count,
      COALESCE(cur.driver_count, 0) AS driver_count,
      CASE
        WHEN COALESCE(cur.auto_count, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(cur.driver_count, 0) * 100.0 / COALESCE(cur.auto_count, 0), 2)
      END AS rate,
      CASE
        WHEN COALESCE(cur.driver_policy_count, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(cur.driver_premium, 0) / COALESCE(cur.driver_policy_count, 0), 2)
      END AS avg_premium,
      ${groupByDimension === 'org_level_3' ? `CASE
        WHEN COALESCE(dp.plan_premium_wan, 0) <= 0 THEN NULL
        ELSE ROUND(
          COALESCE(cur.driver_premium, 0) / 10000.0
          / (dp.plan_premium_wan / ${planDenom}.0)
          * 100.0,
          2
        )
      END` : 'NULL'} AS achievement_rate
    FROM base_grid bg
    LEFT JOIN dim_period cur ON cur.${dimConfig.alias} = bg.${dimConfig.alias} AND cur.period_key = bg.period_key
    ${groupByDimension === 'org_level_3' ? `LEFT JOIN driver_plan dp ON dp.plan_org = bg.${dimConfig.alias}` : ''}
    ORDER BY bg.${dimConfig.alias}, bg.period_key
  `;

  logger.debug('Generated cross-sell heatmap SQL', { sqlLength: sql.length, timePeriod, groupByDimension });
  return sql;
}
