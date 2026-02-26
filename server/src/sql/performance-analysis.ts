/**
 * 业绩分析 SQL 生成器
 *
 * 新增独立页面 /performance-analysis 使用：
 * - 险别组合业绩环比（保费/件数/件均/增长率）
 * - 保费/件数走势
 * - 下钻分组（达成率 + 增长率 + 结构占比）
 * - TOP20 业务员
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';

export type PerformanceVehicleCategory = 'passenger' | 'business_passenger' | 'truck' | 'motorcycle';
export type PerformanceGrowthMode = 'mom' | 'yoy';
export type PerformanceTimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type PerformanceTrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type PerformanceDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal';

export interface PerformanceDrilldownStep {
  dimension: PerformanceDimension;
  value: string;
}

type GroupByConfig = {
  selectExpr: string;
  groupByExpr: string;
};

const BOOL_DIMENSIONS: Record<string, { field: string; trueLabel: string; falseLabel: string }> = {
  is_new_car: { field: 'is_new_car', trueLabel: '新车', falseLabel: '旧车' },
  is_transfer: { field: 'is_transfer', trueLabel: '过户车', falseLabel: '非过户车' },
  is_nev: { field: 'is_nev', trueLabel: '新能源', falseLabel: '非新能源' },
  is_telemarketing: { field: 'is_telemarketing', trueLabel: '电销', falseLabel: '非电销' },
  is_renewal: { field: 'is_renewal', trueLabel: '续保', falseLabel: '新保' },
};

function truthyExpr(fieldExpr: string): string {
  return `(
    TRY_CAST(${fieldExpr} AS BOOLEAN) = true
    OR LOWER(TRIM(CAST(${fieldExpr} AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
  )`;
}

function getPeriodExpressions(
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): { currentStart: string; currentEnd: string; prevStart: string; prevEnd: string } {
  let currentStart = 'ref_date';
  let currentEnd = 'ref_date';

  switch (timePeriod) {
    case 'day':
      currentStart = 'ref_date';
      currentEnd = 'ref_date';
      break;
    case 'week':
      currentStart = `DATE_TRUNC('week', ref_date)`;
      currentEnd = 'ref_date';
      break;
    case 'month':
      currentStart = `DATE_TRUNC('month', ref_date)`;
      currentEnd = 'ref_date';
      break;
    case 'quarter':
      currentStart = `DATE_TRUNC('quarter', ref_date)`;
      currentEnd = 'ref_date';
      break;
    case 'year':
      currentStart = `DATE_TRUNC('year', ref_date)`;
      currentEnd = 'ref_date';
      break;
  }

  let prevStart: string;
  let prevEnd: string;

  if (growthMode === 'yoy' || timePeriod === 'year') {
    prevStart = `(${currentStart}) - INTERVAL 1 YEAR`;
    prevEnd = `(${currentEnd}) - INTERVAL 1 YEAR`;
  } else {
    switch (timePeriod) {
      case 'day':
        prevStart = `(${currentStart}) - INTERVAL 1 DAY`;
        prevEnd = `(${currentEnd}) - INTERVAL 1 DAY`;
        break;
      case 'week':
        prevStart = `(${currentStart}) - INTERVAL 7 DAY`;
        prevEnd = `(${currentStart}) - INTERVAL 1 DAY`;
        break;
      case 'month':
        prevStart = `(${currentStart}) - INTERVAL 1 MONTH`;
        prevEnd = `(${currentStart}) - INTERVAL 1 DAY`;
        break;
      case 'quarter':
        prevStart = `(${currentStart}) - INTERVAL 3 MONTH`;
        prevEnd = `(${currentStart}) - INTERVAL 1 DAY`;
        break;
      default:
        prevStart = `(${currentStart}) - INTERVAL 1 YEAR`;
        prevEnd = `(${currentEnd}) - INTERVAL 1 YEAR`;
    }
  }

  return { currentStart, currentEnd, prevStart, prevEnd };
}

function buildPeriodBoundsCte(
  whereWithDate: string,
  vehicleFilter: string,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): string {
  const { currentStart, currentEnd, prevStart, prevEnd } = getPeriodExpressions(timePeriod, growthMode);
  return `
    reference_date AS (
      SELECT COALESCE(MAX(CAST(policy_date AS DATE)), CURRENT_DATE) AS ref_date
      FROM PolicyFact
      WHERE ${whereWithDate}
        AND ${vehicleFilter}
    ),
    period_bounds AS (
      SELECT
        ref_date,
        CAST(${currentStart} AS DATE) AS current_start,
        CAST(${currentEnd} AS DATE) AS current_end,
        CAST(${prevStart} AS DATE) AS prev_start,
        CAST(${prevEnd} AS DATE) AS prev_end
      FROM reference_date
    )
  `;
}

export function getPerformanceVehicleCategoryFilter(
  category: PerformanceVehicleCategory,
  colPrefix = ''
): string {
  switch (category) {
    case 'passenger':
      return `${colPrefix}customer_category IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')`;
    case 'business_passenger':
      return `(
        ${colPrefix}customer_category LIKE '%营业%'
        AND (
          ${colPrefix}customer_category LIKE '%客车%'
          OR ${colPrefix}customer_category LIKE '%出租%'
          OR ${colPrefix}customer_category LIKE '%租赁%'
          OR ${colPrefix}customer_category LIKE '%网约%'
        )
      )`;
    case 'truck':
      return `${colPrefix}customer_category LIKE '%货车%'`;
    case 'motorcycle':
      return `${colPrefix}customer_category = '摩托车'`;
  }
}

function drillStepToWhere(step: PerformanceDrilldownStep, colPrefix: string): string {
  const esc = escapeSqlValue;
  const boolDef = BOOL_DIMENSIONS[step.dimension];
  if (boolDef) {
    if (step.value === boolDef.trueLabel) {
      return truthyExpr(`${colPrefix}${boolDef.field}`);
    }
    return `NOT ${truthyExpr(`${colPrefix}${boolDef.field}`)}`;
  }

  switch (step.dimension) {
    case 'org_level_3':
      return `${colPrefix}org_level_3 = '${esc(step.value)}'`;
    case 'team':
      return `COALESCE(tm.team_name, '未归属团队') = '${esc(step.value)}'`;
    case 'salesman':
      return `REGEXP_REPLACE(${colPrefix}salesman_name, '^[0-9]+', '') = '${esc(step.value)}'`;
    case 'customer_category':
      return `COALESCE(${colPrefix}customer_category, '未知') = '${esc(step.value)}'`;
    default:
      return '1=1';
  }
}

function getGroupByConfig(dimension: PerformanceDimension | null, colPrefix: string): GroupByConfig {
  if (!dimension) {
    return {
      selectExpr: `'分公司整体' AS group_name`,
      groupByExpr: `'分公司整体'`,
    };
  }

  const boolDef = BOOL_DIMENSIONS[dimension];
  if (boolDef) {
    return {
      selectExpr: `CASE WHEN ${truthyExpr(`${colPrefix}${boolDef.field}`)} THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END AS group_name`,
      groupByExpr: `CASE WHEN ${truthyExpr(`${colPrefix}${boolDef.field}`)} THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END`,
    };
  }

  switch (dimension) {
    case 'org_level_3':
      return {
        selectExpr: `COALESCE(${colPrefix}org_level_3, '未知') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}org_level_3, '未知')`,
      };
    case 'team':
      return {
        selectExpr: `COALESCE(tm.team_name, '未归属团队') AS group_name`,
        groupByExpr: `COALESCE(tm.team_name, '未归属团队')`,
      };
    case 'salesman':
      return {
        selectExpr: `REGEXP_REPLACE(COALESCE(${colPrefix}salesman_name, '未知'), '^[0-9]+', '') AS group_name`,
        groupByExpr: `REGEXP_REPLACE(COALESCE(${colPrefix}salesman_name, '未知'), '^[0-9]+', '')`,
      };
    case 'customer_category':
      return {
        selectExpr: `COALESCE(${colPrefix}customer_category, '未知') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}customer_category, '未知')`,
      };
    default:
      return {
        selectExpr: `'分公司整体' AS group_name`,
        groupByExpr: `'分公司整体'`,
      };
  }
}

function trendTimeGroupExpr(granularity: PerformanceTrendGranularity): string {
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

export function generatePerformanceSummaryQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  vehicleCategory: PerformanceVehicleCategory,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): string {
  const vehicleFilter = getPerformanceVehicleCategoryFilter(vehicleCategory);
  const periodBounds = buildPeriodBoundsCte(whereWithDate, vehicleFilter, timePeriod, growthMode);

  const sql = `
    WITH
    ${periodBounds},
    filtered AS (
      SELECT
        CASE
          WHEN coverage_combination IN ('主全', '交三', '单交') THEN coverage_combination
          ELSE '其他'
        END AS coverage_combination,
        COALESCE(
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN premium > 0 THEN premium / 10000.0 ELSE 0 END AS premium_wan,
        CAST(policy_date AS DATE) AS pd
      FROM PolicyFact
      WHERE ${whereWithoutDate}
        AND ${vehicleFilter}
    ),
    current_cov AS (
      SELECT
        coverage_combination,
        COALESCE(SUM(premium_wan), 0) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count
      FROM filtered
      CROSS JOIN period_bounds
      WHERE pd >= current_start AND pd <= current_end
      GROUP BY coverage_combination
    ),
    prev_cov AS (
      SELECT
        coverage_combination,
        COALESCE(SUM(premium_wan), 0) AS premium
      FROM filtered
      CROSS JOIN period_bounds
      WHERE pd >= prev_start AND pd <= prev_end
      GROUP BY coverage_combination
    ),
    current_combined AS (
      SELECT '整体' AS coverage_combination, COALESCE(SUM(premium), 0) AS premium, COALESCE(SUM(auto_count), 0) AS auto_count
      FROM current_cov
      UNION ALL
      SELECT coverage_combination, premium, auto_count
      FROM current_cov
      WHERE coverage_combination IN ('主全', '交三', '单交')
    ),
    prev_combined AS (
      SELECT '整体' AS coverage_combination, COALESCE(SUM(premium), 0) AS premium
      FROM prev_cov
      UNION ALL
      SELECT coverage_combination, premium
      FROM prev_cov
      WHERE coverage_combination IN ('主全', '交三', '单交')
    )
    SELECT
      c.coverage_combination,
      ROUND(c.premium, 2) AS premium,
      c.auto_count,
      CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.premium * 10000.0 / c.auto_count, 2) END AS avg_premium,
      CASE
        WHEN COALESCE(p.premium, 0) = 0 THEN NULL
        ELSE ROUND((c.premium - p.premium) * 100.0 / p.premium, 2)
      END AS growth_rate
    FROM current_combined c
    LEFT JOIN prev_combined p ON c.coverage_combination = p.coverage_combination
    ORDER BY
      CASE c.coverage_combination
        WHEN '整体' THEN 1
        WHEN '主全' THEN 2
        WHEN '交三' THEN 3
        WHEN '单交' THEN 4
        ELSE 5
      END
  `;

  logger.debug('Generated performance summary SQL', {
    vehicleCategory,
    timePeriod,
    growthMode,
    sqlLength: sql.length,
  });
  return sql;
}

export function generatePerformanceTrendQuery(
  whereWithDate: string,
  vehicleCategory: PerformanceVehicleCategory,
  granularity: PerformanceTrendGranularity
): string {
  const vehicleFilter = getPerformanceVehicleCategoryFilter(vehicleCategory);
  const timeExpr = trendTimeGroupExpr(granularity);

  const sql = `
    WITH filtered AS (
      SELECT
        CAST(policy_date AS DATE) AS pd,
        COALESCE(
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN premium > 0 THEN premium / 10000.0 ELSE 0 END AS premium_wan
      FROM PolicyFact
      WHERE ${whereWithDate}
        AND ${vehicleFilter}
    )
    SELECT
      ${timeExpr} AS time_period,
      ROUND(SUM(premium_wan), 2) AS premium,
      COUNT(DISTINCT dedup_key) AS auto_count
    FROM filtered
    GROUP BY 1
    ORDER BY 1
  `;

  logger.debug('Generated performance trend SQL', {
    vehicleCategory,
    granularity,
    sqlLength: sql.length,
  });
  return sql;
}

export function generatePerformanceDrilldownQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  vehicleCategory: PerformanceVehicleCategory,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  drillPath: PerformanceDrilldownStep[] = [],
  groupBy: PerformanceDimension | null = null
): string {
  const vehicleFilterNoAlias = getPerformanceVehicleCategoryFilter(vehicleCategory);
  const vehicleFilter = getPerformanceVehicleCategoryFilter(vehicleCategory, 'p.');
  const periodBounds = buildPeriodBoundsCte(whereWithDate, vehicleFilterNoAlias, timePeriod, growthMode);
  const groupCfg = getGroupByConfig(groupBy, 'p.');

  const stepWheres = drillPath.map((step) => drillStepToWhere(step, 'p.'));
  const drillWhere = stepWheres.length > 0 ? `AND ${stepWheres.join('\n        AND ')}` : '';

  const sql = `
    WITH
    ${periodBounds},
    all_rows AS (
      SELECT
        ${groupCfg.selectExpr},
        CAST(p.policy_date AS DATE) AS pd,
        p.salesman_name,
        p.org_level_3,
        COALESCE(
          NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN p.premium > 0 THEN p.premium / 10000.0 ELSE 0 END AS premium_wan,
        CASE WHEN ${truthyExpr('p.is_nev')} THEN true ELSE false END AS is_nev,
        CASE WHEN ${truthyExpr('p.is_renewal')} THEN true ELSE false END AS is_renewal,
        CASE WHEN ${truthyExpr('p.is_new_car')} THEN true ELSE false END AS is_new_car,
        CASE WHEN ${truthyExpr('p.is_transfer')} THEN true ELSE false END AS is_transfer,
        COALESCE(ac.plan_vehicle, 0) AS plan_vehicle,
        COALESCE(ac.time_progress, 1.0) AS time_progress
      FROM PolicyFact p
      LEFT JOIN SalesmanTeamMapping tm ON p.salesman_name = tm.full_name
      LEFT JOIN achievement_cache ac ON p.salesman_name = ac.full_name
      WHERE ${whereWithoutDate}
        AND ${vehicleFilter}
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
        SUM(CASE WHEN is_new_car THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN plan_vehicle * premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan,
        MAX(time_progress) AS time_progress
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
    )
    SELECT
      c.group_name,
      ROUND(c.premium, 2) AS premium,
      c.auto_count,
      CASE
        WHEN c.allocated_plan > 0 AND c.time_progress > 0
          THEN ROUND(c.premium * 100.0 / (c.allocated_plan * c.time_progress), 2)
        ELSE NULL
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
    ORDER BY c.premium DESC
  `;

  logger.debug('Generated performance drilldown SQL', {
    vehicleCategory,
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
  vehicleCategory: PerformanceVehicleCategory,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  limit = 20
): string {
  const vehicleFilterNoAlias = getPerformanceVehicleCategoryFilter(vehicleCategory);
  const vehicleFilter = getPerformanceVehicleCategoryFilter(vehicleCategory, 'p.');
  const periodBounds = buildPeriodBoundsCte(whereWithDate, vehicleFilterNoAlias, timePeriod, growthMode);

  const sql = `
    WITH
    ${periodBounds},
    all_rows AS (
      SELECT
        REGEXP_REPLACE(COALESCE(p.salesman_name, '未知'), '^[0-9]+', '') AS dimension_name,
        COALESCE(p.org_level_3, '未知') AS org_level_3,
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
        COALESCE(ac.plan_vehicle, 0) AS plan_vehicle,
        COALESCE(ac.time_progress, 1.0) AS time_progress
      FROM PolicyFact p
      LEFT JOIN achievement_cache ac ON p.salesman_name = ac.full_name
      WHERE ${whereWithoutDate}
        AND ${vehicleFilter}
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
        org_level_3,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car) AND (NOT is_renewal) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN is_new_car THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN plan_vehicle * premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan,
        MAX(time_progress) AS time_progress
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
      GROUP BY dimension_name, org_level_3
    ),
    prev_group AS (
      SELECT
        dimension_name,
        org_level_3,
        SUM(premium_wan) AS prev_premium
      FROM prev_rows
      GROUP BY dimension_name, org_level_3
    )
    SELECT
      c.dimension_name,
      c.org_level_3,
      ROUND(c.premium, 2) AS premium,
      c.auto_count,
      CASE
        WHEN c.allocated_plan > 0 AND c.time_progress > 0
          THEN ROUND(c.premium * 100.0 / (c.allocated_plan * c.time_progress), 2)
        ELSE NULL
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
    LEFT JOIN prev_group p
      ON c.dimension_name = p.dimension_name
      AND c.org_level_3 = p.org_level_3
    ORDER BY achievement_rate ASC NULLS LAST, premium DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `;

  logger.debug('Generated performance top-salesman SQL', {
    vehicleCategory,
    timePeriod,
    growthMode,
    limit,
    sqlLength: sql.length,
  });
  return sql;
}

