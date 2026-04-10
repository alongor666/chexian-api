/**
 * Renewal Drilldown SQL Generator
 *
 * 续保下钻分析 SQL 生成器 — 7 个核心查询生成器。
 * 共享类型与辅助函数在 renewal-drilldown-shared.ts，
 * V2 自由维度下钻在 renewal-free-drilldown.ts。
 *
 * ============================================================================
 * 【重要业务知识】续保分析的核心规则
 * ============================================================================
 *
 * ### 【核心公式】到期日计算
 *
 * ```
 * 到期日 = 起保日 + 1年 - 1天
 * ```
 *
 * ⚠️ 这个 "-1天" 非常关键！它导致每个月1日起保的保单实际在**上个月最后一天**到期：
 *
 * | 起保日       | 到期日       | 实际到期月份 |
 * |-------------|-------------|-------------|
 * | 2025-02-01  | 2026-01-31  | **1月**     |
 * | 2025-02-02  | 2026-02-01  | **2月**     |
 * | 2025-03-01  | 2026-02-28  | **2月**     |
 *
 * ### 两种统计模式（互斥）
 * - **模式一**：dueMonth 参数 → 按到期月份统计，不用 cutoffDate
 * - **模式二**：cutoffDate 参数（无 dueMonth）→ 按到期日范围统计
 *
 * @see P1#9 架构优化计划
 */

import type { AdvancedFilterState } from '../types/data.js';
import { createLogger } from '../utils/logger.js';
import {
  validateYear,
  escapeSQL,
  IS_QUOTE_TRUE_CONDITION,
  buildDrilldownWhereClause,
  getGroupByField,
  getAdditionalFields,
  validateSortParams,
  type DrilldownDimension,
  type DrilldownLevel,
  type DistributionType,
  type SortField,
  type SortOrder,
  type RankingConfig,
} from './renewal-drilldown-shared.js';

const logger = createLogger('RenewalDrilldownSQL');

// ============================================================================
// Barrel re-exports — 调用方无需修改 import
// ============================================================================

export type {
  DrilldownLevel,
  DrilldownDimension,
  DistributionType,
  SortField,
  SortOrder,
  RankingConfig,
} from './renewal-drilldown-shared.js';

export type {
  RenewalDrillDimension,
  RenewalDrillStep,
  RenewalFreeDrilldownParams,
} from './renewal-free-drilldown.js';

export { generateRenewalFreeDrilldownQuery } from './renewal-free-drilldown.js';

export {
  generateCustomerCategoryQuery,
  generateRenewalModeQuery,
  generateDistributionQuery,
} from './renewal-distribution.js';

// ============================================================================
// 核心查询生成器
// ============================================================================

export function generateRenewalDrilldownQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  ranking: RankingConfig = { enabled: false },
  sortField: SortField = 'renewal_rate',
  sortOrder: SortOrder = 'desc',
  cutoffDate?: string
): string {
  const validYear = validateYear(targetYear);
  validateSortParams(sortField, sortOrder);
  const whereClause = buildDrilldownWhereClause(filters, dimension, validYear, cutoffDate);
  const groupByField = getGroupByField(dimension.level);
  const additionalFields = getAdditionalFields(dimension.level, dimension);
  const minDueCount = ranking.minDueCount ?? 1;

  logger.debug('生成续保下钻查询', {
    targetYear: validYear,
    dimension,
    ranking,
    sortField,
    sortOrder,
  });

  const needsTeamJoin = dimension.level === 'team' || dimension.level === 'salesman' || dimension.level === 'coverage';

  let groupByClause: string;
  switch (dimension.level) {
    case 'company':
      groupByClause = '1, 2, 3';
      break;
    case 'org':
      groupByClause = 'org_level_3';
      break;
    case 'team':
      groupByClause = 'team_name';
      break;
    case 'salesman':
      groupByClause = "REGEXP_REPLACE(r.salesman_name, '^[0-9]+', ''), team_name";
      break;
    case 'coverage':
      groupByClause = 'coverage_combination';
      break;
    default:
      groupByClause = '1';
  }

  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  let baseQuery: string;

  if (needsTeamJoin) {
    baseQuery = `
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
    ),
    drilldown_base AS (
      SELECT
        ${groupByField.replace('salesman_name', 'r.salesman_name')},
        ${additionalFields},
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
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN premium ELSE 0
        END), 0) AS quoted_premium
      FROM renewal_with_team r
      WHERE ${whereClause}${teamFilterClause}
      GROUP BY ${groupByClause}
      HAVING COUNT(DISTINCT policy_no) >= ${minDueCount}
    ),
    drilldown_calc AS (
      SELECT
        group_name,
        parent_name,
        level_type,
        due_count,
        renewed_count,
        quoted_count,
        due_premium,
        renewed_premium,
        quoted_premium,
        CASE WHEN due_count = 0 THEN 0
          ELSE renewed_count * 1.0 / due_count
        END AS renewal_rate,
        CASE WHEN due_count = 0 THEN 0
          ELSE quoted_count * 1.0 / due_count
        END AS quote_rate,
        CASE WHEN due_premium = 0 THEN 0
          ELSE renewed_premium * 1.0 / due_premium
        END AS renewal_premium_rate,
        CASE WHEN due_premium = 0 THEN 0
          ELSE quoted_premium * 1.0 / due_premium
        END AS quote_premium_rate,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder}) AS rank_asc,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder === 'asc' ? 'desc' : 'asc'}) AS rank_desc
      FROM drilldown_base
    )
  `;
  } else {
    baseQuery = `
    WITH drilldown_base AS (
      SELECT
        ${groupByField},
        ${additionalFields},
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
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN premium ELSE 0
        END), 0) AS quoted_premium
      FROM PolicyFactRenewal
      WHERE ${whereClause}
      GROUP BY ${groupByClause}
      HAVING COUNT(DISTINCT policy_no) >= ${minDueCount}
    ),
    drilldown_calc AS (
      SELECT
        group_name,
        parent_name,
        level_type,
        due_count,
        renewed_count,
        quoted_count,
        due_premium,
        renewed_premium,
        quoted_premium,
        CASE WHEN due_count = 0 THEN 0
          ELSE renewed_count * 1.0 / due_count
        END AS renewal_rate,
        CASE WHEN due_count = 0 THEN 0
          ELSE quoted_count * 1.0 / due_count
        END AS quote_rate,
        CASE WHEN due_premium = 0 THEN 0
          ELSE renewed_premium * 1.0 / due_premium
        END AS renewal_premium_rate,
        CASE WHEN due_premium = 0 THEN 0
          ELSE quoted_premium * 1.0 / due_premium
        END AS quote_premium_rate,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder}) AS rank_asc,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder === 'asc' ? 'desc' : 'asc'}) AS rank_desc
      FROM drilldown_base
    )
  `;
  }

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

export function generateKPICardQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  const validYear = validateYear(targetYear);
  const whereClause = buildDrilldownWhereClause(filters, dimension, validYear, cutoffDate);

  const needsTeamJoin = !!dimension.filters?.team;
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

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
      SELECT
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
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN premium ELSE 0
        END), 0) AS quoted_premium,
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
        END AS quote_rate,
        CASE WHEN COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END)
        END AS conversion_rate
      FROM renewal_with_team
      WHERE ${whereClause}${teamFilterClause}
    `;
  }

  return `
    SELECT
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
      COALESCE(SUM(CASE
        WHEN ${IS_QUOTE_TRUE_CONDITION}
        THEN premium ELSE 0
      END), 0) AS quoted_premium,
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
      END AS quote_rate,
      CASE WHEN COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END)
      END AS conversion_rate
    FROM PolicyFactRenewal
    WHERE ${whereClause}
  `;
}

export function generateDrilldownNavigationQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  currentLevel: DrilldownLevel,
  parentValue?: string
): string {
  const validYear = validateYear(targetYear);
  const baseYear = validYear - 1;
  const conditions: string[] = [];

  conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);

  let nextLevelField: string;
  switch (currentLevel) {
    case 'company':
      nextLevelField = 'org_level_3';
      break;
    case 'org':
      nextLevelField = 'salesman_name';
      if (parentValue) {
        conditions.push(`org_level_3 = '${escapeSQL(parentValue)}'`);
      }
      break;
    case 'team':
      nextLevelField = 'salesman_name';
      if (parentValue) {
        return `
          SELECT DISTINCT s.salesman_name AS next_level_value
          FROM PolicyFactRenewal r
          LEFT JOIN SalesmanPlanFact s ON r.salesman_name = s.salesman_name
          WHERE YEAR(CAST(r.insurance_start_date AS DATE)) = ${baseYear}
            AND COALESCE(s.team_name, r.org_level_3 || '未归属团队') = '${escapeSQL(parentValue)}'
            AND r.salesman_name IS NOT NULL
            AND TRIM(r.salesman_name) <> ''
          ORDER BY s.salesman_name
        `;
      }
      break;
    case 'salesman':
      nextLevelField = 'coverage_combination';
      if (parentValue) {
        conditions.push(`salesman_name LIKE '%${escapeSQL(parentValue)}%'`);
      }
      break;
    default:
      return 'SELECT NULL AS next_level_value WHERE 1=0';
  }

  const whereClause = conditions.join(' AND ');

  return `
    SELECT DISTINCT ${nextLevelField} AS next_level_value
    FROM PolicyFactRenewal
    WHERE ${whereClause}
      AND ${nextLevelField} IS NOT NULL
      AND TRIM(${nextLevelField}) <> ''
    ORDER BY ${nextLevelField}
  `;
}

export function generateTop20SalesmanQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  const validYear = validateYear(targetYear);
  const whereClause = buildDrilldownWhereClause(filters, dimension, validYear, cutoffDate);

  return `
    WITH salesman_stats AS (
      SELECT
        REGEXP_REPLACE(salesman_name, '^[0-9]+', '') AS salesman_name,
        org_level_3,
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
        END), 0) AS renewed_premium
      FROM PolicyFactRenewal
      WHERE ${whereClause}
      GROUP BY REGEXP_REPLACE(salesman_name, '^[0-9]+', ''), org_level_3
      HAVING COUNT(DISTINCT policy_no) >= 1
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY due_count DESC) AS rank_asc,
      salesman_name AS group_name,
      org_level_3 AS parent_name,
      'salesman' AS level_type,
      due_count,
      renewed_count,
      quoted_count,
      due_premium,
      renewed_premium,
      due_premium AS quoted_premium,
      CASE WHEN due_count = 0 THEN 0 ELSE renewed_count * 1.0 / due_count END AS renewal_rate,
      CASE WHEN due_count = 0 THEN 0 ELSE quoted_count * 1.0 / due_count END AS quote_rate,
      CASE WHEN due_premium = 0 THEN 0 ELSE renewed_premium * 1.0 / due_premium END AS renewal_premium_rate,
      0 AS quote_premium_rate,
      0 AS rank_desc
    FROM salesman_stats
    ORDER BY due_count DESC
    LIMIT 20
  `;
}
