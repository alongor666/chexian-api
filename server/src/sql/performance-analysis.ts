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

export function getPlanDenominator(timePeriod: PerformanceTimePeriod): number {
  switch (timePeriod) {
    case 'day': return 365;
    case 'week': return 52;
    case 'month': return 12;
    case 'quarter': return 4;
    case 'year': return 1;
    default: return 365;
  }
}

export type PerformanceTrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type PerformanceSummaryExpandDims = 'none' | 'energy' | 'business_nature' | 'energy_business_nature';

export type PerformanceDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'tonnage_segment'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal';

export interface PerformanceDrilldownStep {
  dimension: PerformanceDimension;
  value: string;
}

export interface PerformancePeriodBounds {
  refDate: string;
  currentStart: string;
  currentEnd: string;
  prevStart: string;
  prevEnd: string;
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

function buildStaticPeriodBoundsCte(bounds: PerformancePeriodBounds): string {
  const esc = escapeSqlValue;
  return `
    reference_date AS (
      SELECT CAST('${esc(bounds.refDate)}' AS DATE) AS ref_date
    ),
    period_bounds AS (
      SELECT
        ref_date,
        CAST('${esc(bounds.currentStart)}' AS DATE) AS current_start,
        CAST('${esc(bounds.currentEnd)}' AS DATE) AS current_end,
        CAST('${esc(bounds.prevStart)}' AS DATE) AS prev_start,
        CAST('${esc(bounds.prevEnd)}' AS DATE) AS prev_end
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
        MAX(
          CASE
            WHEN pb.current_end < pb.current_start THEN 0
            ELSE DATE_DIFF('day', pb.current_start, pb.current_end) + 1
          END
        ) AS total_days,
        MAX(
          CASE
            -- DC-002 Exception: 时间进度达成率必须用自然日“已过天数”
            WHEN LEAST(CAST(CURRENT_DATE AS DATE), pb.current_end) < pb.current_start THEN 0
            ELSE DATE_DIFF('day', pb.current_start, LEAST(CAST(CURRENT_DATE AS DATE), pb.current_end)) + 1
          END
        ) AS elapsed_days,
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

function normalizeSqlTableAliasPrefix(tableAlias = ''): string {
  const normalizedAlias = tableAlias.trim().replace(/\.+$/, '');
  return normalizedAlias ? `${normalizedAlias}.` : '';
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
    case 'tonnage_segment':
      return `COALESCE(${colPrefix}tonnage_segment, '未分段') = '${esc(step.value)}'`;
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
    case 'tonnage_segment':
      return {
        selectExpr: `COALESCE(${colPrefix}tonnage_segment, '未分段') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}tonnage_segment, '未分段')`,
      };
    default:
      return {
        selectExpr: `'分公司整体' AS group_name`,
        groupByExpr: `'分公司整体'`,
      };
  }
}

function supportsAnnualPlanByDimension(dimension: PerformanceDimension | null): boolean {
  return (
    dimension === null
    || dimension === 'org_level_3'
    || dimension === 'team'
    || dimension === 'salesman'
  );
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
      LEFT JOIN achievement_cache ac ON PolicyFact.salesman_name = ac.full_name
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
        coverage_combination,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev_bool THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal_bool THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car_bool) AND (NOT is_renewal_bool) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN is_new_car_bool THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer_bool THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN cr.plan_vehicle * cr.premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan
      FROM current_rows cr
      LEFT JOIN salesman_totals st ON cr.salesman_name = st.salesman_name
      WHERE coverage_combination IN ('主全', '交三', '单交')
      GROUP BY coverage_combination
    ),
    parent_current_all AS (
      SELECT
        '整体' AS coverage_combination,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev_bool THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal_bool THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car_bool) AND (NOT is_renewal_bool) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN is_new_car_bool THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer_bool THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN cr.plan_vehicle * cr.premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan
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
        ${expandConfig!.orderExpr} AS child_order,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev_bool THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal_bool THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car_bool) AND (NOT is_renewal_bool) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN is_new_car_bool THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer_bool THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN cr.plan_vehicle * cr.premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan
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
        ${expandConfig!.orderExpr} AS child_order,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT dedup_key) AS auto_count,
        COUNT(*) AS row_count,
        SUM(CASE WHEN is_nev_bool THEN 1 ELSE 0 END) AS nev_count,
        SUM(CASE WHEN is_renewal_bool THEN 1 ELSE 0 END) AS renewal_count,
        SUM(CASE WHEN (NOT is_new_car_bool) AND (NOT is_renewal_bool) THEN 1 ELSE 0 END) AS transfer_business_count,
        SUM(CASE WHEN is_new_car_bool THEN 1 ELSE 0 END) AS new_car_count,
        SUM(CASE WHEN is_transfer_bool THEN 1 ELSE 0 END) AS transfer_count,
        SUM(
          CASE
            WHEN COALESCE(st.salesman_premium_wan, 0) > 0
              THEN cr.plan_vehicle * cr.premium_wan / st.salesman_premium_wan
            ELSE 0
          END
        ) AS allocated_plan
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

/**
 * 热力图维度分组类型
 * 支持的常用维度：三级机构、团队、业务员、客户类别、险别组合、能源类型、新转续
 */
export type HeatmapGroupDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'coverage_combination'
  | 'energy_type'
  | 'business_nature';

export const HEATMAP_DIMENSION_LABELS: Record<HeatmapGroupDimension, string> = {
  org_level_3: '三级机构',
  team: '团队',
  salesman: '业务员',
  customer_category: '客户类别',
  coverage_combination: '险别组合',
  energy_type: '能源类型',
  business_nature: '新转续',
};

/** 热力图下钻步骤 */
export interface HeatmapDrillStep {
  dimension: string;
  value: string;
}

/**
 * 将下钻步骤转换为 WHERE 条件（用于 PolicyFact 表，有 p. 别名）
 */
function heatmapDrillToWhere(steps: HeatmapDrillStep[]): string {
  if (!steps || steps.length === 0) return '';
  const clauses = steps.map((step) => {
    const v = `'${escapeSqlValue(step.value)}'`;
    switch (step.dimension) {
      case 'org_level_3':
        return `TRIM(CAST(p.org_level_3 AS VARCHAR)) = ${v}`;
      case 'team':
        return `COALESCE(tm.team_name, '未归属团队') = ${v}`;
      case 'salesman':
        return `TRIM(CAST(p.salesman_name AS VARCHAR)) = ${v}`;
      case 'customer_category':
        return `TRIM(CAST(p.customer_category AS VARCHAR)) = ${v}`;
      case 'coverage_combination':
        return `TRIM(CAST(p.coverage_combination AS VARCHAR)) = ${v}`;
      case 'energy_type':
        return step.value === '新能源'
          ? `(TRY_CAST(p.is_nev AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_nev AS VARCHAR))) IN ('1','y','yes','true','t','是'))`
          : `NOT (TRY_CAST(p.is_nev AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_nev AS VARCHAR))) IN ('1','y','yes','true','t','是'))`;
      case 'business_nature':
        switch (step.value) {
          case '续保': return `(TRY_CAST(p.is_renewal AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_renewal AS VARCHAR))) IN ('1','y','yes','true','t','是'))`;
          case '新车': return `(TRY_CAST(p.is_new_car AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_new_car AS VARCHAR))) IN ('1','y','yes','true','t','是'))`;
          case '过户': return `(TRY_CAST(p.is_transfer AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_transfer AS VARCHAR))) IN ('1','y','yes','true','t','是'))`;
          default: return `NOT (TRY_CAST(p.is_renewal AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_renewal AS VARCHAR))) IN ('1','y','yes','true','t','是')) AND NOT (TRY_CAST(p.is_new_car AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_new_car AS VARCHAR))) IN ('1','y','yes','true','t','是')) AND NOT (TRY_CAST(p.is_transfer AS BOOLEAN) = true OR LOWER(TRIM(CAST(p.is_transfer AS VARCHAR))) IN ('1','y','yes','true','t','是'))`;
        }
      default:
        return 'TRUE';
    }
  });
  return clauses.join(' AND ');
}

/**
 * 获取热力图维度的 SQL SELECT 表达式和别名
 */
function getHeatmapGroupByExpr(
  dimension: HeatmapGroupDimension,
  tableAlias = ''
): { selectExpr: string; alias: string; label: string } {
  const prefix = normalizeSqlTableAliasPrefix(tableAlias);
  switch (dimension) {
    case 'team':
      return {
        selectExpr: `COALESCE(tm.team_name, '未归属团队')`,
        alias: 'dimension_value',
        label: '团队',
      };
    case 'salesman':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}salesman_name AS VARCHAR)), ''), '未知业务员')`,
        alias: 'dimension_value',
        label: '业务员',
      };
    case 'customer_category':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}customer_category AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
        label: '客户类别',
      };
    case 'coverage_combination':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}coverage_combination AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
        label: '险别组合',
      };
    case 'energy_type':
      return {
        selectExpr: `CASE WHEN ${truthyExpr(`${prefix}is_nev`)} THEN '新能源' ELSE '燃油' END`,
        alias: 'dimension_value',
        label: '能源类型',
      };
    case 'business_nature':
      return {
        selectExpr: `CASE
          WHEN ${truthyExpr(`${prefix}is_renewal`)} THEN '续保'
          WHEN ${truthyExpr(`${prefix}is_new_car`)} THEN '新车'
          WHEN ${truthyExpr(`${prefix}is_transfer`)} THEN '过户'
          ELSE '转保'
        END`,
        alias: 'dimension_value',
        label: '新转续',
      };
    default: // org_level_3
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}org_level_3 AS VARCHAR)), ''), '未知机构')`,
        alias: 'dimension_value',
        label: '三级机构',
      };
  }
}

export function generatePerformanceOrgHeatmapQuery(
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod = 'day',
  periods = 15,
  groupByDimension: HeatmapGroupDimension = 'org_level_3',
  drillFilter: HeatmapDrillStep[] = []
): string {
  const tableAlias = 'p.';
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, tableAlias);
  const safePeriods = Math.max(7, Math.min(31, Math.floor(periods)));
  const dimConfig = getHeatmapGroupByExpr(groupByDimension, tableAlias);
  const needsTeamJoin = groupByDimension === 'team' || drillFilter.some((s) => s.dimension === 'team');
  const drillWhereClause = heatmapDrillToWhere(drillFilter);
  const drillAnd = drillWhereClause ? `AND ${drillWhereClause}` : '';

  // 根据 timePeriod 动态生成 SQL 片段
  let truncExpr: string;        // 分组键：DATE_TRUNC 或原始日期
  let windowOffset: string;     // 窗口向前偏移量
  let seriesStep: string;       // generate_series 步长
  let momOffset: string;        // 环比偏移
  let yoyTruncExpr: string;     // 同比聚合的分组键
  let yoyOffset: string;        // 同比偏移
  const planDenom = getPlanDenominator(timePeriod);

  switch (timePeriod) {
    case 'week':
      truncExpr = `DATE_TRUNC('week', pd)::DATE`;
      windowOffset = `${safePeriods - 1} WEEK`;
      seriesStep = 'INTERVAL 1 WEEK';
      momOffset = 'INTERVAL 1 WEEK';
      yoyTruncExpr = `DATE_TRUNC('week', pd)::DATE`;
      yoyOffset = 'INTERVAL 1 YEAR';
      break;
    case 'month':
      truncExpr = `DATE_TRUNC('month', pd)::DATE`;
      windowOffset = `${safePeriods - 1} MONTH`;
      seriesStep = 'INTERVAL 1 MONTH';
      momOffset = 'INTERVAL 1 MONTH';
      yoyTruncExpr = `DATE_TRUNC('month', pd)::DATE`;
      yoyOffset = 'INTERVAL 1 YEAR';
      break;
    case 'quarter':
      truncExpr = `DATE_TRUNC('quarter', pd)::DATE`;
      windowOffset = `${(safePeriods - 1) * 3} MONTH`;
      seriesStep = 'INTERVAL 3 MONTH';
      momOffset = 'INTERVAL 3 MONTH';
      yoyTruncExpr = `DATE_TRUNC('quarter', pd)::DATE`;
      yoyOffset = 'INTERVAL 1 YEAR';
      break;
    default: // 'day'
      truncExpr = 'pd';
      windowOffset = `${safePeriods - 1} DAY`;
      seriesStep = 'INTERVAL 1 DAY';
      momOffset = 'INTERVAL 7 DAY';  // 日视图环比=上周同天
      yoyTruncExpr = 'pd';
      yoyOffset = 'INTERVAL 1 YEAR';
      break;
  }

  const sql = `
    WITH filtered AS (
      SELECT
        CAST(p.policy_date AS DATE) AS pd,
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        COALESCE(NULLIF(TRIM(CAST(p.salesman_name AS VARCHAR)), ''), '__unknown__') AS salesman_name,
        CASE WHEN p.premium > 0 THEN p.premium / 10000.0 ELSE 0 END AS premium_wan,
        COALESCE(ac.plan_vehicle, 0) AS plan_vehicle
      FROM PolicyFact p
      LEFT JOIN achievement_cache ac ON p.salesman_name = ac.full_name
      ${needsTeamJoin ? "LEFT JOIN SalesmanTeamMapping tm ON TRIM(CAST(p.salesman_name AS VARCHAR)) = TRIM(CAST(tm.full_name AS VARCHAR))" : ''}
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
        ${drillAnd}
    ),
    period_bounds AS (
      SELECT
        ${timePeriod === 'day' ? 'MAX(pd)' : `DATE_TRUNC('${timePeriod === 'quarter' ? 'quarter' : timePeriod}', MAX(pd))::DATE`} AS ref_date,
        ${timePeriod === 'day' ? 'MAX(pd)' : `DATE_TRUNC('${timePeriod === 'quarter' ? 'quarter' : timePeriod}', MAX(pd))::DATE`} - INTERVAL ${windowOffset} AS start_date
      FROM filtered
    ),
    window_rows AS (
      SELECT f.*, ${truncExpr} AS period_key
      FROM filtered f
      CROSS JOIN period_bounds pb
      WHERE f.pd >= pb.start_date AND f.pd <= pb.ref_date + ${timePeriod === 'day' ? "INTERVAL 0 DAY" : `INTERVAL ${timePeriod === 'quarter' ? '3 MONTH' : '1 ' + timePeriod} - INTERVAL 1 DAY`}
    ),
    period_salesman_total AS (
      SELECT salesman_name, SUM(premium_wan) AS salesman_premium_wan
      FROM window_rows
      GROUP BY salesman_name
    ),
    dim_period AS (
      SELECT
        wr.${dimConfig.alias},
        wr.period_key,
        ROUND(SUM(wr.premium_wan), 4) AS premium,
        ROUND(SUM(
          CASE
            WHEN COALESCE(pst.salesman_premium_wan, 0) > 0
              THEN wr.plan_vehicle * wr.premium_wan / pst.salesman_premium_wan
            ELSE 0
          END
        ), 4) AS plan_premium
      FROM window_rows wr
      LEFT JOIN period_salesman_total pst ON wr.salesman_name = pst.salesman_name
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
    prev_mom_data AS (
      SELECT ${yoyTruncExpr} AS period_key, ${dimConfig.alias}, ROUND(SUM(premium_wan), 4) AS premium
      FROM filtered
      GROUP BY ${yoyTruncExpr}, ${dimConfig.alias}
    ),
    prev_yoy_data AS (
      SELECT ${yoyTruncExpr} AS period_key, ${dimConfig.alias}, ROUND(SUM(premium_wan), 4) AS premium
      FROM filtered
      GROUP BY ${yoyTruncExpr}, ${dimConfig.alias}
    )
    SELECT
      bg.${dimConfig.alias} AS org_level_3,
      bg.period_key AS policy_date,
      COALESCE(cur.premium, 0) AS premium,
      cur.plan_premium,
      CASE
        WHEN COALESCE(cur.plan_premium, 0) <= 0 THEN NULL
        ELSE ROUND(COALESCE(cur.premium, 0) * 100.0 / (cur.plan_premium / ${planDenom}.0), 2)
      END AS achievement_rate,
      CASE
        WHEN COALESCE(prev_mom.premium, 0) = 0 THEN NULL
        ELSE ROUND((COALESCE(cur.premium, 0) - prev_mom.premium) * 100.0 / prev_mom.premium, 2)
      END AS mom_growth_rate,
      CASE
        WHEN COALESCE(prev_yoy.premium, 0) = 0 THEN NULL
        ELSE ROUND((COALESCE(cur.premium, 0) - prev_yoy.premium) * 100.0 / prev_yoy.premium, 2)
      END AS yoy_growth_rate
    FROM base_grid bg
    LEFT JOIN dim_period cur ON cur.${dimConfig.alias} = bg.${dimConfig.alias} AND cur.period_key = bg.period_key
    LEFT JOIN prev_mom_data prev_mom ON prev_mom.${dimConfig.alias} = bg.${dimConfig.alias} AND prev_mom.period_key = bg.period_key - ${momOffset}
    LEFT JOIN prev_yoy_data prev_yoy ON prev_yoy.${dimConfig.alias} = bg.${dimConfig.alias} AND prev_yoy.period_key = bg.period_key - ${yoyOffset}
    ORDER BY bg.${dimConfig.alias}, bg.period_key
  `;

  logger.debug('Generated performance org heatmap SQL', {
    segmentTag,
    timePeriod,
    periods: safePeriods,
    groupByDimension,
    drillFilterCount: drillFilter.length,
    sqlLength: sql.length,
  });

  return sql;
}
