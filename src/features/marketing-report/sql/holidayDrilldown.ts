/**
 * Holiday Drilldown SQL Generator
 *
 * 假日营销下钻分析 SQL 生成器
 *
 * 功能：
 * - 六层下钻：公司整体 → 三级机构 → 团队 → 业务员 → 客户类别 → 险别组合
 * - 提前投保天数分布：≤1天、≤3天、≤7天、>7天
 * - Top10/Last10 展示（公司/机构/团队层级）
 * - 全量展示（业务员/细分维度层级）
 *
 * 数据来源：
 * - PolicyFact（保单视图）
 * - SalesmanPlanFact（用于获取团队归属关系）
 * - 筛选条件：签单日期在休息日（周末+法定节假日）
 */

import { generateHolidayValuesSql } from '../utils/holidayUtils';
import type { AdvancedFilterState } from '../../../shared/types/data';

/**
 * 下钻层级类型
 * 四层结构：公司 → 三级机构 → 业务员 → 细分维度
 * 兼容六层结构：公司 → 三级机构 → 团队 → 业务员 → 客户类别 → 险别组合
 */
export type DrilldownLevel = 'company' | 'org' | 'team' | 'salesman' | 'customer_category' | 'coverage' | 'detail';

/**
 * 下钻维度配置
 */
export interface DrilldownDimension {
  /** 当前层级 */
  level: DrilldownLevel;
  /** 完整的过滤路径 */
  filters?: {
    org?: string;
    team?: string;
    salesman?: string;
    customerCategory?: string;
  };
}

/**
 * 排序方式
 */
export type SortField = 'offday_count' | 'le1_rate' | 'le3_rate' | 'le7_rate';
export type SortOrder = 'asc' | 'desc';

/**
 * 排名筛选配置
 */
export interface RankingConfig {
  /** 是否启用Top/Last筛选 */
  enabled: boolean;
  /** Top N */
  topN?: number;
  /** Last N */
  lastN?: number;
  /** 最小休息日签单数 */
  minOffdayCount?: number;
}

/**
 * SQL字符串转义
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * 构建假日营销下钻的WHERE子句
 */
function buildDrilldownWhereClause(
  _filters: AdvancedFilterState,
  dimension: DrilldownDimension,
  startDate: string,
  endDate: string
): string {
  const conditions: string[] = [];
  const dimFilters = dimension.filters || {};

  // 1. 日期范围条件
  conditions.push(`p.policy_date >= '${startDate}'`);
  conditions.push(`p.policy_date <= '${endDate}'`);

  // 2. 休息日判断（周末 + 法定节假日）
  const holidayValues = generateHolidayValuesSql(startDate, endDate);
  conditions.push(`
    (
      EXTRACT(DAYOFWEEK FROM CAST(p.policy_date AS DATE)) IN (0, 6)
      OR CAST(p.policy_date AS DATE) IN (
        SELECT CAST(date_str AS DATE)
        FROM (VALUES ${holidayValues}) AS h(date_str)
      )
    )
  `);

  // 3. 层级筛选
  if (dimFilters.org) {
    conditions.push(`COALESCE(s.org_name, p.org_level_3) = '${escapeSqlString(dimFilters.org)}'`);
  }
  if (dimFilters.team) {
    conditions.push(`s.team_name = '${escapeSqlString(dimFilters.team)}'`);
  }
  if (dimFilters.salesman) {
    conditions.push(`p.salesman_name = '${escapeSqlString(dimFilters.salesman)}'`);
  }
  if (dimFilters.customerCategory && (dimension.level === 'coverage')) {
    conditions.push(`p.customer_category = '${escapeSqlString(dimFilters.customerCategory)}'`);
  }

  return conditions.join(' AND ');
}

/**
 * 生成KPI卡片查询
 */
export function generateKPICardQuery(
  filters: AdvancedFilterState,
  startDate: string,
  endDate: string,
  dimension: DrilldownDimension
): string {
  const whereClause = buildDrilldownWhereClause(filters, dimension, startDate, endDate);

  // 获取当前年份，用于关联 Team 信息
  const currentYear = new Date().getFullYear();

  return `
WITH base_data AS (
  SELECT
    p.policy_no,
    p.policy_date,
    p.insurance_start_date
  FROM PolicyFact p
  LEFT JOIN (
    SELECT DISTINCT salesman_name, team_name, org_name 
    FROM SalesmanPlanFact 
    WHERE plan_year = ${currentYear}
  ) s ON p.salesman_name = s.salesman_name
  WHERE ${whereClause}
)
SELECT
  COUNT(DISTINCT policy_no) AS offday_count,
  COUNT(DISTINCT CASE
    WHEN DATE_DIFF('day', CAST(policy_date AS DATE), CAST(insurance_start_date AS DATE)) + 1 <= 1
    THEN policy_no
  END) AS le1_count,
  COUNT(DISTINCT CASE
    WHEN DATE_DIFF('day', CAST(policy_date AS DATE), CAST(insurance_start_date AS DATE)) + 1 <= 3
    THEN policy_no
  END) AS le3_count,
  COUNT(DISTINCT CASE
    WHEN DATE_DIFF('day', CAST(policy_date AS DATE), CAST(insurance_start_date AS DATE)) + 1 <= 7
    THEN policy_no
  END) AS le7_count,
  -- 计算占比
  CASE WHEN COUNT(DISTINCT policy_no) > 0 
       THEN COUNT(DISTINCT CASE WHEN DATE_DIFF('day', CAST(policy_date AS DATE), CAST(insurance_start_date AS DATE)) + 1 <= 1 THEN policy_no END) * 1.0 / COUNT(DISTINCT policy_no)
       ELSE 0 END AS le1_rate,
  CASE WHEN COUNT(DISTINCT policy_no) > 0 
       THEN COUNT(DISTINCT CASE WHEN DATE_DIFF('day', CAST(policy_date AS DATE), CAST(insurance_start_date AS DATE)) + 1 <= 3 THEN policy_no END) * 1.0 / COUNT(DISTINCT policy_no)
       ELSE 0 END AS le3_rate,
  CASE WHEN COUNT(DISTINCT policy_no) > 0 
       THEN COUNT(DISTINCT CASE WHEN DATE_DIFF('day', CAST(policy_date AS DATE), CAST(insurance_start_date AS DATE)) + 1 <= 7 THEN policy_no END) * 1.0 / COUNT(DISTINCT policy_no)
       ELSE 0 END AS le7_rate
FROM base_data
`;
}

/**
 * 生成假日营销下钻汇总查询
 */
export function generateHolidayDrilldownQuery(
  filters: AdvancedFilterState,
  startDate: string,
  endDate: string,
  dimension: DrilldownDimension,
  ranking: RankingConfig = { enabled: false },
  sortField: SortField = 'offday_count',
  sortOrder: SortOrder = 'desc'
): string {
  const whereClause = buildDrilldownWhereClause(filters, dimension, startDate, endDate);
  const minOffdayCount = ranking.minOffdayCount ?? 1;
  const currentYear = new Date().getFullYear();

  // 定义各层级的分组字段
  let groupByField = '';
  let groupNameExpr = '';
  let parentNameExpr = 'NULL';

  switch (dimension.level) {
    case 'company':
      groupByField = ''; // 全局聚合
      groupNameExpr = "'整体'";
      break;
    case 'org':
      groupByField = 'COALESCE(s.org_name, p.org_level_3)';
      groupNameExpr = 'COALESCE(s.org_name, p.org_level_3)';
      parentNameExpr = "'整体'";
      break;
    case 'team':
      groupByField = 's.team_name, COALESCE(s.org_name, p.org_level_3)';
      groupNameExpr = "COALESCE(s.team_name, '未归属团队')";
      parentNameExpr = 'COALESCE(s.org_name, p.org_level_3)';
      break;
    case 'salesman':
      groupByField = 'p.salesman_name, s.team_name';
      groupNameExpr = 'p.salesman_name';
      parentNameExpr = "COALESCE(s.team_name, '未归属团队')";
      break;
    case 'customer_category':
      groupByField = 'p.customer_category, p.salesman_name';
      groupNameExpr = "COALESCE(p.customer_category, '未知')";
      parentNameExpr = 'p.salesman_name';
      break;
    case 'coverage':
      groupByField = 'p.coverage_combination, p.customer_category';
      groupNameExpr = "COALESCE(p.coverage_combination, '未知')";
      parentNameExpr = "COALESCE(p.customer_category, '未知')";
      break;
    case 'detail':
      // 细分维度：按客户类别和险别组合分组
      groupByField = 'p.customer_category, p.coverage_combination';
      groupNameExpr = "COALESCE(p.customer_category, '未知') || ' - ' || COALESCE(p.coverage_combination, '未知')";
      parentNameExpr = 'p.salesman_name';
      break;
  }

  // 基础聚合查询
  const baseQuery = `
    WITH drilldown_base AS (
      SELECT
        ${groupNameExpr} AS group_name,
        ${parentNameExpr} as parent_name,
        '${dimension.level}' as level_type,
        -- 休息日签单保单数
        COUNT(DISTINCT p.policy_no) AS offday_count,
        -- ≤1天件数
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 1
          THEN p.policy_no
        END) AS le1_count,
        -- ≤3天件数
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 3
          THEN p.policy_no
        END) AS le3_count,
        -- ≤7天件数
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 7
          THEN p.policy_no
        END) AS le7_count
      FROM PolicyFact p
      LEFT JOIN (
        SELECT DISTINCT salesman_name, team_name, org_name 
        FROM SalesmanPlanFact 
        WHERE plan_year = ${currentYear}
      ) s ON p.salesman_name = s.salesman_name
      WHERE ${whereClause}
      ${groupByField ? `GROUP BY ${groupByField}` : ''}
      HAVING COUNT(DISTINCT p.policy_no) >= ${minOffdayCount}
    ),
    drilldown_calc AS (
      SELECT
        group_name,
        parent_name,
        level_type,
        offday_count,
        le1_count,
        le3_count,
        le7_count,
        -- ≤1天占比
        CASE WHEN offday_count = 0 THEN 0
          ELSE le1_count * 1.0 / offday_count
        END AS le1_rate,
        -- ≤3天占比
        CASE WHEN offday_count = 0 THEN 0
          ELSE le3_count * 1.0 / offday_count
        END AS le3_rate,
        -- ≤7天占比
        CASE WHEN offday_count = 0 THEN 0
          ELSE le7_count * 1.0 / offday_count
        END AS le7_rate,
        -- 排名
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder}) AS rank_asc,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder === 'asc' ? 'desc' : 'asc'}) AS rank_desc
      FROM drilldown_base
    )
  `;

  // 根据ranking配置生成最终查询
  if (ranking.enabled && (ranking.topN || ranking.lastN)) {
    const topN = ranking.topN || 0;
    const lastN = ranking.lastN || 0;

    return `
      ${baseQuery}
      SELECT * FROM drilldown_calc
      WHERE rank_asc <= ${topN} OR rank_desc <= ${lastN}
      ORDER BY ${sortField} ${sortOrder}
    `;
  }

  return `
    ${baseQuery}
    SELECT * FROM drilldown_calc
    ORDER BY ${sortField} ${sortOrder}
  `;
}

/**
 * 生成客户类别分布查询
 */
export function generateCustomerCategoryQuery(
  filters: AdvancedFilterState,
  startDate: string,
  endDate: string,
  dimension: DrilldownDimension
): string {
  const baseWhereClause = buildDrilldownWhereClause(filters, dimension, startDate, endDate);
  const currentYear = new Date().getFullYear();

  return `
    WITH category_base AS (
      SELECT
        COALESCE(p.customer_category, '未知') AS customer_category,
        COUNT(DISTINCT p.policy_no) AS offday_count,
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 1
          THEN p.policy_no
        END) AS le1_count,
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 3
          THEN p.policy_no
        END) AS le3_count,
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 7
          THEN p.policy_no
        END) AS le7_count
      FROM PolicyFact p
      LEFT JOIN (
        SELECT DISTINCT salesman_name, team_name, org_name
        FROM SalesmanPlanFact
        WHERE plan_year = ${currentYear}
      ) s ON p.salesman_name = s.salesman_name
      WHERE ${baseWhereClause}
      GROUP BY COALESCE(p.customer_category, '未知')
    )
    SELECT
      customer_category,
      offday_count,
      le1_count,
      le3_count,
      le7_count,
      CASE WHEN offday_count = 0 THEN 0 ELSE le1_count * 1.0 / offday_count END AS le1_rate,
      CASE WHEN offday_count = 0 THEN 0 ELSE le3_count * 1.0 / offday_count END AS le3_rate,
      CASE WHEN offday_count = 0 THEN 0 ELSE le7_count * 1.0 / offday_count END AS le7_rate
    FROM category_base
    ORDER BY offday_count DESC
  `;
}

/**
 * 生成险别组合分布查询
 */
export function generateCoverageCombinationQuery(
  filters: AdvancedFilterState,
  startDate: string,
  endDate: string,
  dimension: DrilldownDimension
): string {
  const baseWhereClause = buildDrilldownWhereClause(filters, dimension, startDate, endDate);
  const currentYear = new Date().getFullYear();

  return `
    WITH coverage_base AS (
      SELECT
        COALESCE(p.coverage_combination, '未知') AS coverage_combination,
        COUNT(DISTINCT p.policy_no) AS offday_count,
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 1
          THEN p.policy_no
        END) AS le1_count,
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 3
          THEN p.policy_no
        END) AS le3_count,
        COUNT(DISTINCT CASE
          WHEN DATE_DIFF('day', CAST(p.policy_date AS DATE), CAST(p.insurance_start_date AS DATE)) + 1 <= 7
          THEN p.policy_no
        END) AS le7_count
      FROM PolicyFact p
      LEFT JOIN (
        SELECT DISTINCT salesman_name, team_name, org_name
        FROM SalesmanPlanFact
        WHERE plan_year = ${currentYear}
      ) s ON p.salesman_name = s.salesman_name
      WHERE ${baseWhereClause}
      GROUP BY COALESCE(p.coverage_combination, '未知')
    )
    SELECT
      coverage_combination,
      offday_count,
      le1_count,
      le3_count,
      le7_count,
      CASE WHEN offday_count = 0 THEN 0 ELSE le1_count * 1.0 / offday_count END AS le1_rate,
      CASE WHEN offday_count = 0 THEN 0 ELSE le3_count * 1.0 / offday_count END AS le3_rate,
      CASE WHEN offday_count = 0 THEN 0 ELSE le7_count * 1.0 / offday_count END AS le7_rate
    FROM coverage_base
    ORDER BY offday_count DESC
  `;
}