/**
 * 业绩分析 SQL 生成器 — 热力图模块
 *
 * 从 performance-analysis.ts 提取。热力图有独立的维度配置、下钻逻辑和计划匹配，
 * 与核心 5 个生成器无交叉依赖。
 *
 * @see P1#9 架构优化计划
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';
import {
  truthyExpr,
  normalizeSqlTableAliasPrefix,
  getPerformanceSegmentFilter,
  getPlanDenominator,
  type PerformanceSegmentTag,
  type PerformanceTimePeriod,
} from './performance-analysis-shared.js';

// ============================================================================
// 热力图类型定义
// ============================================================================

/**
 * 热力图维度分组类型
 * 支持的常用维度：三级机构、团队、业务员、客户类别、险别组合、能源类型、新转续
 */
export type HeatmapGroupDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'coverage_combination'
  | 'energy_type'
  | 'business_nature'
  | 'insurance_grade';

export const HEATMAP_DIMENSION_LABELS: Record<HeatmapGroupDimension, string> = {
  org_level_3: '三级机构',
  team: '团队',
  salesman: '业务员',
  customer_category: '客户类别',
  coverage_combination: '险别组合',
  energy_type: '能源类型',
  business_nature: '新转续',
  insurance_grade: '风险评分',
};

/** 热力图下钻步骤 */
export interface HeatmapDrillStep {
  dimension: string;
  value: string;
}

const VALID_DRILL_DIMENSIONS = new Set<string>([
  'org_level_3', 'team', 'salesman', 'customer_category',
  'coverage_combination', 'energy_type', 'business_nature', 'insurance_grade',
]);

// ============================================================================
// 热力图辅助函数
// ============================================================================

/**
 * 将下钻步骤转换为 WHERE 条件（用于 PolicyFact 表，有 p. 别名）
 */
function heatmapDrillToWhere(steps: HeatmapDrillStep[]): string {
  if (!steps || steps.length === 0) return '';
  // 过滤无效维度 — 仅允许白名单中的维度参与 WHERE 构造
  const validSteps = steps.filter(s => VALID_DRILL_DIMENSIONS.has(s.dimension));
  if (validSteps.length === 0) return '';
  const clauses = validSteps.map((step) => {
    const v = `'${escapeSqlValue(step.value)}'`;
    switch (step.dimension) {
      case 'org_level_3':
        return `TRIM(CAST(p.org_level_3 AS VARCHAR)) = ${v}`;
      case 'team':
        return `COALESCE(tm.team_name, '未归属团队') = ${v}`;
      case 'salesman':
        return `TRIM(CAST(p.salesman_name AS VARCHAR)) = ${v}`;
      case 'customer_category':
        return `TRIM(CAST(p.customer_category AS VARCHAR)) = ${v}`;
      case 'coverage_combination':
        return `TRIM(CAST(p.coverage_combination AS VARCHAR)) = ${v}`;
      case 'energy_type':
        return step.value === '新能源'
          ? truthyExpr('p.is_nev')
          : `NOT ${truthyExpr('p.is_nev')}`;
      case 'insurance_grade':
        return `COALESCE(p.insurance_grade, 'X') = ${v}`;
      case 'business_nature': {
        const renewalBaseWhere = truthyExpr('p.is_renewal');
        const newCarWhere = truthyExpr('p.is_new_car');
        const transferBaseWhere = truthyExpr('p.is_transfer');
        const renewalWhere = renewalBaseWhere;
        const newBusinessWhere = `NOT ${renewalBaseWhere} AND ${newCarWhere}`;
        const transferBusinessWhere = `NOT ${renewalBaseWhere} AND NOT ${newCarWhere}`;
        const transferInTransferWhere = `${transferBusinessWhere} AND ${transferBaseWhere}`;
        const nonTransferInTransferWhere = `${transferBusinessWhere} AND NOT ${transferBaseWhere}`;
        switch (step.value) {
          case '新保':
          case '新车':
            return newBusinessWhere;
          case '续保':
            return renewalWhere;
          case '转保': return transferBusinessWhere;
          case '过户转保': return transferInTransferWhere;
          case '非过户转保': return nonTransferInTransferWhere;
          default: return 'FALSE';
        }
      }
      default:
        return 'TRUE';
    }
  });
  return clauses.join(' AND ');
}

/**
 * 获取热力图维度的 SQL SELECT 表达式和别名
 */
function getHeatmapGroupByExpr(
  dimension: HeatmapGroupDimension,
  tableAlias = ''
): { selectExpr: string; alias: string; label: string } {
  const prefix = normalizeSqlTableAliasPrefix(tableAlias);
  switch (dimension) {
    case 'team':
      return {
        selectExpr: `COALESCE(tm.team_name, '未归属团队')`,
        alias: 'dimension_value',
        label: '团队',
      };
    case 'salesman':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}salesman_name AS VARCHAR)), ''), '未知业务员')`,
        alias: 'dimension_value',
        label: '业务员',
      };
    case 'customer_category':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}customer_category AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
        label: '客户类别',
      };
    case 'coverage_combination':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}coverage_combination AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
        label: '险别组合',
      };
    case 'energy_type':
      return {
        selectExpr: `CASE WHEN ${truthyExpr(`${prefix}is_nev`)} THEN '新能源' ELSE '燃油' END`,
        alias: 'dimension_value',
        label: '能源类型',
      };
    case 'business_nature':
      return {
        // 四分类：续保 / 新保 / 过户转保 / 非过户转保
        selectExpr: `CASE
          WHEN ${truthyExpr(`${prefix}is_renewal`)} THEN '续保'
          WHEN ${truthyExpr(`${prefix}is_new_car`)} THEN '新保'
          WHEN ${truthyExpr(`${prefix}is_transfer`)} THEN '过户转保'
          ELSE '非过户转保'
        END`,
        alias: 'dimension_value',
        label: '新转续',
      };
    case 'insurance_grade':
      return {
        selectExpr: `COALESCE(${prefix}insurance_grade, 'X')`,
        alias: 'dimension_value',
        label: '风险评分',
      };
    default: // org_level_3
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}org_level_3 AS VARCHAR)), ''), '未知机构')`,
        alias: 'dimension_value',
        label: '三级机构',
      };
  }
}

function heatmapSupportsAnnualPlan(dimension: HeatmapGroupDimension): boolean {
  return dimension === 'org_level_3' || dimension === 'team' || dimension === 'salesman';
}

function getHeatmapPlanDimensionExpr(dimension: HeatmapGroupDimension): string | null {
  switch (dimension) {
    case 'org_level_3':
      return `COALESCE(NULLIF(TRIM(CAST(m.organization AS VARCHAR)), ''), '未知机构')`;
    case 'team':
      return `COALESCE(NULLIF(TRIM(CAST(m.team_name AS VARCHAR)), ''), '未归属团队')`;
    case 'salesman':
      return `COALESCE(NULLIF(TRIM(CAST(m.full_name AS VARCHAR)), ''), '未知业务员')`;
    default:
      return null;
  }
}

function heatmapDrillToMappingWhere(steps: HeatmapDrillStep[]): string {
  if (!steps || steps.length === 0) return '';
  const clauses = steps.flatMap((step) => {
    const v = `'${escapeSqlValue(step.value)}'`;
    switch (step.dimension) {
      case 'org_level_3':
        return [`TRIM(CAST(m.organization AS VARCHAR)) = ${v}`];
      case 'team':
        return [`COALESCE(NULLIF(TRIM(CAST(m.team_name AS VARCHAR)), ''), '未归属团队') = ${v}`];
      case 'salesman':
        return [`TRIM(CAST(m.full_name AS VARCHAR)) = ${v}`];
      default:
        return [];
    }
  });
  return clauses.join(' AND ');
}

// ============================================================================
// 热力图查询生成器
// ============================================================================

export function generatePerformanceOrgHeatmapQuery(
  whereWithoutDate: string,
  segmentTag: PerformanceSegmentTag,
  timePeriod: PerformanceTimePeriod = 'day',
  periods = 15,
  groupByDimension: HeatmapGroupDimension = 'org_level_3',
  drillFilter: HeatmapDrillStep[] = [],
  dateField: string = 'policy_date'
): string {
  const tableAlias = 'p.';
  const segmentFilter = getPerformanceSegmentFilter(segmentTag, tableAlias);
  const safePeriods = Math.max(7, Math.min(31, Math.floor(periods)));
  const dimConfig = getHeatmapGroupByExpr(groupByDimension, tableAlias);
  const supportsAnnualPlan = heatmapSupportsAnnualPlan(groupByDimension);
  const planDimExpr = getHeatmapPlanDimensionExpr(groupByDimension);
  const needsTeamJoin = groupByDimension === 'team' || drillFilter.some((s) => s.dimension === 'team');
  const drillWhereClause = heatmapDrillToWhere(drillFilter);
  const drillAnd = drillWhereClause ? `AND ${drillWhereClause}` : '';
  const mappingDrillWhereClause = supportsAnnualPlan ? heatmapDrillToMappingWhere(drillFilter) : '';
  const mappingDrillAnd = mappingDrillWhereClause ? `AND ${mappingDrillWhereClause}` : '';

  // 根据 timePeriod 动态生成 SQL 片段
  let truncExpr: string;        // 分组键：DATE_TRUNC 或原始日期
  let windowOffset: string;     // 窗口向前偏移量
  let seriesStep: string;       // generate_series 步长
  let momOffset: string;        // 环比偏移
  let yoyOffset: string;        // 同比偏移
  let periodEndExpr: string;    // 当前 period_key 对应的周期结束日
  const planDenom = getPlanDenominator(timePeriod);

  switch (timePeriod) {
    case 'week':
      truncExpr = `DATE_TRUNC('week', pd)::DATE`;
      windowOffset = `${safePeriods - 1} WEEK`;
      seriesStep = 'INTERVAL 1 WEEK';
      momOffset = 'INTERVAL 1 WEEK';
      yoyOffset = 'INTERVAL 1 YEAR';
      periodEndExpr = `pp.period_key + INTERVAL 6 DAY`;
      break;
    case 'month':
      truncExpr = `DATE_TRUNC('month', pd)::DATE`;
      windowOffset = `${safePeriods - 1} MONTH`;
      seriesStep = 'INTERVAL 1 MONTH';
      momOffset = 'INTERVAL 1 MONTH';
      yoyOffset = 'INTERVAL 1 YEAR';
      periodEndExpr = `DATE_TRUNC('month', pp.period_key)::DATE + INTERVAL 1 MONTH - INTERVAL 1 DAY`;
      break;
    case 'quarter':
      truncExpr = `DATE_TRUNC('quarter', pd)::DATE`;
      windowOffset = `${(safePeriods - 1) * 3} MONTH`;
      seriesStep = 'INTERVAL 3 MONTH';
      momOffset = 'INTERVAL 3 MONTH';
      yoyOffset = 'INTERVAL 1 YEAR';
      periodEndExpr = `DATE_TRUNC('quarter', pp.period_key)::DATE + INTERVAL 3 MONTH - INTERVAL 1 DAY`;
      break;
    case 'year':
      truncExpr = `DATE_TRUNC('year', pd)::DATE`;
      windowOffset = `${safePeriods - 1} YEAR`;
      seriesStep = 'INTERVAL 1 YEAR';
      momOffset = 'INTERVAL 1 YEAR';
      yoyOffset = 'INTERVAL 1 YEAR';
      periodEndExpr = `DATE_TRUNC('year', pp.period_key)::DATE + INTERVAL 1 YEAR - INTERVAL 1 DAY`;
      break;
    default: // 'day'
      truncExpr = 'pd';
      windowOffset = `${safePeriods - 1} DAY`;
      seriesStep = 'INTERVAL 1 DAY';
      momOffset = 'INTERVAL 7 DAY';  // 日视图环比=上周同天
      yoyOffset = 'INTERVAL 1 YEAR';
      periodEndExpr = `pp.period_key`;
      break;
  }

  const currentCutoffExpr = `CASE
          WHEN pp.period_key = pb.ref_date THEN LEAST(pb.max_pd, ${periodEndExpr})
          ELSE ${periodEndExpr}
        END`;
  const prevMomCutoffExpr = timePeriod === 'day'
    ? `(${currentCutoffExpr}) - ${momOffset}`
    : `CASE
          WHEN (${currentCutoffExpr}) = ${periodEndExpr} THEN pp.period_key - INTERVAL 1 DAY
          ELSE (${currentCutoffExpr}) - ${momOffset}
        END`;

  const planCtes = supportsAnnualPlan && planDimExpr ? `,
    plan_by_dim AS (
      SELECT
        ${planDimExpr} AS dimension_value,
        ROUND(SUM(COALESCE(m.car_insurance_plan_2026, 0)), 4) AS annual_plan
      FROM SalesmanTeamMapping m
      WHERE 1=1
        ${mappingDrillAnd}
      GROUP BY 1
    ),
    plan_period AS (
      SELECT
        pbd.dimension_value,
        pp.period_key,
        ROUND(pbd.annual_plan / ${planDenom}.0, 4) AS period_plan_wan
      FROM plan_by_dim pbd
      CROSS JOIN period_pool pp
    )` : '';

  const planPremiumSelect = supportsAnnualPlan ? 'ppd.period_plan_wan' : 'NULL::DOUBLE';
  const achievementRateSelect = supportsAnnualPlan
    ? `CASE
        WHEN COALESCE(ppd.period_plan_wan, 0) <= 0 THEN NULL
        WHEN COALESCE(pr.progress_ratio, 0) <= 0 THEN NULL
        WHEN pr.progress_ratio < 1 THEN ROUND(COALESCE(cur.premium, 0) * 100.0 / (ppd.period_plan_wan * pr.progress_ratio), 2)
        ELSE ROUND(COALESCE(cur.premium, 0) * 100.0 / ppd.period_plan_wan, 2)
      END`
    : 'NULL';

  const planJoin = supportsAnnualPlan
    ? `LEFT JOIN plan_period ppd ON ppd.dimension_value = bg.${dimConfig.alias} AND ppd.period_key = bg.period_key`
    : '';

  const sql = `
    WITH filtered AS (
      SELECT
        CAST(p.${dateField} AS DATE) AS pd,
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        COALESCE(NULLIF(TRIM(CAST(p.salesman_name AS VARCHAR)), ''), '__unknown__') AS salesman_name,
        COALESCE(
          NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), '')
        ) AS policy_key,
        NULLIF(TRIM(CAST(p.endorsement_no AS VARCHAR)), '') IS NOT NULL AS is_endorsement,
        COALESCE(p.premium, 0) / 10000.0 AS premium_wan,
        p.commercial_pricing_factor AS cpf
      FROM PolicyFact p
      ${needsTeamJoin ? "LEFT JOIN SalesmanTeamMapping tm ON TRIM(CAST(p.salesman_name AS VARCHAR)) = TRIM(CAST(tm.full_name AS VARCHAR))" : ''}
      WHERE ${whereWithoutDate}
        AND ${segmentFilter}
        ${drillAnd}
    ),
    period_bounds AS (
      SELECT
        MAX(pd) AS max_pd,
        ${timePeriod === 'day' ? 'MAX(pd)' : `DATE_TRUNC('${timePeriod === 'quarter' ? 'quarter' : timePeriod}', MAX(pd))::DATE`} AS ref_date,
        ${timePeriod === 'day' ? 'MAX(pd)' : `DATE_TRUNC('${timePeriod === 'quarter' ? 'quarter' : timePeriod}', MAX(pd))::DATE`} - INTERVAL ${windowOffset} AS start_date
      FROM filtered
    ),
    window_rows AS (
      SELECT f.*, ${truncExpr} AS period_key
      FROM filtered f
      CROSS JOIN period_bounds pb
      WHERE f.pd >= pb.start_date AND f.pd <= pb.ref_date + ${timePeriod === 'day' ? "INTERVAL 0 DAY" : `INTERVAL ${timePeriod === 'quarter' ? '3 MONTH' : '1 ' + timePeriod} - INTERVAL 1 DAY`}
    ),
    dim_period AS (
      SELECT
        wr.${dimConfig.alias},
        wr.period_key,
        ROUND(SUM(wr.premium_wan), 4) AS premium,
        COUNT(DISTINCT CASE WHEN NOT wr.is_endorsement THEN wr.policy_key END) AS policy_count,
        ROUND(
          SUM(CASE WHEN NOT wr.is_endorsement AND wr.cpf IS NOT NULL AND wr.cpf > 0 THEN wr.premium_wan END)
          / NULLIF(SUM(CASE WHEN NOT wr.is_endorsement AND wr.cpf IS NOT NULL AND wr.cpf > 0 THEN wr.premium_wan / wr.cpf END), 0),
        4) AS avg_pricing_coefficient
      FROM window_rows wr
      GROUP BY wr.${dimConfig.alias}, wr.period_key
    ),
    dim_pool AS (
      SELECT DISTINCT ${dimConfig.alias} FROM window_rows
    ),
    period_pool AS (
      SELECT d::DATE AS period_key
      FROM period_bounds pb,
      generate_series(pb.start_date, pb.ref_date, ${seriesStep}) AS t(d)
    ),
    period_window AS (
      SELECT
        pp.period_key,
        ${periodEndExpr} AS period_end,
        ${currentCutoffExpr} AS current_cutoff,
        ${prevMomCutoffExpr} AS prev_mom_cutoff
      FROM period_pool pp
      CROSS JOIN period_bounds pb
    ),
    period_progress AS (
      SELECT
        pp.period_key,
        CAST(DATE_DIFF('day', pp.period_key, pp.period_end) + 1 AS DOUBLE) AS total_days,
        CAST(
          CASE
            WHEN LEAST(CAST(CURRENT_DATE AS DATE), pp.period_end) < pp.period_key THEN 0
            ELSE DATE_DIFF('day', pp.period_key, LEAST(CAST(CURRENT_DATE AS DATE), pp.period_end)) + 1
          END AS DOUBLE
        ) AS elapsed_days,
        CASE
          WHEN DATE_DIFF('day', pp.period_key, pp.period_end) + 1 <= 0 THEN 0
          WHEN LEAST(CAST(CURRENT_DATE AS DATE), pp.period_end) < pp.period_key THEN 0
          ELSE CAST(
            DATE_DIFF('day', pp.period_key, LEAST(CAST(CURRENT_DATE AS DATE), pp.period_end)) + 1
            AS DOUBLE
          ) / CAST(DATE_DIFF('day', pp.period_key, pp.period_end) + 1 AS DOUBLE)
        END AS progress_ratio
      FROM period_window pp
    ),
    base_grid AS (
      SELECT o.${dimConfig.alias}, pp.period_key
      FROM dim_pool o
      CROSS JOIN period_pool pp
    ),
    prev_mom_data AS (
      SELECT pw.period_key, f.${dimConfig.alias}, ROUND(SUM(f.premium_wan), 4) AS premium
      FROM period_window pw
      JOIN filtered f
        ON f.pd >= pw.period_key - ${momOffset}
        AND f.pd <= pw.prev_mom_cutoff
      GROUP BY pw.period_key, f.${dimConfig.alias}
    ),
    prev_yoy_data AS (
      SELECT pw.period_key, f.${dimConfig.alias}, ROUND(SUM(f.premium_wan), 4) AS premium
      FROM period_window pw
      JOIN filtered f
        ON f.pd >= pw.period_key - ${yoyOffset}
        AND f.pd <= pw.current_cutoff - ${yoyOffset}
      GROUP BY pw.period_key, f.${dimConfig.alias}
    )
    ${planCtes}
    SELECT
      bg.${dimConfig.alias} AS org_level_3,
      bg.period_key AS policy_date,
      COALESCE(cur.premium, 0) AS premium,
      ${planPremiumSelect} AS plan_premium,
      COALESCE(prev_mom.premium, 0) AS prev_mom_premium,
      COALESCE(prev_yoy.premium, 0) AS prev_yoy_premium,
      ${achievementRateSelect} AS achievement_rate,
      CASE
        WHEN COALESCE(prev_mom.premium, 0) = 0 THEN NULL
        ELSE ROUND((COALESCE(cur.premium, 0) - prev_mom.premium) * 100.0 / prev_mom.premium, 2)
      END AS mom_growth_rate,
      CASE
        WHEN COALESCE(prev_yoy.premium, 0) = 0 THEN NULL
        ELSE ROUND((COALESCE(cur.premium, 0) - prev_yoy.premium) * 100.0 / prev_yoy.premium, 2)
      END AS yoy_growth_rate,
      COALESCE(cur.policy_count, 0) AS policy_count,
      cur.avg_pricing_coefficient AS avg_pricing_coefficient,
      ROUND(COALESCE(cur.premium, 0) * 100.0 / NULLIF(SUM(COALESCE(cur.premium, 0)) OVER (PARTITION BY bg.period_key), 0), 2) AS premium_share,
      CASE
        WHEN COALESCE(cur.policy_count, 0) = 0 THEN NULL
        ELSE ROUND(COALESCE(cur.premium, 0) / cur.policy_count, 4)
      END AS per_policy_premium
    FROM base_grid bg
    LEFT JOIN dim_period cur ON cur.${dimConfig.alias} = bg.${dimConfig.alias} AND cur.period_key = bg.period_key
    LEFT JOIN period_progress pr ON pr.period_key = bg.period_key
    ${planJoin}
    LEFT JOIN prev_mom_data prev_mom ON prev_mom.${dimConfig.alias} = bg.${dimConfig.alias} AND prev_mom.period_key = bg.period_key
    LEFT JOIN prev_yoy_data prev_yoy ON prev_yoy.${dimConfig.alias} = bg.${dimConfig.alias} AND prev_yoy.period_key = bg.period_key
    ORDER BY bg.${dimConfig.alias}, bg.period_key
  `;

  logger.debug('Generated performance org heatmap SQL', {
    segmentTag,
    timePeriod,
    periods: safePeriods,
    groupByDimension,
    supportsAnnualPlan,
    drillFilterCount: drillFilter.length,
    sqlLength: sql.length,
  });

  return sql;
}
