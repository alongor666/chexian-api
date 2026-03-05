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

export const KPI_SQL = {
  total_premium: 'SUM(premium) as total_premium',
  policy_count: 'COUNT(DISTINCT policy_no) as policy_count',
  org_count: 'COUNT(DISTINCT org_level_3) as org_count',
  salesman_count: 'COUNT(DISTINCT salesman_name) as salesman_count',
  transfer_rate: 'COUNT(CASE WHEN is_transfer THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as transfer_rate',
  telesales_rate: 'COUNT(CASE WHEN is_telemarketing THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as telesales_rate',
  per_capita_premium: 'SUM(premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium',
  renewal_rate: 'COUNT(CASE WHEN is_renewal THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as renewal_rate',
  commercial_rate: "SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) * 1.0 / NULLIF(SUM(premium), 0) as commercial_rate",
  nev_rate: 'COUNT(CASE WHEN is_nev THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as nev_rate',
  new_car_rate: 'COUNT(CASE WHEN is_new_car THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as new_car_rate',
  quality_business_rate: `COUNT(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as quality_business_rate`,
  commercial_insurance_rate: 'COUNT(CASE WHEN insurance_type LIKE \'%商业%\' THEN 1 END) * 1.0 / NULLIF(COUNT(CASE WHEN insurance_type = \'交强险\' THEN 1 END), 0) as commercial_insurance_rate',
};

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
  baseWhereClause?: string
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
      SELECT MAX(CAST(policy_date AS DATE)) AS latest_policy_date
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
        ${KPI_SQL.total_premium},
        ${KPI_SQL.policy_count},
        ${KPI_SQL.org_count},
        ${KPI_SQL.salesman_count},
        ${KPI_SQL.transfer_rate},
        ${KPI_SQL.telesales_rate},
        ${KPI_SQL.per_capita_premium},
        ${KPI_SQL.renewal_rate},
        ${KPI_SQL.commercial_rate},
        ${KPI_SQL.nev_rate},
        ${KPI_SQL.new_car_rate},
        ${KPI_SQL.quality_business_rate},
        ${KPI_SQL.commercial_insurance_rate}
      FROM filtered
    ),
    vehicle_periods AS (
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.policy_date AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date)
                AND CAST(f.policy_date AS DATE) <= lc.latest_policy_date
              THEN f.premium
              ELSE 0
            END
          ),
          0
        ) AS vehicle_ytd_premium,
        COALESCE(
          SUM(
            CASE
              WHEN CAST(f.policy_date AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND CAST(f.policy_date AS DATE) <= lc.latest_policy_date - INTERVAL 1 YEAR
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
              WHEN CAST(f.policy_date AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date)
                AND CAST(f.policy_date AS DATE) <= lc.latest_policy_date
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
              WHEN CAST(f.policy_date AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND CAST(f.policy_date AS DATE) <= lc.latest_policy_date - INTERVAL 1 YEAR
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
              WHEN CAST(f.policy_date AS DATE) >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND CAST(f.policy_date AS DATE) < DATE_TRUNC('year', lc.latest_policy_date)
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
    variable_cost_base AS (
      SELECT
        f.premium,
        COALESCE(f.reported_claims, 0) AS reported_claims,
        COALESCE(f.fee_amount, 0) AS fee_amount,
        LEAST(
          GREATEST(
            DATEDIFF('day', CAST(f.insurance_start_date AS DATE), lc.latest_policy_date),
            0
          ),
          365
        ) AS exposure_days
      FROM filtered f
      CROSS JOIN latest_context lc
      WHERE f.insurance_start_date IS NOT NULL
    ),
    variable_cost AS (
      SELECT
        CASE
          WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0 AND SUM(premium) > 0
          THEN (
            SUM(reported_claims) / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) +
            SUM(fee_amount) / SUM(premium)
          )
          ELSE NULL
        END AS variable_cost_rate
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
      vc.variable_cost_rate AS variable_cost_rate,
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
      fm.commercial_insurance_rate
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

