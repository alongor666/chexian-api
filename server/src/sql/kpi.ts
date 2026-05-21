import { getMetricSql } from '../config/metric-registry/index.js';

/**
 * 优质业务定义条件SQL片段
 *
 * 优质业务包括：
 * 1. 非新能源车 AND (客户类别为非营业个人/企业/机关客车)
 * 2. 货车 AND 吨位分段为1吨以下或2-9吨
 */
export const QUALITY_BUSINESS_CONDITION = `
  (
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )
`;


interface KpiQueryOptions {
  orgNames?: string[];
  salesmanNames?: string[];
}

const esc = (value: string): string => value.replace(/'/g, "''");

const buildAchievementCacheWhere = (options: KpiQueryOptions = {}): string => {
  const conditions: string[] = [];
  if (options.orgNames && options.orgNames.length > 0) {
    const orgList = options.orgNames.map((item) => `'${esc(item)}'`).join(', ');
    conditions.push(`org_name IN (${orgList})`);
  }
  if (options.salesmanNames && options.salesmanNames.length > 0) {
    const salesmanList = options.salesmanNames.map((item) => `'${esc(item)}'`).join(', ');
    conditions.push(`full_name IN (${salesmanList})`);
  }
  if (conditions.length === 0) {
    return '';
  }
  return `WHERE ${conditions.join(' AND ')}`;
};

export const generateKpiQuery = (
  whereClause: string = '1=1',
  options: KpiQueryOptions = {},
  baseWhereClause?: string,
  dateField: string = 'policy_date'
) => {
  const achievementCacheWhere = buildAchievementCacheWhere(options);
  const finalBaseWhereClause = baseWhereClause ?? whereClause;

  return `
    WITH filtered AS (
      SELECT *
      FROM PolicyFact
      WHERE ${whereClause}
    ),
    filtered_base AS (
      SELECT *
      FROM PolicyFact
      WHERE ${finalBaseWhereClause}
    ),
    latest_policy AS (
      SELECT MAX(CAST(${dateField} AS DATE)) AS latest_policy_date
      FROM filtered
    ),
    latest_context AS (
      SELECT
        latest_policy_date,
        CAST(EXTRACT('year' FROM latest_policy_date) AS INTEGER) AS latest_year,
        GREATEST(
          CAST(EXTRACT('doy' FROM latest_policy_date) AS DOUBLE) / 365.0,
          1.0 / 365.0
        ) AS natural_day_progress
      FROM latest_policy
    ),
    focus_metrics AS (
      SELECT
        ${getMetricSql('total_premium')},
        ${getMetricSql('policy_count')},
        ${getMetricSql('org_count')},
        ${getMetricSql('salesman_count')},
        ${getMetricSql('transfer_rate')},
        ${getMetricSql('telesales_rate')},
        ${getMetricSql('per_capita_premium')},
        ${getMetricSql('renewal_rate')},
        ${getMetricSql('commercial_rate')},
        ${getMetricSql('nev_rate')},
        ${getMetricSql('new_car_rate')},
        ${getMetricSql('quality_business_rate')},
        ${getMetricSql('commercial_insurance_rate')},
        ${getMetricSql('per_vehicle_premium')}
      FROM filtered
    ),
    vehicle_periods AS (
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.${dateField} AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date)
                AND CAST(f.${dateField} AS DATE) <= lc.latest_policy_date
              THEN f.premium
              ELSE 0
            END
          ),
          0
        ) AS vehicle_ytd_premium,
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.${dateField} AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND CAST(f.${dateField} AS DATE) <= lc.latest_policy_date - INTERVAL 1 YEAR
              THEN f.premium
              ELSE 0
            END
          ),
          0
        ) AS vehicle_prev_ytd_premium
      FROM filtered_base f
      CROSS JOIN latest_context lc
    ),
    driver_periods AS (
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.${dateField} AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date)
                AND CAST(f.${dateField} AS DATE) <= lc.latest_policy_date
                AND f.customer_category != '摩托车'
              THEN COALESCE(f.cross_sell_premium_driver, 0)
              ELSE 0
            END
          ),
          0
        ) AS driver_ytd_premium,
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.${dateField} AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND CAST(f.${dateField} AS DATE) <= lc.latest_policy_date - INTERVAL 1 YEAR
                AND f.customer_category != '摩托车'
              THEN COALESCE(f.cross_sell_premium_driver, 0)
              ELSE 0
            END
          ),
          0
        ) AS driver_prev_ytd_premium,
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.${dateField} AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND CAST(f.${dateField} AS DATE) < DATE_TRUNC('year', lc.latest_policy_date)
                AND f.customer_category != '摩托车'
              THEN COALESCE(f.cross_sell_premium_driver, 0)
              ELSE 0
            END
          ),
          0
        ) AS driver_prev_full_premium
      FROM filtered_base f
      CROSS JOIN latest_context lc
    ),
    bundle_renewal AS (
      SELECT
        CASE
          -- 分母：上一年起保的套单（应续件数），与续保分析板块口径一致
          WHEN COUNT(CASE WHEN is_commercial_insure = '套单' 
                           AND YEAR(CAST(insurance_start_date AS DATE)) = lc.latest_year - 1 
                      THEN 1 END) > 0
          THEN 
            -- 分子：上一年起保的套单中，有续保单号的数量（已续件数）
            COUNT(CASE WHEN is_commercial_insure = '套单' 
                            AND YEAR(CAST(insurance_start_date AS DATE)) = lc.latest_year - 1 
                            AND renewal_policy_no IS NOT NULL AND renewal_policy_no <> '' 
                       THEN 1 END) * 1.0
            / COUNT(CASE WHEN is_commercial_insure = '套单' 
                              AND YEAR(CAST(insurance_start_date AS DATE)) = lc.latest_year - 1 
                         THEN 1 END)
          ELSE NULL
        END AS bundle_renewal_rate
      FROM filtered
      CROSS JOIN latest_context lc
    ),
    -- B252：filtered_dedup 按 (policy_no, insurance_start_date) 聚合去重，
    -- 防止 variable_cost_base JOIN ClaimsAgg 后因 PolicyFact 原单+批改多行导致赔款虚增
    filtered_dedup AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS insurance_start_date,
        SUM(premium) AS premium,
        SUM(COALESCE(fee_amount, 0)) AS fee_amount
      FROM filtered
      WHERE insurance_start_date IS NOT NULL
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    ),
    variable_cost_base AS (
      SELECT
        f.premium,
        COALESCE(ca.reported_claims, 0) AS reported_claims,
        f.fee_amount,
        DATEDIFF(
          'day',
          f.insurance_start_date,
          f.insurance_start_date + INTERVAL 1 YEAR
        ) AS policy_term,
        -- earned_days +1：含起保当天（与 cost-ratios.ts / sql-builder.ts 口径统一）
        LEAST(
          GREATEST(
            DATEDIFF('day', f.insurance_start_date, lc.latest_policy_date) + 1,
            0
          ),
          DATEDIFF(
            'day',
            f.insurance_start_date,
            f.insurance_start_date + INTERVAL 1 YEAR
          )
        ) AS earned_days
      FROM filtered_dedup f
      CROSS JOIN latest_context lc
      LEFT JOIN ClaimsAgg ca ON f.policy_no = ca.policy_no
    ),
    variable_cost AS (
      SELECT
        CASE
          WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
            AND SUM(premium) > 0
          THEN ROUND(
            (
              SUM(reported_claims) * 100.0
              / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
              + SUM(fee_amount) * 100.0 / SUM(premium)
            ),
            2
          )
          ELSE NULL
        END AS variable_cost_ratio
      FROM variable_cost_base
    ),
    vehicle_plan AS (
      SELECT
        COALESCE(SUM(plan_vehicle), 0) AS vehicle_plan_wan
      FROM achievement_cache
      ${achievementCacheWhere}
    ),
    driver_plan AS (
      SELECT
        COALESCE(SUM(plan_premium), 0) AS driver_plan_wan
      FROM KpiPlanConfig
      WHERE business_line = 'driver'
        AND level = 'company'
        AND level_key = 'ALL'
        AND plan_year = COALESCE((SELECT latest_year FROM latest_context LIMIT 1), 0)
    )
    SELECT
      lc.latest_policy_date AS latest_policy_date,
      vpl.vehicle_plan_wan AS vehicle_plan_wan,
      vp.vehicle_ytd_premium AS vehicle_premium,
      CASE
        WHEN vpl.vehicle_plan_wan > 0 AND lc.natural_day_progress > 0
        THEN (vp.vehicle_ytd_premium / 10000.0) / (vpl.vehicle_plan_wan * lc.natural_day_progress)
        ELSE NULL
      END AS vehicle_achievement_rate,
      CASE
        WHEN vp.vehicle_prev_ytd_premium > 0
        THEN (vp.vehicle_ytd_premium - vp.vehicle_prev_ytd_premium) / vp.vehicle_prev_ytd_premium
        ELSE NULL
      END AS vehicle_growth_rate,
      vc.variable_cost_ratio AS variable_cost_ratio,
      br.bundle_renewal_rate AS bundle_renewal_rate,
      dp.driver_ytd_premium AS driver_premium,
      CASE
        WHEN lc.natural_day_progress > 0
          AND COALESCE(NULLIF(dpl.driver_plan_wan, 0), dp.driver_prev_full_premium / 10000.0) > 0
        THEN (dp.driver_ytd_premium / 10000.0)
          / (COALESCE(NULLIF(dpl.driver_plan_wan, 0), dp.driver_prev_full_premium / 10000.0) * lc.natural_day_progress)
        ELSE NULL
      END AS driver_achievement_rate,
      CASE
        WHEN dp.driver_prev_ytd_premium > 0
        THEN (dp.driver_ytd_premium - dp.driver_prev_ytd_premium) / dp.driver_prev_ytd_premium
        ELSE NULL
      END AS driver_growth_rate,
      fm.total_premium,
      fm.policy_count,
      fm.org_count,
      fm.salesman_count,
      fm.transfer_rate,
      fm.telesales_rate,
      fm.per_capita_premium,
      fm.renewal_rate,
      fm.commercial_rate,
      fm.nev_rate,
      fm.new_car_rate,
      fm.quality_business_rate,
      fm.commercial_insurance_rate,
      fm.per_vehicle_premium
    FROM latest_context lc
    CROSS JOIN focus_metrics fm
    CROSS JOIN vehicle_periods vp
    CROSS JOIN driver_periods dp
    CROSS JOIN vehicle_plan vpl
    CROSS JOIN driver_plan dpl
    CROSS JOIN bundle_renewal br
    CROSS JOIN variable_cost vc
  `;
};

/**
 * 允许作为分组维度的字段白名单
 */
export const ALLOWED_DIMENSIONS = new Set([
  'org_level_1', 'org_level_2', 'org_level_3',
  'salesman_name', 'customer_category', 'coverage_combination',
  'insurance_type', 'tonnage_segment', 'is_nev', 'is_new_car',
  'is_renewal', 'is_transfer', 'is_telemarketing',
  'vehicle_type', 'plate_type', 'insurance_grade',
]);

/**
 * 校验维度名是否在白名单中
 * @throws AppError 如果维度名不合法
 */
export function validateDimension(dimension: string): string {
  const trimmed = dimension.trim();
  if (!ALLOWED_DIMENSIONS.has(trimmed)) {
    throw new Error(`Invalid dimension: ${trimmed}. Allowed: ${[...ALLOWED_DIMENSIONS].join(', ')}`);
  }
  return trimmed;
}

export const generateTopNQuery = (
  dimension: string,
  metric: string = 'SUM(premium)',
  limit: number = 20,
  whereClause: string = '1=1'
) => {
  const safeDimension = validateDimension(dimension);
  return `
    SELECT
      ${safeDimension} as dim_key,
      ${metric} as value
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY ${safeDimension}
    ORDER BY value DESC
    LIMIT ${limit}
  `;
};

// For the virtual table - Aggregated by Salesman as required (No single policy detail)
// Prompt says: "Max drill depth: Salesman x Dimension Aggregation"
// Prompt also says: "Strictly forbid single policy detail query"
// So the table should probably show Salesman List?
// "Virtual table... Default Page/TopN"
// Let's assume the table shows Salesman Performance.

export const generateSalesmanTableQuery = (
  limit: number = 100,
  offset: number = 0,
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      salesman_name,
      org_level_3,
      SUM(premium) as signed_premium,
      COUNT(*) as policy_count
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY salesman_name, org_level_3
    ORDER BY signed_premium DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
};

export const generateDimensionShareQuery = (
  dimensionExpression: string,
  metric: string = 'SUM(premium)',
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      COALESCE(${dimensionExpression}, '未知') as dim_key,
      ${metric} as value
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY COALESCE(${dimensionExpression}, '未知')
    ORDER BY value DESC
  `;
};

