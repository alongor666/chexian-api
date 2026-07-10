/**
 * 业绩分析 SQL 生成器 — Top 业务员查询
 *
 * 包含：
 * - generatePerformanceTopSalesmanQuery() — 按保费排名的 Top N 业务员查询
 *
 * 达成率口径（2026-06-11 拍板，注册表 plan_completion_pct v2.0.0）：
 *   达成率 = 该业务员年初累计签单保费 ÷（其年计划 × 时间进度）
 *   - 时间进度锚定筛选范围内数据最新签单日，全年天数闰年感知
 *   - 年计划取自 achievement_cache（与保费看板、报告中心同源），
 *     废除旧「按当期保费占比分摊年计划再 ÷ 周期数」的均分语义
 */

import { logger } from '../../utils/logger.js';
import { buildSalesmanDimCte } from '../stripped-dim-cte.js';
import {
  QUADRANT_GROWTH_THRESHOLD,
  QUADRANT_ACHIEVEMENT_THRESHOLD,
  truthyExpr,
  getPerformanceSegmentFilter,
  buildPeriodBoundsCte,
  buildStaticPeriodBoundsCte,
  buildYtdProgressCte,
  buildPlanScopeConds,
  type PerformanceSegmentTag,
  type PerformanceTimePeriod,
  type PerformanceGrowthMode,
  type PerformancePeriodBounds,
  type PerformancePlanScope,
} from './shared.js';

export function generatePerformanceTopSalesmanQuery(
  whereWithDate: string,
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  limit = 20,
  periodBoundsOverride?: PerformancePeriodBounds,
  dateField: string = 'policy_date',
  planScope?: PerformancePlanScope,
  rlsBranchCode?: string
): string {
  const segmentFilterNoAlias = getPerformanceSegmentFilter(segmentTag);
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, 'p.');
  const periodBounds = periodBoundsOverride
    ? buildStaticPeriodBoundsCte(periodBoundsOverride)
    : buildPeriodBoundsCte(whereWithDate, segmentFilterNoAlias, timePeriod, growthMode, dateField);
  const ytdProgress = buildYtdProgressCte();

  // 年计划取数范围：全局 org/salesman 筛选（计划只懂机构/团队/业务员归属）
  const planConds = buildPlanScopeConds(planScope, []);
  const planWhere = planConds.length > 0 ? `WHERE ${planConds.join(' AND ')}` : '';

  const sql = `
    WITH
    ${periodBounds},
    ${ytdProgress},
    all_rows AS (
      SELECT
        COALESCE(p.salesman_name, '未知') AS dimension_name, -- 聚合键带工号（=人唯一键），禁去工号防同名真人合并
        CAST(p.${dateField} AS DATE) AS pd,
        p.salesman_name,
        COALESCE(p.org_level_3, '未知机构') AS org_level_3, -- 供 display_name 同名冲突时加机构后缀
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
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
        AND p.salesman_name IS NOT NULL
        AND TRIM(p.salesman_name) != ''
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
      SELECT dimension_name, SUM(premium_wan) AS ytd_premium
      FROM ytd_rows
      GROUP BY dimension_name
    ),
    -- 年计划（业务员粒度）：achievement_cache 按带工号 full_name 聚合，与行分组键 dimension_name(=salesman_name 带工号) 对齐
    plan_group AS (
      SELECT full_name AS dimension_name, SUM(plan_vehicle) AS annual_plan -- 带工号，对齐 dimension_name=salesman_name（带工号）
      FROM achievement_cache
      ${planWhere}
      GROUP BY full_name
    ),
    -- 归属机构剥列 CTE：SalesmanDim 多省同带 branch_code，同名业务员跨省各一行 → 裸 JOIN 会让
    -- current_group 的单省业务员行按机构翻倍（同名在排名里出现两次/premium 重复）。按省过滤根治。
    ${buildSalesmanDimCte(rlsBranchCode)},
    current_group AS (
      SELECT
        dimension_name,
        MAX(org_level_3) AS org_level_3,
        SUM(premium_wan) AS premium,
        COUNT(DISTINCT CASE WHEN NOT is_endorsement THEN policy_key END) AS auto_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND is_nev THEN policy_key END) AS nev_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND is_renewal THEN policy_key END) AS renewal_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND (NOT is_new_car) AND (NOT is_renewal) THEN policy_key END) AS transfer_business_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND (NOT is_renewal) AND is_new_car THEN policy_key END) AS new_car_count,
        COUNT(DISTINCT CASE WHEN (NOT is_endorsement) AND (NOT is_new_car) AND (NOT is_renewal) AND is_transfer THEN policy_key END) AS transfer_count
      FROM current_rows cr
      GROUP BY dimension_name
    ),
    prev_group AS (
      SELECT
        dimension_name,
        SUM(premium_wan) AS prev_premium
      FROM prev_rows
      GROUP BY dimension_name
    ),
    metrics AS (
      SELECT
        c.dimension_name,
        -- 归属机构：优先取 SalesmanDim.organization（维度表归属机构），兜底事实表 org_level_3
        -- 防跨机构出单人员取到非归属的出单机构作为 display_name 后缀（PR #832 follow-up）
        COALESCE(sd.organization, c.org_level_3, '未知机构') AS org_level_3,
        ROUND(c.premium, 4) AS premium,
        c.auto_count,
        ROUND(COALESCE(y.ytd_premium, 0), 4) AS ytd_premium,
        yb.time_progress AS time_progress,
        ROUND(pl.annual_plan, 4) AS plan_premium,
        CASE
          WHEN COALESCE(pl.annual_plan, 0) <= 0 THEN NULL
          WHEN yb.time_progress <= 0 THEN NULL
          ELSE ROUND(
            (COALESCE(y.ytd_premium, 0) * 100.0) / (pl.annual_plan * yb.time_progress),
            2
          )
        END AS achievement_rate,
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
      LEFT JOIN salesman_dim sd ON c.dimension_name = sd.full_name
      LEFT JOIN prev_group p ON c.dimension_name = p.dimension_name
      LEFT JOIN ytd_group y ON c.dimension_name = y.dimension_name
      LEFT JOIN plan_group pl ON c.dimension_name = pl.dimension_name
      CROSS JOIN ytd_bounds yb
    )
    SELECT
      m.*,
      -- 两级判重：短名唯一→短名；同短名跨机构→短名·机构；同机构同名→短名·机构#工号（绝对区分，实测张雷·长治等 5 组同机构同名）
      CASE
        WHEN m.dimension_name ILIKE 'admin%' THEN '直接个代'
        WHEN COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(m.dimension_name, '^[0-9]+', '')) = 1
          THEN REGEXP_REPLACE(m.dimension_name, '^[0-9]+', '')
        WHEN COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(m.dimension_name, '^[0-9]+', ''), m.org_level_3) = 1
          THEN REGEXP_REPLACE(m.dimension_name, '^[0-9]+', '') || '·' || COALESCE(m.org_level_3, '未知机构')
        ELSE REGEXP_REPLACE(m.dimension_name, '^[0-9]+', '') || '·' || COALESCE(m.org_level_3, '未知机构') || '#' || REGEXP_EXTRACT(m.dimension_name, '^[0-9]+')
      END AS display_name,
      CASE
        WHEN m.achievement_rate IS NULL OR m.growth_rate IS NULL THEN 'unknown'
        WHEN m.growth_rate >= ${QUADRANT_GROWTH_THRESHOLD} AND m.achievement_rate >= ${QUADRANT_ACHIEVEMENT_THRESHOLD} THEN 'high_growth_high_achievement'
        WHEN m.growth_rate >= ${QUADRANT_GROWTH_THRESHOLD} AND m.achievement_rate < ${QUADRANT_ACHIEVEMENT_THRESHOLD} THEN 'high_growth_low_achievement'
        WHEN m.growth_rate < ${QUADRANT_GROWTH_THRESHOLD} AND m.achievement_rate >= ${QUADRANT_ACHIEVEMENT_THRESHOLD} THEN 'low_growth_high_achievement'
        ELSE 'low_growth_low_achievement'
      END AS quadrant
    FROM metrics m
    ORDER BY m.achievement_rate ASC NULLS LAST, m.premium DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `;

  logger.debug('Generated performance top-salesman SQL', {
    segmentTag,
    timePeriod,
    growthMode,
    limit,
    sqlLength: sql.length,
  });
  return sql;
}
