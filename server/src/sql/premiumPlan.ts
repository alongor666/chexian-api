/**
 * 保费达成下钻分析 SQL 生成器
 *
 * 功能：
 * - 六级下钻：分公司整体 → 三级机构 → 团队 → 业务员 → 客户类别 → 险别组合
 * - 支持年度筛选（2025/2026）
 * - 自动处理"无归属团队"逻辑
 * - 车险实际保费从PolicyFact统计（当年1月1日起签单）
 * - 达成率按1/365折算时间进度
 *
 * 核心计算逻辑（自下而上）：
 * 1. 以业务员为基础单位，统计每个业务员的计划和实际保费
 * 2. 通过SalesmanPlanFact获取业务员的团队和机构归属
 * 3. 向上汇总到团队级别、机构级别、分公司级别
 * 4. 业务员之后按客户类别、险别组合继续下钻（直接从PolicyFact）
 *
 * 数据源：
 * - SalesmanPlanFact 视图（计划数据 + 归属关系）
 * - PolicyFact 视图（实际保费数据）
 *
 * 字段对应说明：
 * - SalesmanPlanFact.org_name ↔ 机构名称（如"天府"）
 * - SalesmanPlanFact.team_name ↔ 团队名称
 * - SalesmanPlanFact.salesman_name ↔ 业务员姓名
 * - PolicyFact.salesman_name ↔ 业务员姓名（JOIN关键字段）
 * - PolicyFact.org_level_3 ↔ 可能与org_name不完全一致，以SalesmanPlanFact为准
 * - PolicyFact.customer_category ↔ 客户类别
 * - PolicyFact.coverage_combination ↔ 险别组合
 */

/**
 * 下钻层级类型
 * company: 分公司整体
 * org: 三级机构
 * team: 团队
 * salesman: 业务员
 * customer_category: 客户类别
 * coverage: 险别组合
 */
export type PlanDrilldownLevel = 'company' | 'org' | 'team' | 'salesman' | 'customer_category' | 'coverage';

/**
 * 下钻维度配置
 */
export interface PlanDrilldownDimension {
  /** 当前层级 */
  level: PlanDrilldownLevel;
  /** 父级值（用于过滤） */
  parentValue?: string;
  /** 完整的过滤路径（用于多级下钻） */
  filters?: {
    org?: string;
    team?: string;
    salesman?: string;
    customerCategory?: string;
  };
}

/**
 * 排名配置
 */
export interface PlanRankingConfig {
  enabled: boolean;
  rankField?: 'plan_vehicle' | 'actual_vehicle' | 'rate_vehicle';
  topN?: number;
  bottomN?: number;
}

/**
 * 排序字段
 */
export type PlanSortField = 'plan_vehicle' | 'actual_vehicle' | 'rate_vehicle' | 'plan_total' | 'prev_year_premium' | 'yoy_growth_rate' | 'year_2025_actual' | 'plan_growth_rate';

/**
 * 排序方向
 */
export type SortOrder = 'asc' | 'desc';

/**
 * SQL字符串转义（防止SQL注入）
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * 生成时间进度子查询
 * 时间进度 = (最新签单日期 - 1月1日) / 365
 * 最小值为 1/365（至少1天）
 *
 * 注意：使用PolicyFact中的最新签单日期，而不是当前日期
 */
function getTimeProgressSubquery(planYear: number): string {
  return `(
    SELECT GREATEST(
      CAST(DATEDIFF('day', '${planYear}-01-01', MAX(policy_date)) AS DOUBLE) / 365.0,
      1.0 / 365.0
    )
    FROM PolicyFact
    WHERE policy_date >= '${planYear}-01-01'
  )`;
}

/**
 * 生成业务员级别基础数据CTE
 * 这是所有查询的基础：以业务员为单位，JOIN计划数据和实际保费数据
 *
 * 新增字段说明：
 * - prev_year_premium: 上年同期保费（去年1月1日至今对应期间的保费）
 * - yoy_growth_rate: 同比增长率 = (今年实际 - 去年同期) / 去年同期
 * - year_2025_actual: 2025年度保费实际（2025全年数据）
 * - plan_growth_rate: 计划增长率 = 2026计划 / 2025实际 - 1
 *
 * @param planYear - 计划年度
 * @returns SQL CTE片段
 */
function generateSalesmanBaseCTE(planYear: number): string {
  const timeProgressSubquery = getTimeProgressSubquery(planYear);
  const prevYear = planYear - 1;

  return `
    -- 时间进度计算（使用最新签单日期）
    time_progress AS (
      SELECT ${timeProgressSubquery} as progress
    ),

    -- 计算今年最大签单日期（用于上年同期计算）
    max_policy_date AS (
      SELECT MAX(policy_date) as max_date
      FROM PolicyFact
      WHERE policy_date >= '${planYear}-01-01'
    ),

    -- 从PolicyFact按业务员统计实际保费（当年1月1日起签单）
    actual_by_salesman AS (
      SELECT
        salesman_name,
        SUM(premium) / 10000 as actual_vehicle  -- 转换为万元
      FROM PolicyFact
      WHERE policy_date >= '${planYear}-01-01'
      GROUP BY salesman_name
    ),

    -- 上年同期保费（去年1月1日到去年同期日期）
    -- 使用今年最大日期减1年作为上年同期截止日期
    prev_year_actual AS (
      SELECT
        salesman_name,
        SUM(premium) / 10000 as prev_year_premium
      FROM PolicyFact
      WHERE policy_date >= '${prevYear}-01-01'
        AND policy_date <= (SELECT max_date - INTERVAL 1 YEAR FROM max_policy_date)
      GROUP BY salesman_name
    ),

    -- 2025年度全年保费实际（用于计划增长率计算）
    year_2025_actual AS (
      SELECT
        salesman_name,
        SUM(premium) / 10000 as year_2025_premium
      FROM PolicyFact
      WHERE policy_date >= '2025-01-01'
        AND policy_date <= '2025-12-31'
      GROUP BY salesman_name
    ),

    -- 2026年计划数据
    plan_2026 AS (
      SELECT
        salesman_name,
        COALESCE(plan_vehicle, 0) as plan_2026_vehicle
      FROM SalesmanPlanFact
      WHERE plan_year = 2026
    ),

    -- 业务员级别完整数据：JOIN计划数据和实际数据
    -- 以SalesmanPlanFact为基准（定义了归属关系）
    salesman_base AS (
      SELECT
        p.salesman_name,
        p.team_name,
        p.org_name,
        p.plan_year,
        COALESCE(p.plan_vehicle, 0) as plan_vehicle,
        COALESCE(p.plan_total, 0) as plan_total,
        COALESCE(a.actual_vehicle, 0) as actual_vehicle,
        0 as actual_total,
        CASE
          WHEN COALESCE(p.plan_vehicle, 0) > 0
          THEN COALESCE(a.actual_vehicle, 0) / (p.plan_vehicle * (SELECT progress FROM time_progress))
          ELSE NULL
        END as rate_vehicle,
        -- 新增字段
        COALESCE(pya.prev_year_premium, 0) as prev_year_premium,
        CASE
          WHEN COALESCE(pya.prev_year_premium, 0) > 0
          THEN (COALESCE(a.actual_vehicle, 0) - COALESCE(pya.prev_year_premium, 0)) / pya.prev_year_premium
          ELSE NULL
        END as yoy_growth_rate,
        COALESCE(y25.year_2025_premium, 0) as year_2025_actual,
        CASE
          WHEN COALESCE(y25.year_2025_premium, 0) > 0
          THEN COALESCE(p26.plan_2026_vehicle, 0) / y25.year_2025_premium - 1
          ELSE NULL
        END as plan_growth_rate
      FROM SalesmanPlanFact p
      LEFT JOIN actual_by_salesman a ON p.salesman_name = a.salesman_name
      LEFT JOIN prev_year_actual pya ON p.salesman_name = pya.salesman_name
      LEFT JOIN year_2025_actual y25 ON p.salesman_name = y25.salesman_name
      LEFT JOIN plan_2026 p26 ON p.salesman_name = p26.salesman_name
      WHERE p.plan_year = ${planYear}
    )
  `;
}

/**
 * 生成保费达成下钻查询
 *
 * 核心逻辑（六级下钻）：
 * 1. company: 分公司整体汇总
 * 2. org: 按三级机构分组
 * 3. team: 按团队分组
 * 4. salesman: 按业务员分组
 * 5. customer_category: 按客户类别分组（直接从PolicyFact）
 * 6. coverage: 按险别组合分组（直接从PolicyFact）
 *
 * @param planYear - 计划年度（2025/2026）
 * @param dimension - 下钻维度配置
 * @param ranking - 排名配置
 * @param sortField - 排序字段
 * @param sortOrder - 排序方向
 * @returns SQL查询语句
 */
export function generatePremiumPlanDrilldownQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  ranking: PlanRankingConfig = { enabled: false },
  sortField: PlanSortField = 'plan_vehicle',
  sortOrder: SortOrder = 'desc'
): string {
  const filters = dimension.filters || {};

  // 客户类别和险别组合层级使用PolicyFact直接查询
  if (dimension.level === 'customer_category' || dimension.level === 'coverage') {
    return generatePolicyFactDrilldownQuery(planYear, dimension, sortField, sortOrder);
  }

  const baseCTE = generateSalesmanBaseCTE(planYear);

  // 根据下钻层级构建不同的汇总查询
  let aggregationCTE: string;
  let filterCondition = '';

  if (dimension.level === 'company') {
    // 分公司整体：汇总所有数据，显示为单行
    aggregationCTE = `
    aggregated_data AS (
      SELECT
        '分公司整体' as group_name,
        ${planYear} as plan_year,
        SUM(plan_vehicle) as plan_vehicle,
        SUM(plan_total) as plan_total,
        SUM(actual_vehicle) as actual_vehicle,
        SUM(actual_total) as actual_total,
        CASE
          WHEN SUM(plan_vehicle) > 0
          THEN SUM(actual_vehicle) / (SUM(plan_vehicle) * (SELECT progress FROM time_progress))
          ELSE NULL
        END as rate_vehicle,
        NULL as rate_total,
        COUNT(DISTINCT salesman_name) as salesman_count,
        SUM(prev_year_premium) as prev_year_premium,
        CASE
          WHEN SUM(prev_year_premium) > 0
          THEN (SUM(actual_vehicle) - SUM(prev_year_premium)) / SUM(prev_year_premium)
          ELSE NULL
        END as yoy_growth_rate,
        SUM(year_2025_actual) as year_2025_actual,
        CASE
          WHEN SUM(year_2025_actual) > 0
          THEN SUM(plan_vehicle) / SUM(year_2025_actual) - 1
          ELSE NULL
        END as plan_growth_rate
      FROM salesman_base
    )`;
  } else if (dimension.level === 'org') {
    // 三级机构层级：按org_name汇总所有业务员数据
    aggregationCTE = `
    aggregated_data AS (
      SELECT
        org_name as group_name,
        ${planYear} as plan_year,
        SUM(plan_vehicle) as plan_vehicle,
        SUM(plan_total) as plan_total,
        SUM(actual_vehicle) as actual_vehicle,
        SUM(actual_total) as actual_total,
        CASE
          WHEN SUM(plan_vehicle) > 0
          THEN SUM(actual_vehicle) / (SUM(plan_vehicle) * (SELECT progress FROM time_progress))
          ELSE NULL
        END as rate_vehicle,
        NULL as rate_total,
        COUNT(DISTINCT salesman_name) as salesman_count,
        SUM(prev_year_premium) as prev_year_premium,
        CASE
          WHEN SUM(prev_year_premium) > 0
          THEN (SUM(actual_vehicle) - SUM(prev_year_premium)) / SUM(prev_year_premium)
          ELSE NULL
        END as yoy_growth_rate,
        SUM(year_2025_actual) as year_2025_actual,
        CASE
          WHEN SUM(year_2025_actual) > 0
          THEN SUM(plan_vehicle) / SUM(year_2025_actual) - 1
          ELSE NULL
        END as plan_growth_rate
      FROM salesman_base
      GROUP BY org_name
    )`;
  } else if (dimension.level === 'team') {
    // 团队层级：按team_name汇总，过滤指定机构
    if (filters.org) {
      const escapedValue = escapeSqlString(filters.org);
      filterCondition = `WHERE org_name = '${escapedValue}'`;
    }
    aggregationCTE = `
    aggregated_data AS (
      SELECT
        team_name as group_name,
        org_name as parent_name,
        ${planYear} as plan_year,
        SUM(plan_vehicle) as plan_vehicle,
        SUM(plan_total) as plan_total,
        SUM(actual_vehicle) as actual_vehicle,
        SUM(actual_total) as actual_total,
        CASE
          WHEN SUM(plan_vehicle) > 0
          THEN SUM(actual_vehicle) / (SUM(plan_vehicle) * (SELECT progress FROM time_progress))
          ELSE NULL
        END as rate_vehicle,
        NULL as rate_total,
        COUNT(DISTINCT salesman_name) as salesman_count,
        SUM(prev_year_premium) as prev_year_premium,
        CASE
          WHEN SUM(prev_year_premium) > 0
          THEN (SUM(actual_vehicle) - SUM(prev_year_premium)) / SUM(prev_year_premium)
          ELSE NULL
        END as yoy_growth_rate,
        SUM(year_2025_actual) as year_2025_actual,
        CASE
          WHEN SUM(year_2025_actual) > 0
          THEN SUM(plan_vehicle) / SUM(year_2025_actual) - 1
          ELSE NULL
        END as plan_growth_rate
      FROM salesman_base
      ${filterCondition}
      GROUP BY team_name, org_name
    )`;
  } else {
    // 业务员层级：直接使用业务员数据，过滤指定团队
    if (filters.team) {
      const escapedValue = escapeSqlString(filters.team);
      filterCondition = `WHERE team_name = '${escapedValue}'`;
    }
    aggregationCTE = `
    aggregated_data AS (
      SELECT
        salesman_name as group_name,
        team_name as parent_name,
        org_name,
        plan_year,
        plan_vehicle,
        plan_total,
        actual_vehicle,
        actual_total,
        rate_vehicle,
        NULL as rate_total,
        1 as salesman_count,
        prev_year_premium,
        yoy_growth_rate,
        year_2025_actual,
        plan_growth_rate
      FROM salesman_base
      ${filterCondition}
    )`;
  }

  // 构建完整SQL
  let sql = `
    WITH ${baseCTE},
    ${aggregationCTE}
  `;

  // 添加排名逻辑
  if (ranking.enabled && ranking.rankField) {
    const topN = ranking.topN || 10;
    const bottomN = ranking.bottomN || 10;

    sql += `
    , ranked_data AS (
      SELECT
        *,
        ROW_NUMBER() OVER (ORDER BY ${ranking.rankField} DESC NULLS LAST) as rank_desc,
        ROW_NUMBER() OVER (ORDER BY ${ranking.rankField} ASC NULLS LAST) as rank_asc
      FROM aggregated_data
    )
    SELECT
      group_name,
      ${dimension.level === 'team' || dimension.level === 'salesman' ? 'parent_name,' : ''}
      ${dimension.level === 'salesman' ? 'org_name,' : ''}
      plan_year,
      plan_vehicle,
      plan_total,
      actual_vehicle,
      actual_total,
      rate_vehicle,
      rate_total,
      salesman_count,
      prev_year_premium,
      yoy_growth_rate,
      year_2025_actual,
      plan_growth_rate,
      CASE
        WHEN rank_desc <= ${topN} THEN 'top'
        WHEN rank_asc <= ${bottomN} THEN 'bottom'
        ELSE NULL
      END as rank_category
    FROM ranked_data
    WHERE rank_desc <= ${topN} OR rank_asc <= ${bottomN}
    ORDER BY ${sortField} ${sortOrder} NULLS LAST
    `;
  } else {
    // 无排名，全量数据
    sql += `
    SELECT
      group_name,
      ${dimension.level === 'team' || dimension.level === 'salesman' ? 'parent_name,' : ''}
      ${dimension.level === 'salesman' ? 'org_name,' : ''}
      plan_year,
      plan_vehicle,
      plan_total,
      actual_vehicle,
      actual_total,
      rate_vehicle,
      rate_total,
      salesman_count,
      prev_year_premium,
      yoy_growth_rate,
      year_2025_actual,
      plan_growth_rate
    FROM aggregated_data
    ORDER BY ${sortField} ${sortOrder} NULLS LAST
    `;
  }

  return sql;
}

/**
 * 生成PolicyFact直接查询（用于客户类别和险别组合下钻）
 * 这些层级不涉及计划数据，只统计实际保费
 */
function generatePolicyFactDrilldownQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  sortField: PlanSortField,
  sortOrder: SortOrder
): string {
  const filters = dimension.filters || {};
  const prevYear = planYear - 1;

  // 构建过滤条件
  const whereConditions: string[] = [`policy_date >= '${planYear}-01-01'`];

  if (filters.salesman) {
    whereConditions.push(`salesman_name = '${escapeSqlString(filters.salesman)}'`);
  }
  if (filters.customerCategory && dimension.level === 'coverage') {
    whereConditions.push(`customer_category = '${escapeSqlString(filters.customerCategory)}'`);
  }

  const whereClause = whereConditions.join(' AND ');
  const groupByField = dimension.level === 'customer_category' ? 'customer_category' : 'coverage_combination';

  return `
    WITH
    -- 当年数据
    current_year AS (
      SELECT
        COALESCE(${groupByField}, '未知') as group_name,
        SUM(premium) / 10000 as actual_vehicle
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY ${groupByField}
    ),
    -- 上年同期数据
    prev_year AS (
      SELECT
        COALESCE(${groupByField}, '未知') as group_name,
        SUM(premium) / 10000 as prev_year_premium
      FROM PolicyFact
      WHERE policy_date >= '${prevYear}-01-01'
        AND policy_date <= (SELECT MAX(policy_date) - INTERVAL 1 YEAR FROM PolicyFact WHERE policy_date >= '${planYear}-01-01')
        ${filters.salesman ? `AND salesman_name = '${escapeSqlString(filters.salesman)}'` : ''}
        ${filters.customerCategory && dimension.level === 'coverage' ? `AND customer_category = '${escapeSqlString(filters.customerCategory)}'` : ''}
      GROUP BY ${groupByField}
    )
    SELECT
      c.group_name,
      ${planYear} as plan_year,
      0 as plan_vehicle,
      0 as plan_total,
      COALESCE(c.actual_vehicle, 0) as actual_vehicle,
      0 as actual_total,
      NULL as rate_vehicle,
      NULL as rate_total,
      0 as salesman_count,
      COALESCE(p.prev_year_premium, 0) as prev_year_premium,
      CASE
        WHEN COALESCE(p.prev_year_premium, 0) > 0
        THEN (COALESCE(c.actual_vehicle, 0) - p.prev_year_premium) / p.prev_year_premium
        ELSE NULL
      END as yoy_growth_rate,
      0 as year_2025_actual,
      NULL as plan_growth_rate
    FROM current_year c
    LEFT JOIN prev_year p ON c.group_name = p.group_name
    ORDER BY ${sortField === 'plan_vehicle' ? 'actual_vehicle' : sortField} ${sortOrder} NULLS LAST
  `;
}

/**
 * 生成KPI卡片查询
 *
 * @param planYear - 计划年度
 * @param dimension - 下钻维度配置
 * @returns SQL查询语句
 */
export function generateKPICardQuery(
  planYear: number,
  dimension: PlanDrilldownDimension
): string {
  const baseCTE = generateSalesmanBaseCTE(planYear);
  const filters = dimension.filters || {};

  // 根据维度构建过滤条件
  const conditions: string[] = [];
  if (filters.org) {
    conditions.push(`org_name = '${escapeSqlString(filters.org)}'`);
  }
  if (filters.team) {
    conditions.push(`team_name = '${escapeSqlString(filters.team)}'`);
  }
  if (filters.salesman) {
    conditions.push(`salesman_name = '${escapeSqlString(filters.salesman)}'`);
  }

  const filterCondition = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return `
    WITH ${baseCTE}
    SELECT
      SUM(plan_vehicle) as total_plan_vehicle,
      SUM(plan_total) as total_plan_total,
      SUM(actual_vehicle) as total_actual_vehicle,
      SUM(actual_total) as total_actual_total,
      CASE
        WHEN SUM(plan_vehicle) > 0
        THEN SUM(actual_vehicle) / (SUM(plan_vehicle) * (SELECT progress FROM time_progress))
        ELSE NULL
      END as avg_rate_vehicle,
      NULL as avg_rate_total,
      COUNT(DISTINCT salesman_name) as total_salesman_count
    FROM salesman_base
    ${filterCondition}
  `;
}

/**
 * 生成达成率分布查询（按时间进度达成率区间统计）
 *
 * 达成率计算口径（统一）：
 * - 时间进度达成率 = 实际保费 / (计划保费 × 时间进度)
 * - 时间进度 = (当前日期 - 1月1日) / 365
 *
 * @param planYear - 计划年度
 * @param dimension - 下钻维度配置
 * @returns SQL查询语句
 */
export function generateRateDistributionQuery(
  planYear: number,
  dimension: PlanDrilldownDimension
): string {
  const baseCTE = generateSalesmanBaseCTE(planYear);
  const filters = dimension.filters || {};

  // 根据维度构建过滤条件
  const conditions: string[] = [];
  if (filters.org) {
    conditions.push(`org_name = '${escapeSqlString(filters.org)}'`);
  }
  if (filters.team) {
    conditions.push(`team_name = '${escapeSqlString(filters.team)}'`);
  }
  if (filters.salesman) {
    conditions.push(`salesman_name = '${escapeSqlString(filters.salesman)}'`);
  }

  const filterCondition = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return `
    WITH ${baseCTE}
    SELECT
      CASE
        WHEN rate_vehicle IS NULL THEN '无计划'
        WHEN rate_vehicle < 0.5 THEN '<50%'
        WHEN rate_vehicle < 0.8 THEN '50%-80%'
        WHEN rate_vehicle < 1.0 THEN '80%-100%'
        WHEN rate_vehicle < 1.2 THEN '100%-120%'
        ELSE '≥120%'
      END as rate_range,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
    FROM salesman_base
    ${filterCondition}
    GROUP BY rate_range
    ORDER BY
      CASE rate_range
        WHEN '无计划' THEN 0
        WHEN '<50%' THEN 1
        WHEN '50%-80%' THEN 2
        WHEN '80%-100%' THEN 3
        WHEN '100%-120%' THEN 4
        WHEN '≥120%' THEN 5
      END
  `;
}
