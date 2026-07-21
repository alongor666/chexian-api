import { getMetricSql } from '../config/metric-registry/index.js';
import { escapeSqlValue } from '../utils/security.js';
// B301: 优质业务定义收归单一事实源，re-export 以兼容既有 import { QUALITY_BUSINESS_CONDITION } from './kpi.js'
import { QUALITY_BUSINESS_CONDITION } from './shared/business-conditions.js';

export { QUALITY_BUSINESS_CONDITION };


interface KpiQueryOptions {
  orgNames?: string[];
  salesmanNames?: string[];
  /** @deprecated use achievementCacheBranchCode / organizationPlanBranchCode to avoid cross-table gate coupling. */
  branchCode?: string;
  /** achievement_cache 分省 RLS 码；路由必须按 achievement_cache 自身列门控解析。 */
  achievementCacheBranchCode?: string | null;
  /** PlanFact 分省 RLS 码；路由必须按 PlanFact 自身列门控解析。 */
  organizationPlanBranchCode?: string | null;
  /** 请求业务省份；与 PlanFact 关系是否可安全读取分离，用于 SX 缺门控时保持 null 语义。 */
  requestBranchCode?: string | null;
}

const esc = escapeSqlValue;

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
  const branchCode = options.achievementCacheBranchCode !== undefined
    ? options.achievementCacheBranchCode
    : options.branchCode;
  // 分省 RLS（GATED 多省）：achievement_cache 多省时携 branch_code（flag off / 单省无列 → undefined → 不注入）
  if (branchCode) {
    conditions.push(`branch_code = '${esc(branchCode)}'`);
  }
  if (conditions.length === 0) {
    return '';
  }
  return `WHERE ${conditions.join(' AND ')}`;
};

const buildOrganizationPlanWhere = (options: KpiQueryOptions = {}): string => {
  const conditions = [
    `plan_year = COALESCE((SELECT latest_year FROM latest_context LIMIT 1), 0)`,
    `level = 'organization'`,
  ];
  if (options.orgNames && options.orgNames.length > 0) {
    const orgList = options.orgNames.map((item) => `'${esc(item)}'`).join(', ');
    conditions.push(`organization IN (${orgList})`);
  }
  const branchCode = options.organizationPlanBranchCode !== undefined
    ? options.organizationPlanBranchCode
    : options.branchCode;
  if (branchCode) {
    conditions.push(`branch_code = '${esc(branchCode)}'`);
  }
  return `WHERE ${conditions.join(' AND ')}`;
};

/**
 * 单行 KPI SQL 生成器。
 * @param excludeVariableCost  立方体路由专用开关：跳过 variable_cost CTE 与 SELECT
 *   的 cost 五列（variable_cost_ratio / earned_claim_ratio / expense_ratio /
 *   earned_premium / maturity_rate），
 *   由 handler 并行的成本立方体单行 SQL 提供后 merge。默认 false 行为完全不变。
 *   见 sql/cube/kpi-cost-cube.ts 与 routes/query/kpi.ts 的 tryKpiCostCube。
 */
export const generateKpiQuery = (
  whereClause: string = '1=1',
  options: KpiQueryOptions = {},
  baseWhereClause?: string,
  dateField: string = 'policy_date',
  excludeVariableCost: boolean = false
) => {
  const achievementCacheWhere = buildAchievementCacheWhere(options);
  const organizationPlanWhere = buildOrganizationPlanWhere(options);
  const organizationPlanBranchCode = options.organizationPlanBranchCode !== undefined
    ? options.organizationPlanBranchCode
    : options.branchCode;
  const isSxRequest = options.requestBranchCode === 'SX' || organizationPlanBranchCode === 'SX';
  const canUseOrganizationPlan =
    isSxRequest && organizationPlanBranchCode === 'SX' &&
    (!options.salesmanNames || options.salesmanNames.length === 0);
  const hasExplicitOrganizationScope = Boolean(options.orgNames && options.orgNames.length > 0);
  const finalBaseWhereClause = baseWhereClause ?? whereClause;
  // 立方体路由模式下，cost 五项由 generateKpiCostCubeQuery 单行提供。
  // 主 SQL 完全跳过 variable_cost_base CTE（260 万行去重 + JOIN ClaimsAgg 的 P95 大头）
  // 与 SELECT 的 vc.* 五列、CROSS JOIN vc —— 这才是 KPI 接立方体的真实加速来源。
  const variableCostCte = excludeVariableCost ? '' : `,
    -- B252：filtered_dedup 按 (policy_no, insurance_start_date) 聚合去重，
    -- 防止 variable_cost_base JOIN ClaimsAgg 后因 PolicyFact 原单+批改多行导致赔款虚增
    filtered_dedup AS (
      SELECT
        policy_no,
        insurance_start_date,
        SUM(premium) AS premium,
        SUM(COALESCE(fee_amount, 0)) AS fee_amount
      FROM filtered
      WHERE insurance_start_date IS NOT NULL
      GROUP BY policy_no, insurance_start_date
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
        -- B305：变动成本率公式收归指标注册表（唯一事实源），消除此处硬编码 CASE WHEN。
        -- variable_cost_base CTE 已暴露注册表 requiredColumns（premium/reported_claims/
        -- fee_amount/earned_days/policy_term），registry expression 可直接内联。
        ${getMetricSql('variable_cost_ratio')},
        -- B(40f3ff)：同源拆出满期赔付率 + 费用率分项（变动成本率 = 二者之和，口径见
        -- 注册表 variable_cost_ratio.formula）。供 dashboard 变动成本率卡片真实分段，
        -- 替代前端 kpiCardProps.ts 的 ×0.69 假估算。
        ${getMetricSql('earned_claim_ratio')},
        ${getMetricSql('expense_ratio')},
        ${getMetricSql('earned_premium')},
        ${getMetricSql('maturity_rate')}
      FROM variable_cost_base
    )`;
  const variableCostSelect = excludeVariableCost ? '' : `
      vc.variable_cost_ratio AS variable_cost_ratio,
      vc.earned_claim_ratio AS earned_claim_ratio,
      vc.expense_ratio AS expense_ratio,
      vc.earned_premium AS earned_premium,
      vc.maturity_rate AS maturity_rate,`;
  const variableCostJoin = excludeVariableCost ? '' : `
    CROSS JOIN variable_cost vc`;
  const vehiclePlanCte = canUseOrganizationPlan
    ? hasExplicitOrganizationScope
      ? `
    organization_plan AS (
      -- 山西仅在显式机构范围内读取 PlanFact。每个选中机构均须有非空计划，否则整组未配置。
      SELECT CASE
        WHEN COUNT(*) = ${options.orgNames!.length}
          AND COUNT(plan_vehicle) = ${options.orgNames!.length}
        THEN SUM(plan_vehicle)
        ELSE NULL
      END AS vehicle_plan_wan
      FROM PlanFact
      ${organizationPlanWhere}
    ),
    vehicle_plan AS (
      SELECT op.vehicle_plan_wan
      FROM organization_plan op
    )`
      : `
    vehicle_plan AS (
      -- SX 暂无覆盖经代/车商/重客/其他的权威分公司总计划，整体计划必须为空。
      SELECT NULL::DOUBLE AS vehicle_plan_wan
    )`
    : isSxRequest
      ? `
    vehicle_plan AS (
      -- SX 团队/业务员层无计划源，禁止回退 achievement_cache。
      SELECT NULL::DOUBLE AS vehicle_plan_wan
    )`
    : `
    vehicle_plan AS (
      -- 四川继续使用现有业务员计划汇总口径。
      SELECT COALESCE(SUM(plan_vehicle), 0) AS vehicle_plan_wan
      FROM achievement_cache
      ${achievementCacheWhere}
    )`;

  return `
    WITH filtered AS (
      SELECT
        CAST(${dateField} AS DATE) AS kpi_date,
        policy_no,
        vehicle_frame_no,
        org_level_3,
        salesman_name,
        premium,
        fee_amount,
        is_transfer,
        is_telemarketing,
        is_renewal,
        insurance_type,
        is_nev,
        is_new_car,
        customer_category,
        tonnage_segment,
        is_commercial_insure,
        CAST(insurance_start_date AS DATE) AS insurance_start_date,
        renewal_policy_no,
        -- 2026-06-12 件数口径修复后 transfer_rate/renewal_rate 注册表 v2.0.0
        -- 表达式引用 endorsement_no（"剔除批改 + policy_key 去重"）；本 CTE 漏 SELECT
        -- 会让 focus_metrics binder 失败，补齐与下游表达式 requiredColumns 对齐
        endorsement_no
      FROM PolicyFact
      WHERE ${whereClause}
    ),
    filtered_base AS (
      SELECT
        CAST(${dateField} AS DATE) AS kpi_date,
        premium,
        customer_category,
        cross_sell_premium_driver
      FROM PolicyFact
      WHERE ${finalBaseWhereClause}
    ),
    latest_policy AS (
      SELECT MAX(kpi_date) AS latest_policy_date
      FROM filtered
    ),
    -- 时间进度（标准口径，注册表 plan_completion_pct v2.0.0）：
    -- 锚点 = 数据内最新签单日（筛选范围内），全年天数闰年感知（禁止硬编码 365）
    latest_context AS (
      SELECT
        latest_policy_date,
        latest_year,
        GREATEST(
          CAST(EXTRACT('doy' FROM latest_policy_date) AS DOUBLE) / year_days,
          1.0 / year_days
        ) AS natural_day_progress
      FROM (
        SELECT
          latest_policy_date,
          CAST(EXTRACT('year' FROM latest_policy_date) AS INTEGER) AS latest_year,
          CAST(DATEDIFF(
            'day',
            DATE_TRUNC('year', latest_policy_date),
            DATE_TRUNC('year', latest_policy_date) + INTERVAL 1 YEAR
          ) AS DOUBLE) AS year_days
        FROM latest_policy
      )
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
        ${getMetricSql('per_vehicle_premium')},
        CASE
          -- 分母：上一年起保的套单（应续件数），与续保分析板块口径一致
          WHEN COUNT(CASE
            WHEN is_commercial_insure = '套单'
              AND insurance_start_date >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
              AND insurance_start_date < DATE_TRUNC('year', lc.latest_policy_date)
            THEN 1
          END) > 0
          THEN
            -- 分子：上一年起保的套单中，有续保单号的数量（已续件数）
            COUNT(CASE
              WHEN is_commercial_insure = '套单'
                AND insurance_start_date >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND insurance_start_date < DATE_TRUNC('year', lc.latest_policy_date)
                AND renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
              THEN 1
            END) * 1.0
            / COUNT(CASE
              WHEN is_commercial_insure = '套单'
                AND insurance_start_date >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND insurance_start_date < DATE_TRUNC('year', lc.latest_policy_date)
              THEN 1
            END)
          ELSE NULL
        END AS bundle_renewal_rate
      FROM filtered
      CROSS JOIN latest_context lc
    ),
    base_periods AS (
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN f.kpi_date >= DATE_TRUNC('year', lc.latest_policy_date)
                AND f.kpi_date <= lc.latest_policy_date
              THEN f.premium
              ELSE 0
            END
          ),
          0
        ) AS vehicle_ytd_premium,
        COALESCE(
          SUM(
            CASE
              WHEN f.kpi_date >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND f.kpi_date <= lc.latest_policy_date - INTERVAL 1 YEAR
              THEN f.premium
              ELSE 0
            END
          ),
          0
        ) AS vehicle_prev_ytd_premium,
        COALESCE(
          SUM(
            CASE
              WHEN f.kpi_date >= DATE_TRUNC('year', lc.latest_policy_date)
                AND f.kpi_date <= lc.latest_policy_date
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
              WHEN f.kpi_date >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND f.kpi_date <= lc.latest_policy_date - INTERVAL 1 YEAR
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
              WHEN f.kpi_date >= DATE_TRUNC('year', lc.latest_policy_date - INTERVAL 1 YEAR)
                AND f.kpi_date < DATE_TRUNC('year', lc.latest_policy_date)
                AND f.customer_category != '摩托车'
              THEN COALESCE(f.cross_sell_premium_driver, 0)
              ELSE 0
            END
          ),
          0
        ) AS driver_prev_full_premium
      FROM filtered_base f
      CROSS JOIN latest_context lc
    )${variableCostCte},${vehiclePlanCte},
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
      bp.vehicle_ytd_premium AS vehicle_premium,
      CASE
        WHEN vpl.vehicle_plan_wan > 0 AND lc.natural_day_progress > 0
        THEN (bp.vehicle_ytd_premium / 10000.0) / (vpl.vehicle_plan_wan * lc.natural_day_progress)
        ELSE NULL
      END AS vehicle_achievement_rate,
      CASE
        WHEN bp.vehicle_prev_ytd_premium > 0
        THEN (bp.vehicle_ytd_premium - bp.vehicle_prev_ytd_premium) / bp.vehicle_prev_ytd_premium
        ELSE NULL
      END AS vehicle_growth_rate,
${variableCostSelect}
      fm.bundle_renewal_rate AS bundle_renewal_rate,
      bp.driver_ytd_premium AS driver_premium,
      CASE
        WHEN lc.natural_day_progress > 0
          AND COALESCE(NULLIF(dpl.driver_plan_wan, 0), bp.driver_prev_full_premium / 10000.0) > 0
        THEN (bp.driver_ytd_premium / 10000.0)
          / (COALESCE(NULLIF(dpl.driver_plan_wan, 0), bp.driver_prev_full_premium / 10000.0) * lc.natural_day_progress)
        ELSE NULL
      END AS driver_achievement_rate,
      CASE
        WHEN bp.driver_prev_ytd_premium > 0
        THEN (bp.driver_ytd_premium - bp.driver_prev_ytd_premium) / bp.driver_prev_ytd_premium
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
    CROSS JOIN base_periods bp
    CROSS JOIN vehicle_plan vpl
    CROSS JOIN driver_plan dpl${variableCostJoin}
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
