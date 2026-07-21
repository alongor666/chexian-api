/**
 * 业绩分析 SQL 生成器 — 下钻查询
 *
 * 包含：
 * - generatePerformanceDrilldownQuery() — 按维度下钻的业绩查询（支持多级钻路径）
 *
 * 达成率口径（2026-06-11 拍板，注册表 plan_completion_pct v2.0.0）：
 *   达成率 = 年初累计签单保费 ÷（业务员年计划合计 × 时间进度）
 *   - 时间进度锚定筛选范围内数据最新签单日（非自然日今天），全年天数闰年感知
 *   - 年计划按 achievement_cache 的机构/团队/业务员归属聚合（与保费看板、
 *     报告中心同源），废除旧「按当期保费占比分摊年计划再 ÷ 周期数」的均分语义
 *   - 带时间筛选时语义为「年初至筛选末日的累计达成率」
 */

import { logger } from '../../utils/logger.js';
import { buildTeamMappingCte } from '../stripped-dim-cte.js';
import {
  QUADRANT_GROWTH_THRESHOLD,
  QUADRANT_ACHIEVEMENT_THRESHOLD,
  truthyExpr,
  getPerformanceSegmentFilter,
  buildPeriodBoundsCte,
  buildStaticPeriodBoundsCte,
  buildYtdProgressCte,
  buildPlanScopeConds,
  buildOrganizationPlanScopeConds,
  isSxOrganizationPlanScope,
  isSxPlanRequest,
  drillStepToWhere,
  getGroupByConfig,
  supportsAnnualPlanByDimension,
  type PerformanceSegmentTag,
  type PerformanceTimePeriod,
  type PerformanceGrowthMode,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
  type PerformancePeriodBounds,
  type PerformancePlanScope,
} from './shared.js';

/** 把 groupBy 维度映射到 achievement_cache 的年计划分组列（仅计划支持的维度） */
function planGroupExpr(groupBy: PerformanceDimension | null): string {
  switch (groupBy) {
    case 'org_level_3': return 'org_name';
    case 'team': return 'team_name';
    case 'salesman': return 'full_name'; // 带工号，对齐 group_name=salesman_name（带工号），勿用去工号短名
    default: return `'分公司整体'`;
  }
}

export function generatePerformanceDrilldownQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  drillPath: PerformanceDrilldownStep[] = [],
  groupBy: PerformanceDimension | null = null,
  periodBoundsOverride?: PerformancePeriodBounds,
  dateField: string = 'policy_date',
  planScope?: PerformancePlanScope,
  rlsBranchCode?: string
): string {
  const segmentFilterNoAlias = getPerformanceSegmentFilter(segmentTag);
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, 'p.');
  // all_rows 恒 JOIN team_mapping（剥列 CTE：只投影 full_name+team_name，不含 branch_code）——
  // WHERE 里 permissionFilter 的裸 branch_code 天然只解析到事实表 p.，无二义。
  // （2026-07-09 生产 Binder Error 结构层根治，替代 qualifyBranchCodeColumn；数字与现网一致——CTE 不去重、不按省过滤）
  const periodBounds = periodBoundsOverride
    ? buildStaticPeriodBoundsCte(periodBoundsOverride)
    : buildPeriodBoundsCte(whereWithDate, segmentFilterNoAlias, timePeriod, growthMode, dateField);
  const ytdProgress = buildYtdProgressCte();
  const groupCfg = getGroupByConfig(groupBy, 'p.');
  const isSxRequest = isSxPlanRequest(planScope);
  const canUseSxOrganizationPlan = isSxOrganizationPlanScope(planScope);
  const hasSxUnsupportedDrill = Boolean(
    planScope?.salesmanNames?.length || drillPath.some((step) => step.dimension === 'team' || step.dimension === 'salesman')
  );
  const hasAnnualPlan = isSxRequest
    ? canUseSxOrganizationPlan && groupBy === 'org_level_3' && !hasSxUnsupportedDrill
    : supportsAnnualPlanByDimension(groupBy);

  const stepWheres = drillPath.map((step) => drillStepToWhere(step, 'p.'));
  const drillWhere = stepWheres.length > 0 ? `AND ${stepWheres.join('\n        AND ')}` : '';

  // 年计划取数范围：全局 org/salesman 筛选 + 下钻步骤（计划只懂机构/团队/业务员）
  const planConds = buildPlanScopeConds(planScope, drillPath);
  const planWhere = planConds.length > 0 ? `WHERE ${planConds.join(' AND ')}` : '';
  const organizationPlanWhere = `WHERE ${buildOrganizationPlanScopeConds(planScope, drillPath).join(' AND ')}`;

  // Phase 2b: 业务员层下钻附带 org_level_3 + team_name 元数据列，
  // 供前端按团队折叠/展开（团队与业务员合并为同一下钻层）
  const includeHierarchy = groupBy === 'salesman';
  const hierarchySelect = includeHierarchy
    ? `p.org_level_3 AS org_level_3,
        COALESCE(tm.team_name, '未归属团队') AS team_name,`
    : '';
  const hierarchyAgg = includeHierarchy
    ? `MAX(cr.org_level_3) AS org_level_3,
        MAX(cr.team_name) AS team_name,`
    : '';
  const hierarchyProject = includeHierarchy
    ? `c.org_level_3,
        c.team_name,`
    : '';

  // 计划相关列：仅 company/org/team/salesman 维度有年计划，其余维度恒 NULL
  const planJoin = hasAnnualPlan
    ? `LEFT JOIN plan_group pl ON c.group_name = pl.group_name`
    : '';
  const planCtes = hasAnnualPlan
    ? `,
    plan_group AS (
      SELECT
        ${isSxRequest ? 'organization' : planGroupExpr(groupBy)} AS group_name,
        SUM(plan_vehicle) AS annual_plan
      FROM ${isSxRequest ? 'PlanFact' : 'achievement_cache'}
      ${isSxRequest ? organizationPlanWhere : planWhere}
      GROUP BY ${isSxRequest ? 'organization' : planGroupExpr(groupBy)}
    )`
    : '';
  const planPremiumExpr = hasAnnualPlan ? 'ROUND(pl.annual_plan, 4)' : 'NULL';
  const achievementExpr = hasAnnualPlan
    ? `CASE
          WHEN COALESCE(pl.annual_plan, 0) <= 0 THEN NULL
          WHEN yb.time_progress <= 0 THEN NULL
          ELSE ROUND(
            (COALESCE(y.ytd_premium, 0) * 100.0) / (pl.annual_plan * yb.time_progress),
            2
          )
        END`
    : 'NULL';

  // display_name：salesman 维度用短名（去工号），仅去工号后同名冲突时加机构后缀区分真人；
  // 其他维度 group_name 本身即显示名。group_name 始终保留带工号原值供下钻精确传参（UI 显示用 display_name）。
  // 两级判重：短名唯一→短名；同短名跨机构→短名·机构；同机构同名→短名·机构#工号（绝对区分）
  const displayExpr = groupBy === 'salesman'
    ? `CASE
            WHEN m.group_name ILIKE 'admin%' THEN '直接个代'
            WHEN COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(m.group_name, '^[0-9]+', '')) = 1
              THEN REGEXP_REPLACE(m.group_name, '^[0-9]+', '')
            WHEN COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(m.group_name, '^[0-9]+', ''), m.org_level_3) = 1
              THEN REGEXP_REPLACE(m.group_name, '^[0-9]+', '') || '·' || COALESCE(m.org_level_3, '未知机构')
            ELSE REGEXP_REPLACE(m.group_name, '^[0-9]+', '') || '·' || COALESCE(m.org_level_3, '未知机构') || '#' || REGEXP_EXTRACT(m.group_name, '^[0-9]+')
          END`
    : `m.group_name`;

  const sql = `
    WITH
    ${periodBounds},
    ${ytdProgress},
    ${buildTeamMappingCte(rlsBranchCode)},
    all_rows AS (
      SELECT
        ${groupCfg.selectExpr},
        ${hierarchySelect}
        CAST(p.${dateField} AS DATE) AS pd,
        p.salesman_name,
        COALESCE(
          NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), '')
        ) AS policy_key,
        NULLIF(TRIM(CAST(p.endorsement_no AS VARCHAR)), '') IS NOT NULL AS is_endorsement,
        COALESCE(p.premium, 0) / 10000.0 AS premium_wan,
        CASE WHEN ${truthyExpr('p.is_nev')} THEN true ELSE false END AS is_nev,
        CASE WHEN ${truthyExpr('p.is_renewal')} THEN true ELSE false END AS is_renewal,
        CASE WHEN ${truthyExpr('p.is_new_car')} THEN true ELSE false END AS is_new_car,
        CASE WHEN ${truthyExpr('p.is_transfer')} THEN true ELSE false END AS is_transfer
      FROM PolicyFact p
      LEFT JOIN team_mapping tm ON p.salesman_name = tm.full_name
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
        ${drillWhere}
    ),
    current_rows AS (
      SELECT r.*
      FROM all_rows r
      CROSS JOIN period_bounds pb
      WHERE r.pd >= pb.current_start AND r.pd <= pb.current_end
    ),
    prev_rows AS (
      SELECT r.*
      FROM all_rows r
      CROSS JOIN period_bounds pb
      WHERE r.pd >= pb.prev_start AND r.pd <= pb.prev_end
    ),
    -- 达成率分子：年初 → 窗口末 的累计签单保费（标准口径，与保费看板 /kpi 同语义）
    ytd_rows AS (
      SELECT r.*
      FROM all_rows r
      CROSS JOIN ytd_bounds yb
      WHERE r.pd >= yb.ytd_start AND r.pd <= yb.ytd_end
    ),
    ytd_group AS (
      SELECT group_name, SUM(premium_wan) AS ytd_premium
      FROM ytd_rows
      GROUP BY group_name
    ),
    current_group AS (
      SELECT
        group_name,
        ${hierarchyAgg}
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT CASE WHEN NOT is_endorsement THEN policy_key END) AS auto_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND is_nev THEN policy_key END) AS nev_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND is_renewal THEN policy_key END) AS renewal_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND (NOT is_new_car) AND (NOT is_renewal) THEN policy_key END) AS transfer_business_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND (NOT is_renewal) AND is_new_car THEN policy_key END) AS new_car_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND (NOT is_new_car) AND (NOT is_renewal) AND is_transfer THEN policy_key END) AS transfer_count
      FROM current_rows cr
      GROUP BY group_name
    ),
    prev_group AS (
      SELECT
        group_name,
        SUM(premium_wan) AS prev_premium
      FROM prev_rows
      GROUP BY group_name
    )${planCtes},
    metrics AS (
      SELECT
        c.group_name,
        ${hierarchyProject}
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        ROUND(COALESCE(y.ytd_premium, 0), 4) AS ytd_premium,
        yb.time_progress AS time_progress,
        ${planPremiumExpr} AS plan_premium,
        ${achievementExpr} AS achievement_rate,
        CASE
          -- prev<=0（批改冲减可为负）除负数会让增长率符号反转，统一对齐注册表 growth.ts：仅 prev>0 计算
          WHEN COALESCE(p.prev_premium, 0) <= 0 THEN NULL
          ELSE ROUND((c.premium - p.prev_premium) * 100.0 / p.prev_premium, 2)
        END AS growth_rate,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.nev_count * 100.0 / c.auto_count, 2) END AS nev_rate,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.renewal_count * 100.0 / c.auto_count, 2) END AS renewal_rate,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.transfer_business_count * 100.0 / c.auto_count, 2) END AS transfer_business_rate,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.new_car_count * 100.0 / c.auto_count, 2) END AS new_car_rate,
        CASE WHEN c.auto_count = 0 THEN 0 ELSE ROUND(c.transfer_count * 100.0 / c.auto_count, 2) END AS transfer_rate
      FROM current_group c
      LEFT JOIN prev_group p ON c.group_name = p.group_name
      LEFT JOIN ytd_group y ON c.group_name = y.group_name
      ${planJoin}
      CROSS JOIN ytd_bounds yb
    )
    SELECT
      m.*,
      ${displayExpr} AS display_name,
      CASE
        WHEN m.achievement_rate IS NULL OR m.growth_rate IS NULL THEN 'unknown'
        WHEN m.growth_rate >= ${QUADRANT_GROWTH_THRESHOLD} AND m.achievement_rate >= ${QUADRANT_ACHIEVEMENT_THRESHOLD} THEN 'high_growth_high_achievement'
        WHEN m.growth_rate >= ${QUADRANT_GROWTH_THRESHOLD} AND m.achievement_rate < ${QUADRANT_ACHIEVEMENT_THRESHOLD} THEN 'high_growth_low_achievement'
        WHEN m.growth_rate < ${QUADRANT_GROWTH_THRESHOLD} AND m.achievement_rate >= ${QUADRANT_ACHIEVEMENT_THRESHOLD} THEN 'low_growth_high_achievement'
        ELSE 'low_growth_low_achievement'
      END AS quadrant
    FROM metrics m
    ORDER BY m.premium DESC
  `;

  logger.debug('Generated performance drilldown SQL', {
    segmentTag,
    timePeriod,
    growthMode,
    groupBy,
    drillDepth: drillPath.length,
    sqlLength: sql.length,
  });
  return sql;
}
