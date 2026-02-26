/**
 * 业绩分析 SQL 生成器（独立页面 /performance-analysis）
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';

export type PerformanceVehicleCategory = 'passenger' | 'business_passenger' | 'truck' | 'motorcycle';
export type PerformanceSegmentTag =
  | 'all'
  | 'non_business_passenger'
  | 'business_passenger'
  | 'business_truck'
  | 'non_business_truck'
  | 'motorcycle'
  // 兼容旧参数
  | 'truck';
export type PerformanceGrowthMode = 'mom' | 'yoy';
export type PerformanceTimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type PerformanceTrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type PerformanceSummaryExpandDims = 'none' | 'energy' | 'business_nature' | 'energy_business_nature';

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

type ExpandDimensionConfig = {
  labelExpr: string;
  keyExpr: string;
  orderExpr: string;
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

function coverageOrderExpr(expr = 'coverage_combination'): string {
  return `CASE ${expr}
    WHEN '整体' THEN 1
    WHEN '主全' THEN 2
    WHEN '交三' THEN 3
    WHEN '单交' THEN 4
    ELSE 99
  END`;
}

export function mapLegacyVehicleCategoryToSegmentTag(
  category: PerformanceVehicleCategory
): PerformanceSegmentTag {
  switch (category) {
    case 'passenger':
      return 'non_business_passenger';
    case 'business_passenger':
      return 'business_passenger';
    case 'truck':
      return 'truck';
    case 'motorcycle':
      return 'motorcycle';
  }
}

function segmentCaseExpr(colPrefix = ''): string {
  const categoryExpr = `COALESCE(TRIM(CAST(${colPrefix}customer_category AS VARCHAR)), '')`;
  return `
    CASE
      WHEN ${categoryExpr} IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')
        THEN 'non_business_passenger'
      WHEN ${categoryExpr} = '营业货车'
        THEN 'business_truck'
      WHEN ${categoryExpr} = '非营业货车'
        THEN 'non_business_truck'
      WHEN ${categoryExpr} = '摩托车'
        THEN 'motorcycle'
      WHEN ${categoryExpr} IN ('营业出租租赁', '营业公路客运', '营业城市公交')
        THEN 'business_passenger'
      WHEN ${categoryExpr} LIKE '%营业%' AND (
        ${categoryExpr} LIKE '%客车%'
        OR ${categoryExpr} LIKE '%出租%'
        OR ${categoryExpr} LIKE '%租赁%'
        OR ${categoryExpr} LIKE '%网约%'
        OR ${categoryExpr} LIKE '%客运%'
        OR ${categoryExpr} LIKE '%公交%'
      )
        THEN 'business_passenger'
      WHEN ${categoryExpr} LIKE '%营业%' AND ${categoryExpr} LIKE '%货车%'
        THEN 'business_truck'
      WHEN ${categoryExpr} LIKE '%货车%'
        THEN 'non_business_truck'
      WHEN ${categoryExpr} LIKE '%非营业%' AND ${categoryExpr} LIKE '%客车%'
        THEN 'non_business_passenger'
      ELSE 'other'
    END
  `;
}

export function getPerformanceSegmentFilter(
  segmentTag: PerformanceSegmentTag,
  colPrefix = ''
): string {
  if (segmentTag === 'all') return '1=1';
  if (segmentTag === 'truck') {
    return `(${segmentCaseExpr(colPrefix)} IN ('business_truck', 'non_business_truck'))`;
  }
  return `(${segmentCaseExpr(colPrefix)} = '${segmentTag}')`;
}

// 兼容旧逻辑（保留给旧测试/调用方）
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
          OR ${colPrefix}customer_category LIKE '%客运%'
          OR ${colPrefix}customer_category LIKE '%公交%'
        )
      )`;
    case 'truck':
      return `${colPrefix}customer_category LIKE '%货车%'`;
    case 'motorcycle':
      return `${colPrefix}customer_category = '摩托车'`;
  }
}

function getPeriodExpressions(
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): { currentStart: string; currentEnd: string; prevStart: string; prevEnd: string } {
  let currentStart = 'ref_date';
  let currentEnd = 'ref_date';

  switch (timePeriod) {
    case 'day':
      break;
    case 'week':
      currentStart = `DATE_TRUNC('week', ref_date)`;
      break;
    case 'month':
      currentStart = `DATE_TRUNC('month', ref_date)`;
      break;
    case 'quarter':
      currentStart = `DATE_TRUNC('quarter', ref_date)`;
      break;
    case 'year':
      currentStart = `DATE_TRUNC('year', ref_date)`;
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
        break;
    }
  }

  return { currentStart, currentEnd, prevStart, prevEnd };
}

function buildPeriodBoundsCte(
  whereWithDate: string,
  segmentFilter: string,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): string {
  const { currentStart, currentEnd, prevStart, prevEnd } = getPeriodExpressions(timePeriod, growthMode);
  return `
    reference_date AS (
      SELECT COALESCE(MAX(CAST(policy_date AS DATE)), CURRENT_DATE) AS ref_date
      FROM PolicyFact
      WHERE ${whereWithDate}
        AND ${segmentFilter}
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

function buildPeriodProgressCte(): string {
  return `
    period_years AS (
      SELECT
        pb.current_start,
        pb.current_end,
        gs.year_num AS year_num,
        GREATEST(pb.current_start, MAKE_DATE(gs.year_num, 1, 1)) AS seg_start,
        LEAST(pb.current_end, MAKE_DATE(gs.year_num, 12, 31)) AS seg_end
      FROM period_bounds pb
      CROSS JOIN generate_series(
        CAST(EXTRACT(YEAR FROM pb.current_start) AS INTEGER),
        CAST(EXTRACT(YEAR FROM pb.current_end) AS INTEGER)
      ) AS gs(year_num)
    ),
    period_progress AS (
      SELECT
        CASE
          WHEN pb.current_end < pb.current_start THEN 0
          ELSE DATE_DIFF('day', pb.current_start, pb.current_end) + 1
        END AS total_days,
        CASE
          -- DC-002 Exception: 时间进度达成率必须用自然日“已过天数”
          WHEN LEAST(CAST(CURRENT_DATE AS DATE), pb.current_end) < pb.current_start THEN 0
          ELSE DATE_DIFF('day', pb.current_start, LEAST(CAST(CURRENT_DATE AS DATE), pb.current_end)) + 1
        END AS elapsed_days,
        COALESCE(
          SUM(
            CASE
              WHEN py.seg_end < py.seg_start THEN 0
              ELSE
                (DATE_DIFF('day', py.seg_start, py.seg_end) + 1) * 1.0
                / CASE
                    WHEN (py.year_num % 400 = 0) OR (py.year_num % 4 = 0 AND py.year_num % 100 <> 0)
                      THEN 366
                    ELSE 365
                  END
            END
          ),
          0
        ) AS period_plan_ratio
      FROM period_bounds pb
      LEFT JOIN period_years py ON 1 = 1
    )
  `;
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

function getExpandDimensionConfig(expandDims: PerformanceSummaryExpandDims): ExpandDimensionConfig {
  const energyLabelExpr = `CASE WHEN is_nev_bool THEN '电' ELSE '油' END`;
  const energyKeyExpr = `CASE WHEN is_nev_bool THEN 'electric' ELSE 'oil' END`;
  const energyOrderExpr = `CASE WHEN is_nev_bool THEN 2 ELSE 1 END`;

  const natureLabelExpr = `CASE WHEN is_renewal_bool THEN '续' WHEN is_new_car_bool THEN '新' ELSE '转' END`;
  const natureKeyExpr = `CASE WHEN is_renewal_bool THEN 'renewal' WHEN is_new_car_bool THEN 'new' ELSE 'transfer' END`;
  const natureOrderExpr = `CASE WHEN is_renewal_bool THEN 1 WHEN is_new_car_bool THEN 2 ELSE 3 END`;

  if (expandDims === 'energy') {
    return {
      labelExpr: energyLabelExpr,
      keyExpr: energyKeyExpr,
      orderExpr: energyOrderExpr,
    };
  }

  if (expandDims === 'business_nature') {
    return {
      labelExpr: natureLabelExpr,
      keyExpr: natureKeyExpr,
      orderExpr: natureOrderExpr,
    };
  }

  return {
    labelExpr: `(${energyLabelExpr}) || '+' || (${natureLabelExpr})`,
    keyExpr: `(${energyKeyExpr}) || '_' || (${natureKeyExpr})`,
    orderExpr: `(CASE WHEN is_nev_bool THEN 3 ELSE 0 END) + (${natureOrderExpr})`,
  };
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

function getTrendLineSourceSql(segmentTag: PerformanceSegmentTag): string {
  if (segmentTag === 'all') {
    return `
      SELECT 'overall' AS line_key, '整体' AS line_label, 1 AS line_order, pd, dedup_key, premium_wan FROM selected_rows
      UNION ALL
      SELECT 'non_business_passenger', '非营客', 2, pd, dedup_key, premium_wan FROM selected_rows WHERE segment_tag = 'non_business_passenger'
      UNION ALL
      SELECT 'business_passenger', '营客', 3, pd, dedup_key, premium_wan FROM selected_rows WHERE segment_tag = 'business_passenger'
      UNION ALL
      SELECT 'business_truck', '营货', 4, pd, dedup_key, premium_wan FROM selected_rows WHERE segment_tag = 'business_truck'
      UNION ALL
      SELECT 'non_business_truck', '非营货', 5, pd, dedup_key, premium_wan FROM selected_rows WHERE segment_tag = 'non_business_truck'
      UNION ALL
      SELECT 'motorcycle', '摩托车', 6, pd, dedup_key, premium_wan FROM selected_rows WHERE segment_tag = 'motorcycle'
    `;
  }

  if (segmentTag === 'non_business_passenger') {
    return `
      SELECT 'overall' AS line_key, '非营客整体' AS line_label, 1 AS line_order, pd, dedup_key, premium_wan FROM selected_rows
      UNION ALL
      SELECT 'non_business_personal', '非营业个人客车', 2, pd, dedup_key, premium_wan FROM selected_rows WHERE customer_category = '非营业个人客车'
      UNION ALL
      SELECT 'non_business_enterprise', '非营业企业客车', 3, pd, dedup_key, premium_wan FROM selected_rows WHERE customer_category = '非营业企业客车'
      UNION ALL
      SELECT 'non_business_agency', '非营业机关客车', 4, pd, dedup_key, premium_wan FROM selected_rows WHERE customer_category = '非营业机关客车'
    `;
  }

  if (segmentTag === 'business_truck' || segmentTag === 'non_business_truck' || segmentTag === 'truck') {
    return `
      SELECT 'overall' AS line_key, '整体' AS line_label, 1 AS line_order, pd, dedup_key, premium_wan FROM selected_rows
      UNION ALL
      SELECT
        'tonnage_' || REPLACE(REPLACE(norm_tonnage, '-', '_'), '吨', '') AS line_key,
        norm_tonnage AS line_label,
        1 + CASE norm_tonnage
          WHEN '1吨以下' THEN 1
          WHEN '1-2吨' THEN 2
          WHEN '2-9吨' THEN 3
          WHEN '9-10吨' THEN 4
          WHEN '10吨以上' THEN 5
          ELSE 99
        END AS line_order,
        pd,
        dedup_key,
        premium_wan
      FROM selected_rows
    `;
  }

  return `
    SELECT 'overall' AS line_key, '整体' AS line_label, 1 AS line_order, pd, dedup_key, premium_wan FROM selected_rows
  `;
}

export function generatePerformanceSummaryQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  expandDims: PerformanceSummaryExpandDims = 'none'
): string {
  const segmentFilter = getPerformanceSegmentFilter(segmentTag);
  const periodBounds = buildPeriodBoundsCte(whereWithDate, segmentFilter, timePeriod, growthMode);
  const useExpandRows = expandDims !== 'none';
  const expandConfig = useExpandRows ? getExpandDimensionConfig(expandDims) : null;

  const summarySql = useExpandRows
    ? `
    ,
    child_current AS (
      SELECT
        '整体' AS coverage_combination,
        ${expandConfig!.labelExpr} AS row_label,
        ${expandConfig!.keyExpr} AS expand_key,
        ${expandConfig!.orderExpr} AS child_order,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count
      FROM current_rows
      GROUP BY row_label, expand_key, child_order
      UNION ALL
      SELECT
        coverage_combination,
        ${expandConfig!.labelExpr} AS row_label,
        ${expandConfig!.keyExpr} AS expand_key,
        ${expandConfig!.orderExpr} AS child_order,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count
      FROM current_rows
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination, row_label, expand_key, child_order
    ),
    child_prev AS (
      SELECT
        '整体' AS coverage_combination,
        ${expandConfig!.keyExpr} AS expand_key,
        SUM(premium_wan) AS premium
      FROM prev_rows
      GROUP BY expand_key
      UNION ALL
      SELECT
        coverage_combination,
        ${expandConfig!.keyExpr} AS expand_key,
        SUM(premium_wan) AS premium
      FROM prev_rows
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination, expand_key
    ),
    child_metrics AS (
      SELECT
        c.coverage_combination,
        c.row_label,
        1 AS row_level,
        c.expand_key,
        c.child_order,
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.premium * 10000.0 / c.auto_count, 2) END AS avg_premium,
        CASE
          WHEN COALESCE(p.premium, 0) = 0 THEN NULL
          ELSE ROUND((c.premium - p.premium) * 100.0 / p.premium, 2)
        END AS growth_rate
      FROM child_current c
      LEFT JOIN child_prev p
        ON c.coverage_combination = p.coverage_combination
        AND c.expand_key = p.expand_key
    )
    SELECT
      coverage_combination,
      row_label,
      row_level,
      expand_key,
      premium,
      auto_count,
      avg_premium,
      growth_rate
    FROM parent_metrics
    UNION ALL
    SELECT
      coverage_combination,
      row_label,
      row_level,
      expand_key,
      premium,
      auto_count,
      avg_premium,
      growth_rate
    FROM child_metrics
    ORDER BY
      ${coverageOrderExpr()},
      row_level,
      CASE WHEN row_level = 0 THEN 0 ELSE child_order END
  `
    : `
    SELECT
      coverage_combination,
      row_label,
      row_level,
      expand_key,
      premium,
      auto_count,
      avg_premium,
      growth_rate
    FROM parent_metrics
    ORDER BY ${coverageOrderExpr()}
  `;

  const sql = `
    WITH
    ${periodBounds},
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
        CASE WHEN ${truthyExpr('is_nev')} THEN true ELSE false END AS is_nev_bool,
        CASE WHEN ${truthyExpr('is_renewal')} THEN true ELSE false END AS is_renewal_bool,
        CASE WHEN ${truthyExpr('is_new_car')} THEN true ELSE false END AS is_new_car_bool
      FROM PolicyFact
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
    parent_current AS (
      SELECT
        '整体' AS coverage_combination,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count
      FROM current_rows
      UNION ALL
      SELECT
        coverage_combination,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count
      FROM current_rows
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination
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
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.premium * 10000.0 / c.auto_count, 2) END AS avg_premium,
        CASE
          WHEN COALESCE(p.premium, 0) = 0 THEN NULL
          ELSE ROUND((c.premium - p.premium) * 100.0 / p.premium, 2)
        END AS growth_rate
      FROM parent_current c
      LEFT JOIN parent_prev p ON c.coverage_combination = p.coverage_combination
    )
    ${summarySql}
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
  groupBy: PerformanceDimension | null = null
): string {
  const segmentFilterNoAlias = getPerformanceSegmentFilter(segmentTag);
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, 'p.');
  const periodBounds = buildPeriodBoundsCte(whereWithDate, segmentFilterNoAlias, timePeriod, growthMode);
  const periodProgress = buildPeriodProgressCte();
  const groupCfg = getGroupByConfig(groupBy, 'p.');

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
      LEFT JOIN achievement_cache ac ON p.salesman_name = ac.full_name
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
        SUM(CASE WHEN is_new_car THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) AS transfer_count,
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
          WHEN pp.total_days <= 0 THEN NULL
          WHEN COALESCE(c.allocated_plan, 0) <= 0 OR COALESCE(pp.period_plan_ratio, 0) <= 0 THEN NULL
          WHEN COALESCE(pp.elapsed_days, 0) <= 0 THEN 0
          ELSE ROUND(
            (c.premium / (c.allocated_plan * pp.period_plan_ratio))
            * (pp.elapsed_days * 100.0 / pp.total_days),
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
  limit = 20
): string {
  const segmentFilterNoAlias = getPerformanceSegmentFilter(segmentTag);
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, 'p.');
  const periodBounds = buildPeriodBoundsCte(whereWithDate, segmentFilterNoAlias, timePeriod, growthMode);
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
      LEFT JOIN achievement_cache ac ON p.salesman_name = ac.full_name
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
        SUM(CASE WHEN is_new_car THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer THEN 1 ELSE 0 END) AS transfer_count,
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
        CASE
          WHEN pp.total_days <= 0 THEN NULL
          WHEN COALESCE(c.allocated_plan, 0) <= 0 OR COALESCE(pp.period_plan_ratio, 0) <= 0 THEN NULL
          WHEN COALESCE(pp.elapsed_days, 0) <= 0 THEN 0
          ELSE ROUND(
            (c.premium / (c.allocated_plan * pp.period_plan_ratio))
            * (pp.elapsed_days * 100.0 / pp.total_days),
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
