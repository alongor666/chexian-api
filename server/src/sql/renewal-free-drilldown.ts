/**
 * 续保自由维度下钻 (V2) — groupBy + drillPath 动态查询模式
 *
 * 替代旧版固定5层线性下钻，支持任意维度组合。
 * 有独立的类型系统和辅助函数，与线性下钻模块无交叉依赖。
 *
 * @see P1#9 架构优化计划
 */

import { buildWhereClauseFromFilters } from '../utils/queryBuilder.js';
import { createLogger } from '../utils/logger.js';
import type { AdvancedFilterState } from '../types/data.js';
import type { DateCriteria } from '../types/data.js';
import {
  validateYear,
  escapeSQL,
  IS_QUOTE_TRUE_CONDITION,
  EXPIRY_DATE_EXPR,
  validateSortParams,
  type SortField,
  type SortOrder,
} from './renewal-drilldown-shared.js';

const logger = createLogger('RenewalFreeDrilldownSQL');

// ============================================================================
// V2 类型定义
// ============================================================================

/** 续保分析支持的自由下钻维度 */
export type RenewalDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'coverage_combination'
  | 'customer_category'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing';

/** 下钻路径步骤 */
export interface RenewalDrillStep {
  dimension: RenewalDrillDimension;
  value: string;
}

/** 自由维度下钻请求参数 */
export interface RenewalFreeDrilldownParams {
  targetYear: number;
  groupBy: RenewalDrillDimension;
  drillPath: RenewalDrillStep[];
  selfRenewalOnly?: boolean;
  bundleOnly?: boolean;
  dueMonth?: number;
  cutoffDate?: string;
  sortField?: SortField;
  sortOrder?: SortOrder;
}

// ============================================================================
// V2 辅助函数
// ============================================================================

/** 维度 → GROUP BY 配置 */
function getRenewalGroupByConfig(dimension: RenewalDrillDimension): {
  selectExpr: string;
  groupByExpr: string;
  needsTeamJoin: boolean;
} {
  switch (dimension) {
    case 'org_level_3':
      return {
        selectExpr: "COALESCE(r.org_level_3, '未知') AS group_name",
        groupByExpr: "COALESCE(r.org_level_3, '未知')",
        needsTeamJoin: false,
      };
    case 'team':
      return {
        selectExpr: "COALESCE(team_name, r.org_level_3 || '未归属团队') AS group_name",
        groupByExpr: "COALESCE(team_name, r.org_level_3 || '未归属团队')",
        needsTeamJoin: true,
      };
    case 'salesman':
      return {
        selectExpr: "REGEXP_REPLACE(r.salesman_name, '^[0-9]+', '') AS group_name",
        groupByExpr: "REGEXP_REPLACE(r.salesman_name, '^[0-9]+', '')",
        needsTeamJoin: false,
      };
    case 'coverage_combination':
      return {
        selectExpr: "COALESCE(r.coverage_combination, '未知') AS group_name",
        groupByExpr: "COALESCE(r.coverage_combination, '未知')",
        needsTeamJoin: false,
      };
    case 'customer_category':
      return {
        selectExpr: "COALESCE(r.customer_category, '未知') AS group_name",
        groupByExpr: "COALESCE(r.customer_category, '未知')",
        needsTeamJoin: false,
      };
    case 'is_new_car':
      return {
        selectExpr: "CASE WHEN r.is_new_car = 'true' OR r.is_new_car = '1' THEN '新车' ELSE '旧车' END AS group_name",
        groupByExpr: "CASE WHEN r.is_new_car = 'true' OR r.is_new_car = '1' THEN '新车' ELSE '旧车' END",
        needsTeamJoin: false,
      };
    case 'is_transfer':
      return {
        selectExpr: "CASE WHEN r.is_transfer = 'true' OR r.is_transfer = '1' THEN '过户车' ELSE '非过户' END AS group_name",
        groupByExpr: "CASE WHEN r.is_transfer = 'true' OR r.is_transfer = '1' THEN '过户车' ELSE '非过户' END",
        needsTeamJoin: false,
      };
    case 'is_nev':
      return {
        selectExpr: "CASE WHEN r.is_nev = 'true' OR r.is_nev = '1' THEN '新能源' ELSE '传统燃油' END AS group_name",
        groupByExpr: "CASE WHEN r.is_nev = 'true' OR r.is_nev = '1' THEN '新能源' ELSE '传统燃油' END",
        needsTeamJoin: false,
      };
    case 'is_telemarketing':
      return {
        selectExpr: "CASE WHEN r.is_telemarketing = 'true' OR r.is_telemarketing = '1' THEN '电销' ELSE '非电销' END AS group_name",
        groupByExpr: "CASE WHEN r.is_telemarketing = 'true' OR r.is_telemarketing = '1' THEN '电销' ELSE '非电销' END",
        needsTeamJoin: false,
      };
  }
}

/** 下钻路径步骤 → WHERE 条件 */
function renewalDrillStepToWhere(step: RenewalDrillStep): string {
  const val = escapeSQL(step.value);
  switch (step.dimension) {
    case 'org_level_3':
      return `r.org_level_3 = '${val}'`;
    case 'team':
      // team_name 来自 JOIN，别名在 renewal_with_team CTE 中
      return `team_name = '${val}'`;
    case 'salesman':
      return `REGEXP_REPLACE(r.salesman_name, '^[0-9]+', '') = '${val}'`;
    case 'coverage_combination':
      return `r.coverage_combination = '${val}'`;
    case 'customer_category':
      return `r.customer_category = '${val}'`;
    case 'is_new_car':
      return step.value === '新车'
        ? "(r.is_new_car = 'true' OR r.is_new_car = '1')"
        : "NOT (r.is_new_car = 'true' OR r.is_new_car = '1')";
    case 'is_transfer':
      return step.value === '过户车'
        ? "(r.is_transfer = 'true' OR r.is_transfer = '1')"
        : "NOT (r.is_transfer = 'true' OR r.is_transfer = '1')";
    case 'is_nev':
      return step.value === '新能源'
        ? "(r.is_nev = 'true' OR r.is_nev = '1')"
        : "NOT (r.is_nev = 'true' OR r.is_nev = '1')";
    case 'is_telemarketing':
      return step.value === '电销'
        ? "(r.is_telemarketing = 'true' OR r.is_telemarketing = '1')"
        : "NOT (r.is_telemarketing = 'true' OR r.is_telemarketing = '1')";
  }
}

// ============================================================================
// V2 查询生成器
// ============================================================================

/**
 * 自由维度续保下钻查询 (V2)
 *
 * 替代旧版固定5层线性下钻，支持任意维度组合：
 * - groupBy: 当前分组维度
 * - drillPath: 已选维度路径（生成 WHERE 条件）
 */
export function generateRenewalFreeDrilldownQuery(
  filters: AdvancedFilterState,
  params: RenewalFreeDrilldownParams,
): string {
  const {
    targetYear,
    groupBy,
    drillPath,
    selfRenewalOnly,
    bundleOnly,
    dueMonth,
    cutoffDate,
    sortField = 'renewal_rate',
    sortOrder = 'desc',
  } = params;

  const validYear = validateYear(targetYear);
  validateSortParams(sortField, sortOrder);
  const groupConfig = getRenewalGroupByConfig(groupBy);

  // ── 构建 WHERE 条件 ──
  const conditions: string[] = [];

  // 时间口径
  if (dueMonth && dueMonth >= 1 && dueMonth <= 12) {
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dueMonth}`);
  } else {
    conditions.push(`YEAR(CAST(r.insurance_start_date AS DATE)) = ${validYear - 1}`);
  }

  if (cutoffDate && !dueMonth) {
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${validYear}-01-01' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  if (bundleOnly) conditions.push(`r.is_commercial_insure = '套单'`);
  if (selfRenewalOnly) conditions.push(`r.renewal_mode = '自留'`);

  // drillPath → WHERE
  for (const step of drillPath) {
    conditions.push(renewalDrillStepToWhere(step));
  }

  // 其他筛选（权限等）
  const additionalFilters: AdvancedFilterState = {
    ...filters,
    policy_date_start: undefined,
    policy_date_end: undefined,
  };
  const additionalWhere = buildWhereClauseFromFilters(
    additionalFilters,
    'insurance_start_date' as DateCriteria,
  );
  if (additionalWhere && additionalWhere !== '1=1') {
    conditions.push(additionalWhere);
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  // ── 判断是否需要 team JOIN ──
  const needsTeamJoin = groupConfig.needsTeamJoin ||
    drillPath.some((s) => s.dimension === 'team');

  // ── 构建 SQL ──
  const teamCte = needsTeamJoin
    ? `
    team_mapping AS (
      SELECT DISTINCT salesman_name, team_name, org_name
      FROM SalesmanPlanFact
      WHERE plan_year = ${validYear}
    ),
    renewal_with_team AS (
      SELECT
        r.*,
        COALESCE(t.team_name, r.org_level_3 || '未归属团队') AS team_name
      FROM PolicyFactRenewal r
      LEFT JOIN team_mapping t ON r.salesman_name = t.salesman_name
    ),`
    : '';

  const sourceTable = needsTeamJoin ? 'renewal_with_team r' : 'PolicyFactRenewal r';

  logger.debug('生成续保自由维度下钻查询', { groupBy, drillPath, targetYear: validYear });

  return `
    WITH ${teamCte}
    drilldown_base AS (
      SELECT
        ${groupConfig.selectExpr},
        '${escapeSQL(groupBy)}' AS level_type,
        COUNT(DISTINCT r.policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN r.renewal_policy_no IS NOT NULL AND r.renewal_policy_no <> ''
          THEN r.policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION.replace(/is_quote/g, 'r.is_quote')}
          THEN r.policy_no
        END) AS quoted_count,
        COALESCE(SUM(r.premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN r.renewal_policy_no IS NOT NULL AND r.renewal_policy_no <> ''
          THEN r.premium ELSE 0
        END), 0) AS renewed_premium,
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION.replace(/is_quote/g, 'r.is_quote')}
          THEN r.premium ELSE 0
        END), 0) AS quoted_premium
      FROM ${sourceTable}
      WHERE ${whereClause}
      GROUP BY ${groupConfig.groupByExpr}
      HAVING COUNT(DISTINCT r.policy_no) >= 1
    ),
    drilldown_calc AS (
      SELECT
        group_name,
        '' AS parent_name,
        level_type,
        due_count,
        renewed_count,
        quoted_count,
        due_premium,
        renewed_premium,
        quoted_premium,
        CASE WHEN due_count = 0 THEN 0 ELSE renewed_count * 1.0 / due_count END AS renewal_rate,
        CASE WHEN due_count = 0 THEN 0 ELSE quoted_count * 1.0 / due_count END AS quote_rate,
        CASE WHEN due_premium = 0 THEN 0 ELSE renewed_premium * 1.0 / due_premium END AS renewal_premium_rate,
        CASE WHEN due_premium = 0 THEN 0 ELSE quoted_premium * 1.0 / due_premium END AS quote_premium_rate,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder}) AS rank_asc,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder === 'asc' ? 'desc' : 'asc'}) AS rank_desc
      FROM drilldown_base
    )
    SELECT * FROM drilldown_calc
    ORDER BY ${sortField} ${sortOrder}
  `;
}
