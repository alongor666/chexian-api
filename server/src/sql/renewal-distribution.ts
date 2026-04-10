/**
 * 续保分布分析 SQL 生成器
 *
 * 从 renewal-drilldown.ts 提取的 3 个分布查询函数，去重为模板 + 薄包装。
 * 变化轴：GROUP BY 表达式、输出别名、是否含 selfRenewalOnly 条件。
 * 其余（WHERE 构建、team CTE、聚合 SELECT）100% 共享。
 *
 * @see M-extra2 重构计划
 */

import type { AdvancedFilterState } from '../types/data.js';
import {
  validateYear,
  escapeSQL,
  IS_QUOTE_TRUE_CONDITION,
  EXPIRY_DATE_EXPR,
  type DrilldownDimension,
  type DistributionType,
} from './renewal-drilldown-shared.js';

// ============================================================================
// 内部类型
// ============================================================================

interface DistributionConfig {
  /** GROUP BY 中的表达式 */
  readonly groupByExpr: string;
  /** SELECT 中的显示表达式（可含 CASE WHEN） */
  readonly displayExpr: string;
  /** 输出列别名 */
  readonly outputAlias: string;
  /** 是否包含 selfRenewalOnly 条件 */
  readonly includeSelfRenewalFilter: boolean;
}

// ============================================================================
// 共享 WHERE 构建（仅含 3 个分布函数共有的条件）
// ============================================================================

function buildDistributionWhereClause(
  dimension: DrilldownDimension,
  validYear: number,
  cutoffDate: string | undefined,
  includeSelfRenewalFilter: boolean,
): string {
  const conditions: string[] = [];

  if (dimension.dueMonth && dimension.dueMonth >= 1 && dimension.dueMonth <= 12) {
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dimension.dueMonth}`);
  } else {
    const baseYear = validYear - 1;
    conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);
  }

  if (cutoffDate && !dimension.dueMonth) {
    const startDate = `${validYear}-01-01`;
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${escapeSQL(startDate)}' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  if (includeSelfRenewalFilter && dimension.selfRenewalOnly) {
    conditions.push(`renewal_mode = '自留'`);
  }

  if (dimension.filters?.org) {
    conditions.push(`org_level_3 = '${escapeSQL(dimension.filters.org)}'`);
  }
  if (dimension.filters?.salesman) {
    conditions.push(`salesman_name LIKE '%${escapeSQL(dimension.filters.salesman)}%'`);
  }

  if (!dimension.filters) {
    if (dimension.level === 'org' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    } else if (dimension.level === 'salesman' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    }
  }

  return conditions.join(' AND ');
}

// ============================================================================
// 聚合 SQL 模板
// ============================================================================

function buildRenewalAggregateSQL(
  config: DistributionConfig,
  dimension: DrilldownDimension,
  validYear: number,
  cutoffDate: string | undefined,
): string {
  const whereClause = buildDistributionWhereClause(
    dimension, validYear, cutoffDate, config.includeSelfRenewalFilter,
  );

  const needsTeamJoin = !!dimension.filters?.team;
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  const selectBlock = `
        ${config.displayExpr} AS ${config.outputAlias},
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS renewal_rate,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS quote_rate`;

  const groupHavingOrder = `
      GROUP BY ${config.groupByExpr}
      HAVING COUNT(DISTINCT policy_no) >= 1
      ORDER BY due_count DESC`;

  if (needsTeamJoin) {
    return `
      WITH team_mapping AS (
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
      )
      SELECT ${selectBlock}
      FROM renewal_with_team
      WHERE ${whereClause}${teamFilterClause}${groupHavingOrder}
    `;
  }

  return `
    SELECT ${selectBlock}
    FROM PolicyFactRenewal
    WHERE ${whereClause}${groupHavingOrder}
  `;
}

// ============================================================================
// 公开 API — 3 个分布查询（签名与原函数完全一致）
// ============================================================================

export function generateCustomerCategoryQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  return buildRenewalAggregateSQL(
    {
      groupByExpr: 'customer_category',
      displayExpr: 'customer_category',
      outputAlias: 'customer_category',
      includeSelfRenewalFilter: true,
    },
    dimension, validateYear(targetYear), cutoffDate,
  );
}

export function generateRenewalModeQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  return buildRenewalAggregateSQL(
    {
      groupByExpr: `COALESCE(renewal_mode, '未知')`,
      displayExpr: `COALESCE(renewal_mode, '未知')`,
      outputAlias: 'renewal_mode',
      includeSelfRenewalFilter: false,
    },
    dimension, validateYear(targetYear), cutoffDate,
  );
}

export function generateDistributionQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  distributionType: DistributionType,
  cutoffDate?: string
): string {
  let groupField: string;
  let displayField: string;
  switch (distributionType) {
    case 'coverage':
      groupField = 'coverage_combination';
      displayField = 'coverage_combination';
      break;
    case 'new_car':
      groupField = 'is_new_car';
      displayField = `CASE WHEN CAST(is_new_car AS VARCHAR) IN ('true', 'TRUE', '1', '是') THEN '新车' ELSE '旧车' END`;
      break;
    case 'nev':
      groupField = 'is_nev';
      displayField = `CASE WHEN CAST(is_nev AS VARCHAR) IN ('true', 'TRUE', '1', '是') THEN '新能源' ELSE '燃油' END`;
      break;
    case 'transfer':
      groupField = 'is_transfer';
      displayField = `CASE WHEN CAST(is_transfer AS VARCHAR) IN ('true', 'TRUE', '1', '是') THEN '过户' ELSE '非过户' END`;
      break;
    default:
      groupField = 'coverage_combination';
      displayField = 'coverage_combination';
  }

  return buildRenewalAggregateSQL(
    {
      groupByExpr: groupField,
      displayExpr: displayField,
      outputAlias: 'category',
      includeSelfRenewalFilter: true,
    },
    dimension, validateYear(targetYear), cutoffDate,
  );
}
