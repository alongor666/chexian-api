/**
 * 保费达成下钻分析 SQL 生成器 v2
 *
 * 架构升级（v2）：
 * - 所有查询从 achievement_cache 预聚合表读取（启动时预计算）
 * - 粒度：普通业务员 1 行/人；跨机构业务员（organization='未分配'）按 org_level_3 拆分为多行
 * - 人数统计必须用 COUNT(DISTINCT full_name)，不能用 COUNT(*)
 * - 每次下钻只需简单 GROUP BY，无需重新扫描 PolicyFact（10-40x 性能提升）
 * - customer_category / coverage 层级仍直接查询 PolicyFact（无计划数据）
 *
 * 数据来源：
 * - achievement_cache（duckdb.ts buildAchievementView() 预构建）
 *   字段：full_name, salesman_name_short, team_name, org_name, plan_year,
 *         plan_vehicle, actual_vehicle, prev_year_actual, prev_year_full,
 *         time_progress, achievement_rate, yoy_rate, plan_growth_rate
 *
 * 保持向后兼容：
 * - 导出函数签名与 v1 完全相同，query.ts 无需修改
 * - 新增 generatePlanAchievementPanel() 供合并端点 /plan-achievement 使用
 */

import { escapeSqlValue } from '../utils/security.js';

/** 下钻层级 */
export type PlanDrilldownLevel =
  | 'company'
  | 'org'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'coverage';

/** 下钻维度配置 */
export interface PlanDrilldownDimension {
  level: PlanDrilldownLevel;
  parentValue?: string;
  filters?: {
    org?: string;
    team?: string;
    salesman?: string;
    customerCategory?: string;
  };
}

/** 排名配置 */
export interface PlanRankingConfig {
  enabled: boolean;
  rankField?: 'plan_vehicle' | 'actual_vehicle' | 'rate_vehicle';
  topN?: number;
  bottomN?: number;
}

/** 排序字段 */
export type PlanSortField =
  | 'plan_vehicle'
  | 'actual_vehicle'
  | 'rate_vehicle'
  | 'plan_total'
  | 'prev_year_premium'
  | 'yoy_growth_rate'
  | 'year_2025_actual'
  | 'plan_growth_rate';

/** 排序方向 */
export type SortOrder = 'asc' | 'desc';

// ─── 内部工具 ──────────────────────────────────────────────────────────────

const esc = escapeSqlValue;

/**
 * 将 achievement_cache 字段映射到前端期望的输出字段名
 * （保持与 v1 相同的输出 schema，前端无需修改）
 */
const CACHE_SELECT = `
  plan_vehicle,
  plan_vehicle                                               AS plan_total,
  actual_vehicle,
  0                                                          AS actual_total,
  achievement_rate                                           AS rate_vehicle,
  NULL                                                       AS rate_total,
  prev_year_actual                                           AS prev_year_premium,
  yoy_rate                                                   AS yoy_growth_rate,
  prev_year_full                                             AS year_2025_actual,
  plan_growth_rate
`;

/**
 * 根据 level 和 filters 构建 achievement_cache 的 WHERE 子句
 */
function buildCacheWhere(
  filters: PlanDrilldownDimension['filters'],
  planYear: number
): string {
  const conds: string[] = [`plan_year = ${Number(planYear)}`];
  if (filters?.org) conds.push(`org_name = '${esc(filters.org)}'`);
  if (filters?.team) conds.push(`team_name = '${esc(filters.team)}'`);
  if (filters?.salesman) conds.push(`full_name = '${esc(filters.salesman)}'`);
  return `WHERE ${conds.join(' AND ')}`;
}

/**
 * 聚合公共指标（SUM/CASE）——用于 org/team/company 层级
 * 返回 { select, groupBy } 对，确保非聚合列始终在 GROUP BY 中
 */
function buildAggSelect(groupField: string, extraFields: string = ''): { select: string; groupBy: string } {
  const nonAggCols = [groupField, extraFields, 'plan_year'].filter(Boolean);
  const select = `
    ${groupField}                                            AS group_name,
    ${extraFields}
    plan_year,
    SUM(plan_vehicle)                                        AS plan_vehicle,
    SUM(plan_vehicle)                                        AS plan_total,
    SUM(actual_vehicle)                                      AS actual_vehicle,
    0                                                        AS actual_total,
    CASE
      WHEN SUM(plan_vehicle) > 0 AND MAX(time_progress) > 0
      THEN ROUND((SUM(actual_vehicle) / (SUM(plan_vehicle) * MAX(time_progress))) * 100.0, 2)
      ELSE NULL
    END                                                      AS rate_vehicle,
    NULL                                                     AS rate_total,
    COUNT(DISTINCT full_name)                                 AS salesman_count,
    SUM(prev_year_actual)                                    AS prev_year_premium,
    CASE
      WHEN SUM(prev_year_actual) > 0
      THEN ROUND(((SUM(actual_vehicle) - SUM(prev_year_actual)) / SUM(prev_year_actual)) * 100.0, 2)
      ELSE NULL
    END                                                      AS yoy_growth_rate,
    SUM(prev_year_full)                                      AS year_2025_actual,
    CASE
      WHEN SUM(prev_year_full) > 0
      THEN ROUND((SUM(plan_vehicle) / SUM(prev_year_full) - 1) * 100.0, 2)
      ELSE NULL
    END                                                      AS plan_growth_rate
  `;
  return { select, groupBy: `GROUP BY ${nonAggCols.join(', ')}` };
}

// ─── 主要导出函数（签名与 v1 完全相同） ────────────────────────────────────

/**
 * 生成保费达成下钻查询
 * 从 achievement_cache 读取，按层级分组（company/org/team/salesman）
 * customer_category / coverage 层级直接查询 PolicyFact
 */
export function generatePremiumPlanDrilldownQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  ranking: PlanRankingConfig = { enabled: false },
  sortField: PlanSortField = 'plan_vehicle',
  sortOrder: SortOrder = 'desc',
): string {
  const { level, filters = {} } = dimension;
  const where = buildCacheWhere(filters, planYear);

  // customer_category / coverage：无计划数据，直接查 PolicyFact
  if (level === 'customer_category' || level === 'coverage') {
    return generatePolicyFactDrilldownQuery(planYear, dimension, sortField, sortOrder);
  }

  let selectBody: string;
  let groupBy: string;

  if (level === 'company') {
    const agg = buildAggSelect("'分公司整体'");
    selectBody = agg.select;
    groupBy = agg.groupBy;
  } else if (level === 'org') {
    const agg = buildAggSelect('org_name');
    selectBody = agg.select;
    groupBy = agg.groupBy;
  } else if (level === 'team') {
    const agg = buildAggSelect('team_name', 'org_name AS parent_name,');
    selectBody = agg.select;
    groupBy = agg.groupBy;
  } else {
    // salesman — 直接读行，不聚合
    selectBody = `
      full_name                                              AS group_name,
      team_name                                              AS parent_name,
      org_name,
      plan_year,
      ${CACHE_SELECT},
      1                                                      AS salesman_count
    `;
    groupBy = '';
  }

  const coreSql = `
    SELECT ${selectBody}
    FROM achievement_cache
    ${where}
    ${groupBy}
  `;

  // 排名包装
  if (ranking.enabled && ranking.rankField) {
    const topN = ranking.topN ?? 10;
    const bottomN = ranking.bottomN ?? 10;
    const rankCol = ranking.rankField === 'rate_vehicle' ? 'rate_vehicle' : ranking.rankField;
    return `
      WITH base AS (${coreSql}),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (ORDER BY ${rankCol} DESC NULLS LAST) AS rank_desc,
          ROW_NUMBER() OVER (ORDER BY ${rankCol} ASC  NULLS LAST) AS rank_asc
        FROM base
      )
      SELECT *,
        CASE
          WHEN rank_desc <= ${topN}  THEN 'top'
          WHEN rank_asc  <= ${bottomN} THEN 'bottom'
          ELSE NULL
        END AS rank_category
      FROM ranked
      WHERE rank_desc <= ${topN} OR rank_asc <= ${bottomN}
      ORDER BY ${sortField} ${sortOrder} NULLS LAST
    `;
  }

  return `${coreSql} ORDER BY ${sortField} ${sortOrder} NULLS LAST`;
}

/**
 * 生成 KPI 卡片查询（单行汇总）
 */
export function generateKPICardQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
): string {
  const where = buildCacheWhere(dimension.filters, planYear);
  return `
    SELECT
      SUM(plan_vehicle)                                      AS total_plan_vehicle,
      SUM(plan_vehicle)                                      AS total_plan_total,
      SUM(actual_vehicle)                                    AS total_actual_vehicle,
      0                                                      AS total_actual_total,
      CASE
        WHEN SUM(plan_vehicle) > 0 AND MAX(time_progress) > 0
        THEN ROUND((SUM(actual_vehicle) / (SUM(plan_vehicle) * MAX(time_progress))) * 100.0, 2)
        ELSE NULL
      END                                                    AS avg_rate_vehicle,
      NULL                                                   AS avg_rate_total,
      COUNT(DISTINCT full_name)                               AS total_salesman_count
    FROM achievement_cache
    ${where}
  `;
}

/**
 * 生成达成率分布查询（六个区间）
 */
export function generateRateDistributionQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
): string {
  const where = buildCacheWhere(dimension.filters, planYear);
  return `
    SELECT
      CASE
        WHEN achievement_rate IS NULL THEN '无计划'
        WHEN achievement_rate < 50   THEN '<50%'
        WHEN achievement_rate < 80   THEN '50%-80%'
        WHEN achievement_rate < 100   THEN '80%-100%'
        WHEN achievement_rate < 120   THEN '100%-120%'
        ELSE '≥120%'
      END                                                    AS rate_range,
      COUNT(DISTINCT full_name)                               AS count,
      ROUND(COUNT(DISTINCT full_name) * 100.0 / SUM(COUNT(DISTINCT full_name)) OVER (), 2) AS percentage
    FROM achievement_cache
    ${where}
    GROUP BY rate_range
    ORDER BY
      CASE rate_range
        WHEN '无计划'   THEN 0
        WHEN '<50%'     THEN 1
        WHEN '50%-80%'  THEN 2
        WHEN '80%-100%' THEN 3
        WHEN '100%-120%' THEN 4
        WHEN '≥120%'    THEN 5
      END
  `;
}

// ─── 新增：合并端点专用（一次返回 children + summary + distribution） ───────

/**
 * 生成面板所需的三条 SQL（供 /plan-achievement 合并端点并发执行）
 */
export function generatePlanAchievementPanel(
  planYear: number,
  dimension: PlanDrilldownDimension,
  sortField: PlanSortField = 'actual_vehicle',
  sortOrder: SortOrder = 'desc',
): { childrenSql: string; summarySql: string; distributionSql: string } {
  return {
    childrenSql: generatePremiumPlanDrilldownQuery(
      planYear, dimension, { enabled: false }, sortField, sortOrder
    ),
    summarySql: generateKPICardQuery(planYear, dimension),
    distributionSql: generateRateDistributionQuery(planYear, dimension),
  };
}

// ─── customer_category / coverage 层级（无计划，直接查 PolicyFact） ──────────

function generatePolicyFactDrilldownQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  sortField: PlanSortField,
  sortOrder: SortOrder,
): string {
  const filters = dimension.filters ?? {};
  const prevYear = planYear - 1;
  const groupCol =
    dimension.level === 'customer_category' ? 'customer_category' : 'coverage_combination';

  const yearWhere: string[] = [`policy_date >= DATE '${planYear}-01-01'`];
  if (filters.org) yearWhere.push(`org_level_3 = '${esc(filters.org)}'`);
  if (filters.team) {
    yearWhere.push(
      `salesman_name IN (
        SELECT DISTINCT salesman_name
        FROM SalesmanPlanFact
        WHERE team_name = '${esc(filters.team)}'
      )`
    );
  }
  if (filters.salesman) yearWhere.push(`salesman_name = '${esc(filters.salesman)}'`);
  if (filters.customerCategory && dimension.level === 'coverage') {
    yearWhere.push(`customer_category = '${esc(filters.customerCategory)}'`);
  }

  const prevWhere = yearWhere
    .map(c =>
      c.startsWith('policy_date')
        ? `policy_date >= DATE '${prevYear}-01-01' AND policy_date <= (SELECT MAX(policy_date) - INTERVAL 1 YEAR FROM PolicyFact WHERE policy_date >= DATE '${planYear}-01-01')`
        : c,
    )
    .join(' AND ');

  const effectiveSort = sortField === 'plan_vehicle' ? 'actual_vehicle' : sortField;

  return `
    WITH
    curr AS (
      SELECT COALESCE(${groupCol}, '未知') AS group_name,
             SUM(premium) / 10000           AS actual_vehicle
      FROM PolicyFact
      WHERE ${yearWhere.join(' AND ')}
      GROUP BY ${groupCol}
    ),
    prev AS (
      SELECT COALESCE(${groupCol}, '未知') AS group_name,
             SUM(premium) / 10000           AS prev_year_premium
      FROM PolicyFact
      WHERE ${prevWhere}
      GROUP BY ${groupCol}
    )
    SELECT
      c.group_name,
      ${planYear}                           AS plan_year,
      0                                     AS plan_vehicle,
      0                                     AS plan_total,
      c.actual_vehicle,
      0                                     AS actual_total,
      NULL                                  AS rate_vehicle,
      NULL                                  AS rate_total,
      0                                     AS salesman_count,
      COALESCE(p.prev_year_premium, 0)      AS prev_year_premium,
      CASE
        WHEN COALESCE(p.prev_year_premium, 0) > 0
        THEN (c.actual_vehicle - p.prev_year_premium) / p.prev_year_premium
        ELSE NULL
      END                                   AS yoy_growth_rate,
      0                                     AS year_2025_actual,
      NULL                                  AS plan_growth_rate
    FROM curr c
    LEFT JOIN prev p ON c.group_name = p.group_name
    ORDER BY ${effectiveSort} ${sortOrder} NULLS LAST
  `;
}
