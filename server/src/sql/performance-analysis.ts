/**
 * 业绩分析 SQL 生成器（独立页面 /performance-analysis）
 *
 * 5 个核心查询生成器：Summary / PeriodBounds / Trend / Drilldown / TopSalesman。
 * 热力图生成器在 performance-heatmap.ts，共享类型与辅助函数在 performance-analysis-shared.ts。
 *
 * @see P1#9 架构优化计划
 */

import { logger } from '../utils/logger.js';
import {
  truthyExpr,
  coverageOrderExpr,
  segmentCaseExpr,
  getPerformanceSegmentFilter,
  getPlanDenominator,
  buildPeriodBoundsCte,
  buildStaticPeriodBoundsCte,
  buildPeriodProgressCte,
  trendTimeGroupExpr,
  getExpandDimensionConfig,
  drillStepToWhere,
  getGroupByConfig,
  supportsAnnualPlanByDimension,
  getTrendLineSourceSql,
  type PerformanceSegmentTag,
  type PerformanceTimePeriod,
  type PerformanceGrowthMode,
  type PerformanceTrendGranularity,
  type PerformanceSummaryExpandDims,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
  type PerformancePeriodBounds,
} from './performance-analysis-shared.js';

// ============================================================================
// Barrel re-exports — 调用方无需修改 import
// ============================================================================

export type {
  PerformanceVehicleCategory,
  PerformanceSegmentTag,
  PerformanceGrowthMode,
  PerformanceTimePeriod,
  PerformanceTrendGranularity,
  PerformanceSummaryExpandDims,
  PerformanceDimension,
  PerformanceDrilldownStep,
  PerformancePeriodBounds,
  GroupByConfig,
} from './performance-analysis-shared.js';

export {
  getPlanDenominator,
  mapLegacyVehicleCategoryToSegmentTag,
  getPerformanceSegmentFilter,
  getPerformanceVehicleCategoryFilter,
} from './performance-analysis-shared.js';

export type {
  HeatmapGroupDimension,
  HeatmapDrillStep,
} from './performance-heatmap.js';

export {
  HEATMAP_DIMENSION_LABELS,
  generatePerformanceOrgHeatmapQuery,
} from './performance-heatmap.js';

// ============================================================================
// 核心查询生成器
// ============================================================================

export function generatePerformanceSummaryQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  expandDims: PerformanceSummaryExpandDims = 'none',
  periodBoundsOverride?: PerformancePeriodBounds
): string {
  const segmentFilter = getPerformanceSegmentFilter(segmentTag);
  const periodBounds = periodBoundsOverride
    ? buildStaticPeriodBoundsCte(periodBoundsOverride)
    : buildPeriodBoundsCte(whereWithDate, segmentFilter, timePeriod, growthMode);
  const periodProgress = buildPeriodProgressCte();
  const useExpandRows = expandDims !== 'none';
  const expandConfig = useExpandRows ? getExpandDimensionConfig(expandDims) : null;

  // 业务性质指标聚合 SQL — 4个CTE共用，避免重复定义
  const businessMetricsSql = `
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev_bool THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal_bool THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car_bool) AND (NOT is_renewal_bool) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN (NOT is_renewal_bool) AND is_new_car_bool THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN (NOT is_new_car_bool) AND (NOT is_renewal_bool) AND is_transfer_bool THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN cr.plan_vehicle * cr.premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan`;

  const sql = `
    WITH
    ${periodBounds},
    ${periodProgress},
    filtered AS (
      SELECT
        CASE
          WHEN coverage_combination IN ('主全', '交三', '单交') THEN coverage_combination
          ELSE '其他'
        END AS coverage_combination,
        CAST(policy_date AS DATE) AS pd,
        COALESCE(
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN premium > 0 THEN premium / 10000.0 ELSE 0 END AS premium_wan,
        salesman_name,
        CASE WHEN ${truthyExpr('is_nev')} THEN true ELSE false END AS is_nev_bool,
        CASE WHEN ${truthyExpr('is_renewal')} THEN true ELSE false END AS is_renewal_bool,
        CASE WHEN ${truthyExpr('is_new_car')} THEN true ELSE false END AS is_new_car_bool,
        CASE WHEN ${truthyExpr('is_transfer')} THEN true ELSE false END AS is_transfer_bool,
        COALESCE(ac.plan_vehicle, 0) AS plan_vehicle
      FROM PolicyFact
      LEFT JOIN (SELECT full_name, SUM(plan_vehicle) AS plan_vehicle FROM achievement_cache GROUP BY full_name) ac ON PolicyFact.salesman_name = ac.full_name
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
    ),
    current_rows AS (
      SELECT f.*
      FROM filtered f
      CROSS JOIN period_bounds pb
      WHERE f.pd >= pb.current_start AND f.pd <= pb.current_end
    ),
    prev_rows AS (
      SELECT f.*
      FROM filtered f
      CROSS JOIN period_bounds pb
      WHERE f.pd >= pb.prev_start AND f.pd <= pb.prev_end
    ),
    salesman_totals AS (
      SELECT
        salesman_name,
        SUM(premium_wan) AS salesman_premium_wan
      FROM current_rows
      GROUP BY salesman_name
    ),
    parent_current_cov AS (
      SELECT
        coverage_combination,${businessMetricsSql}
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination
    ),
    parent_current_all AS (
      SELECT
        '整体' AS coverage_combination,${businessMetricsSql}
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
    ),
    parent_current AS (
      SELECT * FROM parent_current_all
      UNION ALL
      SELECT * FROM parent_current_cov
    ),
    parent_prev AS (
      SELECT
        '整体' AS coverage_combination,
        SUM(premium_wan) AS premium
      FROM prev_rows
      UNION ALL
      SELECT
        coverage_combination,
        SUM(premium_wan) AS premium
      FROM prev_rows
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination
    ),
    parent_metrics AS (
      SELECT
        c.coverage_combination,
        c.coverage_combination AS row_label,
        0 AS row_level,
        NULL::VARCHAR AS expand_key,
        ${coverageOrderExpr('c.coverage_combination')} AS coverage_order,
        0 AS child_order,
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.premium * 10000.0 / c.auto_count, 2) END AS avg_premium,
        NULL::DOUBLE AS plan_premium,
        NULL::DOUBLE AS achievement_rate,
        CASE
          WHEN COALESCE(p.premium, 0) = 0 THEN NULL
          ELSE ROUND((c.premium - p.premium) * 100.0 / p.premium, 2)
        END AS growth_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.nev_count * 100.0 / c.row_count, 2) END AS nev_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.renewal_count * 100.0 / c.row_count, 2) END AS renewal_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.transfer_business_count * 100.0 / c.row_count, 2) END AS transfer_business_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.new_car_count * 100.0 / c.row_count, 2) END AS new_car_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.transfer_count * 100.0 / c.row_count, 2) END AS transfer_rate
      FROM parent_current c
      LEFT JOIN parent_prev p ON c.coverage_combination = p.coverage_combination
      CROSS JOIN period_progress pp
    )
    ${useExpandRows ? `,
    child_current_cov AS (
      SELECT
        coverage_combination,
        ${expandConfig!.labelExpr} AS row_label,
        ${expandConfig!.keyExpr} AS expand_key,
        ${expandConfig!.orderExpr} AS child_order,${businessMetricsSql}
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination, row_label, expand_key, child_order
    ),
    child_current_all AS (
      SELECT
        '整体' AS coverage_combination,
        ${expandConfig!.labelExpr} AS row_label,
        ${expandConfig!.keyExpr} AS expand_key,
        ${expandConfig!.orderExpr} AS child_order,${businessMetricsSql}
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
      GROUP BY row_label, expand_key, child_order
    ),
    child_current AS (
      SELECT * FROM child_current_all
      UNION ALL
      SELECT * FROM child_current_cov
    ),
    child_prev_cov AS (
      SELECT
        coverage_combination,
        ${expandConfig!.keyExpr} AS expand_key,
        SUM(premium_wan) AS premium
      FROM prev_rows
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination, expand_key
    ),
    child_prev_all AS (
      SELECT
        '整体' AS coverage_combination,
        ${expandConfig!.keyExpr} AS expand_key,
        SUM(premium_wan) AS premium
      FROM prev_rows
      GROUP BY expand_key
    ),
    child_prev AS (
      SELECT * FROM child_prev_all
      UNION ALL
      SELECT * FROM child_prev_cov
    ),
    child_metrics AS (
      SELECT
        c.coverage_combination,
        c.row_label,
        1 AS row_level,
        c.expand_key,
        ${coverageOrderExpr('c.coverage_combination')} AS coverage_order,
        c.child_order,
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.premium * 10000.0 / c.auto_count, 2) END AS avg_premium,
        NULL::DOUBLE AS plan_premium,
        NULL::DOUBLE AS achievement_rate,
        CASE
          WHEN COALESCE(p.premium, 0) = 0 THEN NULL
          ELSE ROUND((c.premium - p.premium) * 100.0 / p.premium, 2)
        END AS growth_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.nev_count * 100.0 / c.row_count, 2) END AS nev_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.renewal_count * 100.0 / c.row_count, 2) END AS renewal_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.transfer_business_count * 100.0 / c.row_count, 2) END AS transfer_business_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.new_car_count * 100.0 / c.row_count, 2) END AS new_car_rate,
        CASE WHEN c.row_count = 0 THEN 0 ELSE ROUND(c.transfer_count * 100.0 / c.row_count, 2) END AS transfer_rate
      FROM child_current c
      LEFT JOIN child_prev p
        ON c.coverage_combination = p.coverage_combination
        AND c.expand_key = p.expand_key
      CROSS JOIN period_progress pp
    ),
    combined AS (
      SELECT * FROM parent_metrics
      UNION ALL
      SELECT * FROM child_metrics
    )
    SELECT
      coverage_combination,
      row_label,
      row_level,
      expand_key,
      premium,
      auto_count,
      avg_premium,
      plan_premium,
      achievement_rate,
      growth_rate,
      nev_rate,
      renewal_rate,
      transfer_business_rate,
      new_car_rate,
      transfer_rate
    FROM combined
    ORDER BY coverage_order, row_level, child_order` : `
    SELECT
      coverage_combination,
      row_label,
      row_level,
      expand_key,
      premium,
      auto_count,
      avg_premium,
      plan_premium,
      achievement_rate,
      growth_rate,
      nev_rate,
      renewal_rate,
      transfer_business_rate,
      new_car_rate,
      transfer_rate
    FROM parent_metrics
    ORDER BY coverage_order`}
  `;

  logger.debug('Generated performance summary SQL', {
    segmentTag,
    timePeriod,
    growthMode,
    expandDims,
    sqlLength: sql.length,
  });
  return sql;
}

export function generatePerformancePeriodBoundsQuery(
  whereWithDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): string {
  const segmentFilter = getPerformanceSegmentFilter(segmentTag);
  const periodBounds = buildPeriodBoundsCte(whereWithDate, segmentFilter, timePeriod, growthMode);
  return `
    WITH
    ${periodBounds}
    SELECT
      CAST(ref_date AS VARCHAR) AS ref_date,
      CAST(current_start AS VARCHAR) AS current_start,
      CAST(current_end AS VARCHAR) AS current_end,
      CAST(prev_start AS VARCHAR) AS prev_start,
      CAST(prev_end AS VARCHAR) AS prev_end
    FROM period_bounds
  `;
}

export function generatePerformanceTrendQuery(
  whereWithDate: string,
  segmentTag: PerformanceSegmentTag,
  granularity: PerformanceTrendGranularity
): string {
  const selectedFilter = getPerformanceSegmentFilter(segmentTag);
  const timeExpr = trendTimeGroupExpr(granularity);
  const lineSourceSql = getTrendLineSourceSql(segmentTag);

  const sql = `
    WITH base_rows AS (
      SELECT
        CAST(policy_date AS DATE) AS pd,
        COALESCE(
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN premium > 0 THEN premium / 10000.0 ELSE 0 END AS premium_wan,
        COALESCE(TRIM(CAST(customer_category AS VARCHAR)), '') AS customer_category,
        COALESCE(NULLIF(TRIM(CAST(tonnage_segment AS VARCHAR)), ''), '未知') AS norm_tonnage,
        ${segmentCaseExpr()} AS segment_tag
      FROM PolicyFact
      WHERE ${whereWithDate}
    ),
    selected_rows AS (
      SELECT *
      FROM base_rows
      WHERE ${selectedFilter}
    ),
    line_source AS (
      ${lineSourceSql}
    )
    SELECT
      ${timeExpr} AS time_period,
      line_key,
      line_label,
      line_order,
      ROUND(SUM(premium_wan), 4) AS premium,
      COUNT(DISTINCT dedup_key) AS auto_count
    FROM line_source
    GROUP BY time_period, line_key, line_label, line_order
    ORDER BY time_period, line_order
  `;

  logger.debug('Generated performance trend SQL', {
    segmentTag,
    granularity,
    sqlLength: sql.length,
  });
  return sql;
}

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

export function generatePerformanceTopSalesmanQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  limit = 20,
  periodBoundsOverride?: PerformancePeriodBounds
): string {
  const segmentFilterNoAlias = getPerformanceSegmentFilter(segmentTag);
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, 'p.');
  const periodBounds = periodBoundsOverride
    ? buildStaticPeriodBoundsCte(periodBoundsOverride)
    : buildPeriodBoundsCte(whereWithDate, segmentFilterNoAlias, timePeriod, growthMode);
  const periodProgress = buildPeriodProgressCte();

  const sql = `
    WITH
    ${periodBounds},
    ${periodProgress},
    all_rows AS (
      SELECT
        REGEXP_REPLACE(COALESCE(p.salesman_name, '未知'), '^[0-9]+', '') AS dimension_name,
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
      LEFT JOIN (SELECT full_name, SUM(plan_vehicle) AS plan_vehicle FROM achievement_cache GROUP BY full_name) ac ON p.salesman_name = ac.full_name
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
        AND p.salesman_name IS NOT NULL
        AND TRIM(p.salesman_name) != ''
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
        dimension_name,
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
      GROUP BY dimension_name
    ),
    prev_group AS (
      SELECT
        dimension_name,
        SUM(premium_wan) AS prev_premium
      FROM prev_rows
      GROUP BY dimension_name
    ),
    metrics AS (
      SELECT
        c.dimension_name,
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        ROUND(c.allocated_plan, 4) AS plan_premium,
        CASE
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
      LEFT JOIN prev_group p ON c.dimension_name = p.dimension_name
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
    ORDER BY m.achievement_rate ASC NULLS LAST, m.premium DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `;

  logger.debug('Generated performance top-salesman SQL', {
    segmentTag,
    timePeriod,
    growthMode,
    limit,
    sqlLength: sql.length,
  });
  return sql;
}
