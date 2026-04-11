/**
 * 业绩分析 SQL 生成器 — 下钻查询
 *
 * 包含：
 * - generatePerformanceDrilldownQuery() — 按维度下钻的业绩查询（支持多级钻路径）
 */

import { logger } from '../../utils/logger.js';
import {
  truthyExpr,
  getPerformanceSegmentFilter,
  getPlanDenominator,
  buildPeriodBoundsCte,
  buildStaticPeriodBoundsCte,
  buildPeriodProgressCte,
  drillStepToWhere,
  getGroupByConfig,
  supportsAnnualPlanByDimension,
  type PerformanceSegmentTag,
  type PerformanceTimePeriod,
  type PerformanceGrowthMode,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
  type PerformancePeriodBounds,
} from '../performance-analysis-shared.js';

export function generatePerformanceDrilldownQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  drillPath: PerformanceDrilldownStep[] = [],
  groupBy: PerformanceDimension | null = null,
  periodBoundsOverride?: PerformancePeriodBounds
): string {
  const segmentFilterNoAlias = getPerformanceSegmentFilter(segmentTag);
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, 'p.');
  const periodBounds = periodBoundsOverride
    ? buildStaticPeriodBoundsCte(periodBoundsOverride)
    : buildPeriodBoundsCte(whereWithDate, segmentFilterNoAlias, timePeriod, growthMode);
  const periodProgress = buildPeriodProgressCte();
  const groupCfg = getGroupByConfig(groupBy, 'p.');
  const hasAnnualPlanSql = supportsAnnualPlanByDimension(groupBy) ? 'TRUE' : 'FALSE';

  const stepWheres = drillPath.map((step) => drillStepToWhere(step, 'p.'));
  const drillWhere = stepWheres.length > 0 ? `AND ${stepWheres.join('\n        AND ')}` : '';

  const sql = `
    WITH
    ${periodBounds},
    ${periodProgress},
    all_rows AS (
      SELECT
        ${groupCfg.selectExpr},
        CAST(p.policy_date AS DATE) AS pd,
        p.salesman_name,
        COALESCE(
          NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN p.premium > 0 THEN p.premium / 10000.0 ELSE 0 END AS premium_wan,
        CASE WHEN ${truthyExpr('p.is_nev')} THEN true ELSE false END AS is_nev,
        CASE WHEN ${truthyExpr('p.is_renewal')} THEN true ELSE false END AS is_renewal,
        CASE WHEN ${truthyExpr('p.is_new_car')} THEN true ELSE false END AS is_new_car,
        CASE WHEN ${truthyExpr('p.is_transfer')} THEN true ELSE false END AS is_transfer,
        COALESCE(ac.plan_vehicle, 0) AS plan_vehicle
      FROM PolicyFact p
      LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
      LEFT JOIN (SELECT full_name, SUM(plan_vehicle) AS plan_vehicle FROM achievement_cache GROUP BY full_name) ac ON p.salesman_name = ac.full_name
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
        ${drillWhere}
    ),
    current_rows AS (
      SELECT r.*
      FROM all_rows r
      CROSS JOIN period_bounds pb
      WHERE r.pd >= pb.current_start AND r.pd <= pb.current_end
    ),
    prev_rows AS (
      SELECT r.*
      FROM all_rows r
      CROSS JOIN period_bounds pb
      WHERE r.pd >= pb.prev_start AND r.pd <= pb.prev_end
    ),
    salesman_totals AS (
      SELECT
        salesman_name,
        SUM(premium_wan) AS salesman_premium_wan
      FROM current_rows
      GROUP BY salesman_name
    ),
    current_group AS (
      SELECT
        group_name,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car) AND (NOT is_renewal) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN (NOT is_renewal) AND is_new_car THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN (NOT is_new_car) AND (NOT is_renewal) AND is_transfer THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN plan_vehicle * premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
      GROUP BY group_name
    ),
    prev_group AS (
      SELECT
        group_name,
        SUM(premium_wan) AS prev_premium
      FROM prev_rows
      GROUP BY group_name
    ),
    metrics AS (
      SELECT
        c.group_name,
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        CASE
          WHEN ${hasAnnualPlanSql} = FALSE THEN NULL
          ELSE ROUND(c.allocated_plan, 4)
        END AS plan_premium,
        CASE
          WHEN ${hasAnnualPlanSql} = FALSE THEN NULL
          WHEN COALESCE(c.allocated_plan, 0) <= 0 THEN NULL
          ELSE ROUND(
            (c.premium * 100.0) / (c.allocated_plan / ${getPlanDenominator(timePeriod)}),
            2
          )
        END AS achievement_rate,
        CASE
          WHEN COALESCE(p.prev_premium, 0) = 0 THEN NULL
          ELSE ROUND((c.premium - p.prev_premium) * 100.0 / p.prev_premium, 2)
        END AS growth_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.nev_count * 100.0 / c.row_count, 2) END AS nev_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.renewal_count * 100.0 / c.row_count, 2) END AS renewal_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.transfer_business_count * 100.0 / c.row_count, 2) END AS transfer_business_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.new_car_count * 100.0 / c.row_count, 2) END AS new_car_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.transfer_count * 100.0 / c.row_count, 2) END AS transfer_rate
      FROM current_group c
      LEFT JOIN prev_group p ON c.group_name = p.group_name
      CROSS JOIN period_progress pp
    )
    SELECT
      m.*,
      CASE
        WHEN m.achievement_rate IS NULL OR m.growth_rate IS NULL THEN 'unknown'
        WHEN m.growth_rate >= 7 AND m.achievement_rate >= 100 THEN 'high_growth_high_achievement'
        WHEN m.growth_rate >= 7 AND m.achievement_rate < 100 THEN 'high_growth_low_achievement'
        WHEN m.growth_rate < 7 AND m.achievement_rate >= 100 THEN 'low_growth_high_achievement'
        ELSE 'low_growth_low_achievement'
      END AS quadrant
    FROM metrics m
    ORDER BY m.premium DESC
  `;

  logger.debug('Generated performance drilldown SQL', {
    segmentTag,
    timePeriod,
    growthMode,
    groupBy,
    drillDepth: drillPath.length,
    sqlLength: sql.length,
  });
  return sql;
}
