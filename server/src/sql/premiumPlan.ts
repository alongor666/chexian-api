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
 *
 * @param filters       下钻维度过滤（用户显式传入的 org/team/salesman）
 * @param planYear      计划年度
 * @param rlsOrgName    RLS 强制机构名（来自 req.user.organization，org_user 角色专用）。
 *                      achievement_cache 字段是 org_name，不是 org_level_3，因此不能直接
 *                      注入 permissionFilter 字符串（Binder Error），须在此处单独映射。
 *                      branch_admin：undefined（全量）；org_user：req.user.organization；
 *                      telemarketing_user：undefined（achievement_cache 无 is_telemarketing
 *                      字段，该角色在此层可见全量计划数据；PolicyFact 层另行用 whereClause 限制）。
 */
function buildCacheWhere(
  filters: PlanDrilldownDimension['filters'],
  planYear: number,
  rlsOrgName?: string,
  rlsBranchCode?: string,
): string {
  const conds: string[] = [`plan_year = ${Number(planYear)}`];
  // RLS：org_user 强制限本机构（优先于用户传入的 orgFilter，两者逻辑等价）
  const effectiveOrg = rlsOrgName ?? filters?.org;
  if (effectiveOrg) conds.push(`org_name = '${esc(effectiveOrg)}'`);
  if (filters?.team) conds.push(`team_name = '${esc(filters.team)}'`);
  if (filters?.salesman) conds.push(`full_name = '${esc(filters.salesman)}'`);
  // 分省 RLS（ADR G4 GATED 多省）：achievement_cache 多省时携带 branch_code，路由经
  // resolveBranchRlsCode 双门控解析出 branchCode（flag off / 单省无列 → undefined → 不注入 → 字节安全）。
  if (rlsBranchCode) conds.push(`branch_code = '${esc(rlsBranchCode)}'`);
  return `WHERE ${conds.join(' AND ')}`;
}

/**
 * 聚合公共指标（SUM/CASE）——用于 org/team/company 层级
 * 返回 { select, groupBy } 对，确保非聚合列始终在 GROUP BY 中
 */
function buildAggSelect(
  groupField: string,
  extraFields: string = '',
  extraGroupBy: string = '',
): { select: string; groupBy: string } {
  // extraFields 带别名与尾逗号（用于 SELECT 列表），不能直接进 GROUP BY；
  // GROUP BY 用未加别名的原始列 extraGroupBy。
  const nonAggCols = [groupField, extraGroupBy, 'plan_year'].filter(Boolean);
  const select = `
    ${groupField}                                            AS group_name,
    ${extraFields}
    plan_year,
    SUM(plan_vehicle)                                        AS plan_vehicle,
    SUM(plan_vehicle)                                        AS plan_total,
    SUM(actual_vehicle)                                      AS actual_vehicle,
    0                                                        AS actual_total,
    -- 标准口径（注册表 plan_completion_pct v2.0.0）：年初累计 ÷（年计划 × 时间进度）。
    -- time_progress 由 buildAchievementView 预计算：锚定数据内最新签单日（非自然日
    -- 今天），全年天数闰年感知；缓存表内为单一常量，MAX() 仅作聚合语法需要。
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

function buildSxPremiumPlanCore(
  planYear: number,
  dimension: PlanDrilldownDimension,
  rlsOrgName: string | undefined,
  rlsBranchCode: string | undefined,
  organizationPlanAvailable: boolean,
): string {
  const filters = dimension.filters ?? {};
  const effectiveOrg = rlsOrgName ?? filters.org;
  const where = buildCacheWhere(filters, planYear, rlsOrgName, rlsBranchCode);
  const level = dimension.level;
  const groupExpr = level === 'company'
    ? `'分公司整体'`
    : level === 'org'
      ? 'org_name'
      : level === 'team'
        ? 'team_name'
        : 'full_name';
  const parentSelect = level === 'team'
    ? `org_name AS parent_name, MAX(org_name) AS org_name,`
    : level === 'salesman'
      ? `MAX(team_name) AS parent_name, MAX(org_name) AS org_name,`
      : '';
  const parentGroup = level === 'team' ? ', org_name' : '';
  const supportsOrgPlan = organizationPlanAvailable &&
    (level === 'org' || (level === 'company' && Boolean(effectiveOrg)));
  const planGroupExpr = level === 'company' ? `'分公司整体'` : 'organization';
  const planOrgCondition = effectiveOrg ? `AND organization = '${esc(effectiveOrg)}'` : '';

  return `
    WITH actual_group AS (
      SELECT
        ${groupExpr} AS group_name,
        ${parentSelect}
        plan_year,
        SUM(actual_vehicle) AS actual_vehicle,
        MAX(time_progress) AS time_progress,
        COUNT(DISTINCT full_name) AS salesman_count,
        SUM(prev_year_actual) AS prev_year_premium,
        SUM(prev_year_full) AS year_2025_actual
      FROM achievement_cache
      ${where}
      GROUP BY ${groupExpr}, plan_year${parentGroup}
    ),
    plan_group AS (
      ${supportsOrgPlan
        ? `SELECT ${planGroupExpr} AS group_name, SUM(plan_vehicle) AS plan_vehicle
      FROM PlanFact
      WHERE plan_year = ${Number(planYear)}
        AND level = 'organization'
        AND branch_code = 'SX'
        ${planOrgCondition}
      GROUP BY ${planGroupExpr}`
        : `SELECT NULL::VARCHAR AS group_name, NULL::DOUBLE AS plan_vehicle WHERE FALSE`}
    )
    SELECT
      a.group_name,
      ${level === 'team' || level === 'salesman' ? 'a.parent_name, a.org_name,' : ''}
      a.plan_year,
      p.plan_vehicle,
      p.plan_vehicle AS plan_total,
      a.actual_vehicle,
      a.time_progress AS _time_progress,
      0 AS actual_total,
      CASE
        WHEN p.plan_vehicle > 0 AND a.time_progress > 0
        THEN ROUND(a.actual_vehicle * 100.0 / (p.plan_vehicle * a.time_progress), 2)
        ELSE NULL
      END AS rate_vehicle,
      NULL AS rate_total,
      a.salesman_count,
      a.prev_year_premium,
      CASE WHEN a.prev_year_premium > 0
        THEN ROUND((a.actual_vehicle - a.prev_year_premium) * 100.0 / a.prev_year_premium, 2)
        ELSE NULL
      END AS yoy_growth_rate,
      a.year_2025_actual,
      CASE WHEN p.plan_vehicle IS NOT NULL AND a.year_2025_actual > 0
        THEN ROUND((p.plan_vehicle / a.year_2025_actual - 1) * 100.0, 2)
        ELSE NULL
      END AS plan_growth_rate
    FROM actual_group a
    LEFT JOIN plan_group p ON p.group_name = a.group_name
  `;
}

// ─── 主要导出函数（签名与 v1 完全相同） ────────────────────────────────────

/**
 * 生成保费达成下钻查询
 * 从 achievement_cache 读取，按层级分组（company/org/team/salesman）
 * customer_category / coverage 层级直接查询 PolicyFact
 *
 * @param rlsOrgName    org_user 角色的强制机构名（RLS 注入）；其余角色传 undefined
 * @param policyFactWhereClause  PolicyFact 直查的完整 WHERE 子句（含 permissionFilter）
 */
export function generatePremiumPlanDrilldownQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  ranking: PlanRankingConfig = { enabled: false },
  sortField: PlanSortField = 'plan_vehicle',
  sortOrder: SortOrder = 'desc',
  rlsOrgName?: string,
  policyFactWhereClause?: string,
  rlsBranchCode?: string,
  organizationPlanBranchCode?: string,
  requestBranchCode?: string,
): string {
  const { level, filters = {} } = dimension;
  const where = buildCacheWhere(filters, planYear, rlsOrgName, rlsBranchCode);

  // customer_category / coverage：无计划数据，直接查 PolicyFact
  if (level === 'customer_category' || level === 'coverage') {
    return generatePolicyFactDrilldownQuery(
      planYear, dimension, sortField, sortOrder, policyFactWhereClause,
      requestBranchCode === 'SX' || organizationPlanBranchCode === 'SX'
    );
  }

  if (requestBranchCode === 'SX' || organizationPlanBranchCode === 'SX') {
    const coreSql = buildSxPremiumPlanCore(
      planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode === 'SX'
    );
    if (ranking.enabled && ranking.rankField) {
      const topN = ranking.topN ?? 10;
      const bottomN = ranking.bottomN ?? 10;
      const rankCol = ranking.rankField === 'rate_vehicle' ? 'rate_vehicle' : ranking.rankField;
      return `
        WITH base AS (${coreSql}), ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (ORDER BY ${rankCol} DESC NULLS LAST) AS rank_desc,
            ROW_NUMBER() OVER (ORDER BY ${rankCol} ASC NULLS LAST) AS rank_asc
          FROM base
        )
        SELECT * EXCLUDE (_time_progress), CASE
          WHEN rank_desc <= ${topN} THEN 'top'
          WHEN rank_asc <= ${bottomN} THEN 'bottom'
          ELSE NULL END AS rank_category
        FROM ranked
        WHERE rank_desc <= ${topN} OR rank_asc <= ${bottomN}
        ORDER BY ${sortField} ${sortOrder} NULLS LAST
      `;
    }
    return `SELECT * EXCLUDE (_time_progress) FROM (${coreSql}) ORDER BY ${sortField} ${sortOrder} NULLS LAST`;
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
    const agg = buildAggSelect('team_name', 'org_name AS parent_name,', 'org_name');
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
 *
 * @param rlsOrgName  org_user 角色的强制机构名（RLS 注入）；其余角色传 undefined
 */
export function generateKPICardQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  rlsOrgName?: string,
  rlsBranchCode?: string,
  organizationPlanBranchCode?: string,
  requestBranchCode?: string,
): string {
  if (requestBranchCode === 'SX' || organizationPlanBranchCode === 'SX') {
    const rowsSql = buildSxPremiumPlanCore(
      planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode === 'SX'
    );
    const hasExplicitOrg = Boolean(rlsOrgName ?? dimension.filters?.org);
    const canAggregatePlan = hasExplicitOrg && (dimension.level === 'company' || dimension.level === 'org');
    return `
      WITH rows AS (${rowsSql})
      SELECT
        ${canAggregatePlan ? 'SUM(plan_vehicle)' : 'NULL::DOUBLE'} AS total_plan_vehicle,
        ${canAggregatePlan ? 'SUM(plan_total)' : 'NULL::DOUBLE'} AS total_plan_total,
        SUM(actual_vehicle) AS total_actual_vehicle,
        0 AS total_actual_total,
        ${canAggregatePlan ? `CASE
          WHEN COUNT(plan_vehicle) = COUNT(*) AND SUM(plan_vehicle) > 0 AND MAX(_time_progress) > 0
          THEN ROUND(SUM(actual_vehicle) * 100.0 / (SUM(plan_vehicle) * MAX(_time_progress)), 2)
          ELSE NULL
        END` : 'NULL::DOUBLE'} AS avg_rate_vehicle,
        NULL AS avg_rate_total,
        SUM(salesman_count) AS total_salesman_count
      FROM rows
    `;
  }
  const where = buildCacheWhere(dimension.filters, planYear, rlsOrgName, rlsBranchCode);
  return `
    SELECT
      SUM(plan_vehicle)                                      AS total_plan_vehicle,
      SUM(plan_vehicle)                                      AS total_plan_total,
      SUM(actual_vehicle)                                    AS total_actual_vehicle,
      0                                                      AS total_actual_total,
      -- 标准口径：同 buildAggSelect 的 rate_vehicle（时间进度锚定数据内最新签单日，闰年感知）
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
 *
 * @param rlsOrgName  org_user 角色的强制机构名（RLS 注入）；其余角色传 undefined
 */
export function generateRateDistributionQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  rlsOrgName?: string,
  rlsBranchCode?: string,
  organizationPlanBranchCode?: string,
  requestBranchCode?: string,
): string {
  if (requestBranchCode === 'SX' || organizationPlanBranchCode === 'SX') {
    const rowsSql = buildSxPremiumPlanCore(
      planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode === 'SX'
    );
    return `
      WITH rows AS (${rowsSql})
      SELECT
        CASE
          WHEN rate_vehicle IS NULL THEN '无计划'
          WHEN rate_vehicle < 50 THEN '<50%'
          WHEN rate_vehicle < 80 THEN '50%-80%'
          WHEN rate_vehicle < 100 THEN '80%-100%'
          WHEN rate_vehicle < 120 THEN '100%-120%'
          ELSE '≥120%'
        END AS rate_range,
        COUNT(*) AS count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS percentage
      FROM rows
      GROUP BY rate_range
      ORDER BY CASE rate_range
        WHEN '无计划' THEN 0 WHEN '<50%' THEN 1 WHEN '50%-80%' THEN 2
        WHEN '80%-100%' THEN 3 WHEN '100%-120%' THEN 4 WHEN '≥120%' THEN 5 END
    `;
  }
  const where = buildCacheWhere(dimension.filters, planYear, rlsOrgName, rlsBranchCode);
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
 *
 * @param rlsOrgName             org_user 角色的强制机构名（RLS 注入）；其余角色传 undefined
 * @param policyFactWhereClause  PolicyFact 直查的完整 WHERE 子句（含 permissionFilter）
 */
export function generatePlanAchievementPanel(
  planYear: number,
  dimension: PlanDrilldownDimension,
  sortField: PlanSortField = 'actual_vehicle',
  sortOrder: SortOrder = 'desc',
  rlsOrgName?: string,
  policyFactWhereClause?: string,
  rlsBranchCode?: string,
  organizationPlanBranchCode?: string,
  requestBranchCode?: string,
): { childrenSql: string; summarySql: string; distributionSql: string } {
  return {
    childrenSql: generatePremiumPlanDrilldownQuery(
      planYear, dimension, { enabled: false }, sortField, sortOrder, rlsOrgName, policyFactWhereClause, rlsBranchCode,
      organizationPlanBranchCode,
      requestBranchCode
    ),
    summarySql: generateKPICardQuery(
      planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode, requestBranchCode
    ),
    distributionSql: generateRateDistributionQuery(
      planYear, dimension, rlsOrgName, rlsBranchCode, organizationPlanBranchCode, requestBranchCode
    ),
  };
}

// ─── customer_category / coverage 层级（无计划，直接查 PolicyFact） ──────────

/**
 * @param whereClause  来自 parseFiltersAndBuildWhere(req) 的完整 WHERE 子句（含 permissionFilter）。
 *                     若传入，将追加到 yearWhere 条件中，覆盖 org_level_3/salesman_name/
 *                     is_telemarketing/branch_code 等 RLS 维度，确保不越权。
 *                     若不传（undefined），则保持原有应用层 filters 逻辑（向后兼容）。
 */
function generatePolicyFactDrilldownQuery(
  planYear: number,
  dimension: PlanDrilldownDimension,
  sortField: PlanSortField,
  sortOrder: SortOrder,
  whereClause?: string,
  nullPlan: boolean = false,
): string {
  const filters = dimension.filters ?? {};
  const prevYear = planYear - 1;
  const groupCol =
    dimension.level === 'customer_category' ? 'customer_category' : 'coverage_combination';

  const yearWhere: string[] = [`policy_date >= DATE '${planYear}-01-01'`];
  // RLS：若路由层传入了完整的 whereClause（含 permissionFilter），追加到 yearWhere；
  // 否则降级为应用层 filters（向后兼容）。
  if (whereClause && whereClause !== '1=1') {
    yearWhere.push(whereClause);
  } else {
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
  }
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
      ${nullPlan ? 'NULL::DOUBLE' : '0'}    AS plan_vehicle,
      ${nullPlan ? 'NULL::DOUBLE' : '0'}    AS plan_total,
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
