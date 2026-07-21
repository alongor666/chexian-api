/**
 * 业绩分析 SQL 生成器 — 共享类型与辅助函数
 *
 * 从 performance-analysis.ts 提取，供核心生成器和热力图模块共用。
 * 原位于 performance-analysis-shared.ts（545行），已移入本子目录。
 *
 * @see P1#9 架构优化计划
 */

import { escapeSqlValue } from '../../utils/security.js';
import { getMetricOrThrow } from '../../config/metric-registry/index.js';

// ============================================================================
// 四象限分界阈值（从指标注册表派生 — 红线：禁止硬编码阈值不从注册表派生）
// ============================================================================

/** 增长分界 = premium_growth_pct.thresholds.notice（良好档，当前 10%；原硬编码 7 不在任何注册表定义内） */
export const QUADRANT_GROWTH_THRESHOLD = getMetricOrThrow('premium_growth_pct').thresholds!.notice;
/** 达成分界 = plan_completion_pct.thresholds.warn（达标线，当前 100%） */
export const QUADRANT_ACHIEVEMENT_THRESHOLD = getMetricOrThrow('plan_completion_pct').thresholds!.warn;

// ============================================================================
// 类型定义
// ============================================================================

export type PerformanceVehicleCategory = 'passenger' | 'business_passenger' | 'truck' | 'motorcycle';
export type PerformanceSegmentTag =
  | 'all'
  | 'non_business_passenger'
  | 'business_passenger'
  | 'business_truck'
  | 'non_business_truck'
  | 'motorcycle'
  // 兼容旧参数
  | 'truck';
export type PerformanceGrowthMode = 'mom' | 'yoy';
export type PerformanceTimePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * 年计划 ÷ 周期数的均分分母。
 *
 * ⚠️ 仅供机构热力图（performance-heatmap.ts）的「周期目标参考」使用——热力图
 * 格子是按周期切片的时序视图，需要把年计划摊到单个周期作对照。
 * 经营分析下钻表/业务员表的达成率已于 2026-06-11 拍板废除均分语义，统一为
 * 标准口径（注册表 plan_completion_pct v2.0.0），禁止在达成率计算中新增本函数的引用。
 */
export function getPlanDenominator(timePeriod: PerformanceTimePeriod): number {
  switch (timePeriod) {
    case 'day': return 365;
    case 'week': return 52;
    case 'month': return 12;
    case 'quarter': return 4;
    case 'year': return 1;
    default: return 365;
  }
}

export type PerformanceTrendGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type PerformanceSummaryExpandDims = 'none' | 'energy' | 'business_nature' | 'energy_business_nature';

export type PerformanceDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'tonnage_segment'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal';

export interface PerformanceDrilldownStep {
  dimension: PerformanceDimension;
  value: string;
}

export interface PerformancePeriodBounds {
  refDate: string;
  currentStart: string;
  currentEnd: string;
  prevStart: string;
  prevEnd: string;
}

export type GroupByConfig = {
  selectExpr: string;
  groupByExpr: string;
};

type ExpandDimensionConfig = {
  labelExpr: string;
  keyExpr: string;
  orderExpr: string;
};

// ============================================================================
// 基础 SQL 表达式构造
// ============================================================================

const BOOL_DIMENSIONS: Record<string, { field: string; trueLabel: string; falseLabel: string }> = {
  is_new_car: { field: 'is_new_car', trueLabel: '新车', falseLabel: '旧车' },
  is_transfer: { field: 'is_transfer', trueLabel: '过户车', falseLabel: '非过户车' },
  is_nev: { field: 'is_nev', trueLabel: '新能源', falseLabel: '非新能源' },
  is_telemarketing: { field: 'is_telemarketing', trueLabel: '电销', falseLabel: '非电销' },
  is_renewal: { field: 'is_renewal', trueLabel: '续保', falseLabel: '非续保' },
};

export function truthyExpr(fieldExpr: string): string {
  return `(
    TRY_CAST(${fieldExpr} AS BOOLEAN) = true
    OR LOWER(TRIM(CAST(${fieldExpr} AS VARCHAR))) IN ('1', 'y', 'yes', 'true', 't', '是')
  )`;
}

export function coverageOrderExpr(expr = 'coverage_combination'): string {
  return `CASE ${expr}
    WHEN '整体' THEN 1
    WHEN '主全' THEN 2
    WHEN '交三' THEN 3
    WHEN '单交' THEN 4
    ELSE 99
  END`;
}

export function mapLegacyVehicleCategoryToSegmentTag(
  category: PerformanceVehicleCategory
): PerformanceSegmentTag {
  switch (category) {
    case 'passenger':
      return 'non_business_passenger';
    case 'business_passenger':
      return 'business_passenger';
    case 'truck':
      return 'truck';
    case 'motorcycle':
      return 'motorcycle';
  }
}

/**
 * 业务车种段标签（segment_tag）物理列引用。
 *
 * B306/F-03：段口径 CASE（8 层 LIKE + CAST/TRIM）原先在每条业绩分析查询里逐行计算；
 * 现于 PolicyFactRealtime 物化时预算为 segment_tag 列（duckdb-materialization.ts 引用
 * 下方 segmentCaseExpr() 作为口径唯一事实源），查询期只做低基数字符串等值比较。
 * 仅适用于 PolicyFact/PolicyFactRealtime 行（其余表无此列）。
 */
export function segmentTagExpr(colPrefix = ''): string {
  return `${colPrefix}segment_tag`;
}

/** 段口径 CASE 表达式（口径 SSOT）——仅供物化层预算 segment_tag 列使用；查询层一律走 segmentTagExpr() */
export function segmentCaseExpr(colPrefix = ''): string {
  const categoryExpr = `COALESCE(TRIM(CAST(${colPrefix}customer_category AS VARCHAR)), '')`;
  return `
    CASE
      WHEN ${categoryExpr} IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')
        THEN 'non_business_passenger'
      WHEN ${categoryExpr} = '营业货车'
        THEN 'business_truck'
      WHEN ${categoryExpr} = '非营业货车'
        THEN 'non_business_truck'
      WHEN ${categoryExpr} = '摩托车'
        THEN 'motorcycle'
      WHEN ${categoryExpr} IN ('营业出租租赁', '营业公路客运', '营业城市公交')
        THEN 'business_passenger'
      WHEN ${categoryExpr} LIKE '%营业%' AND (
        ${categoryExpr} LIKE '%客车%'
        OR ${categoryExpr} LIKE '%出租%'
        OR ${categoryExpr} LIKE '%租赁%'
        OR ${categoryExpr} LIKE '%网约%'
        OR ${categoryExpr} LIKE '%客运%'
        OR ${categoryExpr} LIKE '%公交%'
      )
        THEN 'business_passenger'
      WHEN ${categoryExpr} LIKE '%营业%' AND ${categoryExpr} LIKE '%货车%'
        THEN 'business_truck'
      WHEN ${categoryExpr} LIKE '%货车%'
        THEN 'non_business_truck'
      WHEN ${categoryExpr} LIKE '%非营业%' AND ${categoryExpr} LIKE '%客车%'
        THEN 'non_business_passenger'
      ELSE 'other'
    END
  `;
}

export function getPerformanceSegmentFilter(
  segmentTag: PerformanceSegmentTag,
  colPrefix = ''
): string {
  if (segmentTag === 'all') return '1=1';
  if (segmentTag === 'truck') {
    return `(${segmentTagExpr(colPrefix)} IN ('business_truck', 'non_business_truck'))`;
  }
  return `(${segmentTagExpr(colPrefix)} = '${segmentTag}')`;
}

// 兼容旧逻辑（保留给旧测试/调用方）
export function getPerformanceVehicleCategoryFilter(
  category: PerformanceVehicleCategory,
  colPrefix = ''
): string {
  switch (category) {
    case 'passenger':
      return `${colPrefix}customer_category IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')`;
    case 'business_passenger':
      return `(
        ${colPrefix}customer_category LIKE '%营业%'
        AND (
          ${colPrefix}customer_category LIKE '%客车%'
          OR ${colPrefix}customer_category LIKE '%出租%'
          OR ${colPrefix}customer_category LIKE '%租赁%'
          OR ${colPrefix}customer_category LIKE '%网约%'
          OR ${colPrefix}customer_category LIKE '%客运%'
          OR ${colPrefix}customer_category LIKE '%公交%'
        )
      )`;
    case 'truck':
      return `${colPrefix}customer_category LIKE '%货车%'`;
    case 'motorcycle':
      return `${colPrefix}customer_category = '摩托车'`;
  }
}

// ============================================================================
// 时间周期与 CTE 构造
// ============================================================================

export function getPeriodExpressions(
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode
): { currentStart: string; currentEnd: string; prevStart: string; prevEnd: string } {
  let currentStart = 'ref_date';
  let currentEnd = 'ref_date';

  switch (timePeriod) {
    case 'day':
      break;
    case 'week':
      currentStart = `DATE_TRUNC('week', ref_date)`;
      break;
    case 'month':
      currentStart = `DATE_TRUNC('month', ref_date)`;
      break;
    case 'quarter':
      currentStart = `DATE_TRUNC('quarter', ref_date)`;
      break;
    case 'year':
      currentStart = `DATE_TRUNC('year', ref_date)`;
      break;
  }

  let prevStart: string;
  let prevEnd: string;
  if (growthMode === 'yoy' || timePeriod === 'year') {
    prevStart = `(${currentStart}) - INTERVAL 1 YEAR`;
    prevEnd = `(${currentEnd}) - INTERVAL 1 YEAR`;
  } else {
    // mom like-for-like：current 是「周期初→ref_date」的部分周期，prev 必须截到
    // 与本期相同的周期内天数（prevStart + 已过天数，上限完整上期末），否则
    // 「3 天 vs 整月」会让周期初环比系统性深负。对齐 performance-heatmap 的截断语义。
    const elapsedInterval = `INTERVAL 1 DAY * (ref_date - (${currentStart}))`;
    switch (timePeriod) {
      case 'day':
        prevStart = `(${currentStart}) - INTERVAL 1 DAY`;
        prevEnd = `(${currentEnd}) - INTERVAL 1 DAY`;
        break;
      case 'week':
        prevStart = `(${currentStart}) - INTERVAL 7 DAY`;
        prevEnd = `LEAST(((${currentStart}) - INTERVAL 7 DAY) + ${elapsedInterval}, (${currentStart}) - INTERVAL 1 DAY)`;
        break;
      case 'month':
        prevStart = `(${currentStart}) - INTERVAL 1 MONTH`;
        prevEnd = `LEAST(((${currentStart}) - INTERVAL 1 MONTH) + ${elapsedInterval}, (${currentStart}) - INTERVAL 1 DAY)`;
        break;
      case 'quarter':
        prevStart = `(${currentStart}) - INTERVAL 3 MONTH`;
        prevEnd = `LEAST(((${currentStart}) - INTERVAL 3 MONTH) + ${elapsedInterval}, (${currentStart}) - INTERVAL 1 DAY)`;
        break;
      default:
        prevStart = `(${currentStart}) - INTERVAL 1 YEAR`;
        prevEnd = `(${currentEnd}) - INTERVAL 1 YEAR`;
        break;
    }
  }

  return { currentStart, currentEnd, prevStart, prevEnd };
}

export function buildPeriodBoundsCte(
  whereWithDate: string,
  segmentFilter: string,
  timePeriod: PerformanceTimePeriod,
  growthMode: PerformanceGrowthMode,
  dateField: string = 'policy_date'
): string {
  const { currentStart, currentEnd, prevStart, prevEnd } = getPeriodExpressions(timePeriod, growthMode);
  return `
    reference_date AS (
      SELECT COALESCE(MAX(CAST(${dateField} AS DATE)), CURRENT_DATE) AS ref_date
      FROM PolicyFact
      WHERE ${whereWithDate}
        AND ${segmentFilter}
    ),
    period_bounds AS (
      SELECT
        ref_date,
        CAST(${currentStart} AS DATE) AS current_start,
        CAST(${currentEnd} AS DATE) AS current_end,
        CAST(${prevStart} AS DATE) AS prev_start,
        CAST(${prevEnd} AS DATE) AS prev_end
      FROM reference_date
    )
  `;
}

export function buildStaticPeriodBoundsCte(bounds: PerformancePeriodBounds): string {
  const esc = escapeSqlValue;
  return `
    reference_date AS (
      SELECT CAST('${esc(bounds.refDate)}' AS DATE) AS ref_date
    ),
    period_bounds AS (
      SELECT
        ref_date,
        CAST('${esc(bounds.currentStart)}' AS DATE) AS current_start,
        CAST('${esc(bounds.currentEnd)}' AS DATE) AS current_end,
        CAST('${esc(bounds.prevStart)}' AS DATE) AS prev_start,
        CAST('${esc(bounds.prevEnd)}' AS DATE) AS prev_end
      FROM reference_date
    )
  `;
}

/**
 * 标准口径时间进度 CTE（注册表 plan_completion_pct v2.0.0，B-146cce）
 *
 * 以 period_bounds.current_end（= 筛选范围内数据最新签单日）为锚，给出
 * 「年初 → 窗口末」的累计窗口与时间进度：
 *   - ytd_start      = 窗口末所在年的 1 月 1 日
 *   - ytd_end        = 窗口末（数据内最新签单日，非自然日今天）
 *   - time_progress  = 窗口末是当年第几天 ÷ 全年天数（闰年感知，禁止硬编码 365）
 *
 * 达成率 = 年初累计签单保费 ÷（业务员年计划合计 × time_progress）；
 * 带时间筛选时语义为「年初至筛选末日的累计达成率」。
 * 依赖：必须与 period_bounds CTE 同级出现。
 */
export function buildYtdProgressCte(): string {
  return `
    ytd_bounds AS (
      SELECT
        DATE_TRUNC('year', pb.current_end) AS ytd_start,
        pb.current_end AS ytd_end,
        GREATEST(CAST(EXTRACT('doy' FROM pb.current_end) AS DOUBLE), 1.0)
          / CAST(DATE_DIFF('day',
              DATE_TRUNC('year', pb.current_end),
              DATE_TRUNC('year', pb.current_end) + INTERVAL 1 YEAR
            ) AS DOUBLE) AS time_progress
      FROM period_bounds pb
    )
  `;
}

/** 年计划取数（achievement_cache）的范围参数：与保费看板 /kpi 同源的 org/salesman 全局筛选 */
export interface PerformancePlanScope {
  orgNames?: string[];
  salesmanNames?: string[];
  /** 请求业务省份，用于选择计划事实源；与关系自身的 branch_code 门控分离。 */
  requestBranchCode?: string;
  /** 分省 RLS 码（ADR G4 GATED 多省）：路由经 resolveBranchRlsCode 双门控解析；undefined → 不注入 */
  branchCode?: string;
  /** PlanFact 自身实测可用的分省码；SX 机构计划查询必须提供。 */
  organizationPlanBranchCode?: string;
}

export function isSxOrganizationPlanScope(planScope?: PerformancePlanScope): boolean {
  return planScope?.requestBranchCode === 'SX' && planScope.organizationPlanBranchCode === 'SX';
}

export function buildOrganizationPlanScopeConds(
  planScope: PerformancePlanScope | undefined,
  drillPath: PerformanceDrilldownStep[]
): string[] {
  const conds = [
    `level = 'organization'`,
    `plan_year = CAST(EXTRACT('year' FROM (SELECT ytd_end FROM ytd_bounds LIMIT 1)) AS INTEGER)`,
  ];
  if (planScope?.organizationPlanBranchCode) {
    conds.push(`branch_code = '${escapeSqlValue(planScope.organizationPlanBranchCode)}'`);
  }
  if (planScope?.orgNames && planScope.orgNames.length > 0) {
    conds.push(`organization IN (${planScope.orgNames.map((n) => `'${escapeSqlValue(n)}'`).join(', ')})`);
  }
  for (const step of drillPath) {
    if (step.dimension === 'org_level_3') {
      conds.push(`organization = '${escapeSqlValue(step.value)}'`);
    }
  }
  return conds;
}

/**
 * 构建 achievement_cache 年计划取数的 WHERE 条件（全局 org/salesman 筛选 + 下钻步骤）。
 *
 * 仅 org/team/salesman 三类条件参与计划范围收敛——计划只存在于业务员年度粒度，
 * 车种/能源等其他筛选只影响分子（与保费看板 /kpi 的 buildAchievementCacheWhere 语义一致）。
 */
export function buildPlanScopeConds(
  planScope: PerformancePlanScope | undefined,
  drillPath: PerformanceDrilldownStep[]
): string[] {
  const esc = escapeSqlValue;
  const conds: string[] = [];
  if (planScope?.orgNames && planScope.orgNames.length > 0) {
    conds.push(`org_name IN (${planScope.orgNames.map((n) => `'${esc(n)}'`).join(', ')})`);
  }
  if (planScope?.salesmanNames && planScope.salesmanNames.length > 0) {
    conds.push(`full_name IN (${planScope.salesmanNames.map((n) => `'${esc(n)}'`).join(', ')})`);
  }
  // 分省 RLS（GATED 多省）：achievement_cache 多省时携 branch_code（flag off / 单省无列 → undefined → 不注入）
  if (planScope?.branchCode) {
    conds.push(`branch_code = '${esc(planScope.branchCode)}'`);
  }
  for (const step of drillPath) {
    if (step.dimension === 'org_level_3') {
      conds.push(`org_name = '${esc(step.value)}'`);
    } else if (step.dimension === 'team') {
      conds.push(`team_name = '${esc(step.value)}'`);
    } else if (step.dimension === 'salesman') {
      // 计划侧 full_name=工号+姓名，与下钻传入的带工号 key 对齐
      conds.push(`full_name = '${esc(step.value)}'`);
    }
  }
  return conds;
}

export function trendTimeGroupExpr(granularity: PerformanceTrendGranularity): string {
  switch (granularity) {
    case 'daily':
      return `STRFTIME(pd, '%Y-%m-%d')`;
    case 'weekly':
      return `STRFTIME(DATE_TRUNC('week', pd), '%Y-%m-%d')`;
    case 'monthly':
      return `STRFTIME(DATE_TRUNC('month', pd), '%Y-%m')`;
    case 'quarterly':
      return `CAST(EXTRACT(YEAR FROM pd) AS VARCHAR) || '-Q' || CAST(EXTRACT(QUARTER FROM pd) AS VARCHAR)`;
    case 'yearly':
      return `STRFTIME(DATE_TRUNC('year', pd), '%Y')`;
  }
}

// ============================================================================
// 维度与分组配置
// ============================================================================

export function normalizeSqlTableAliasPrefix(tableAlias = ''): string {
  const normalizedAlias = tableAlias.trim().replace(/\.+$/, '');
  return normalizedAlias ? `${normalizedAlias}.` : '';
}

export function getExpandDimensionConfig(expandDims: PerformanceSummaryExpandDims): ExpandDimensionConfig {
  const energyLabelExpr = `CASE WHEN is_nev_bool THEN '电' ELSE '油' END`;
  const energyKeyExpr = `CASE WHEN is_nev_bool THEN 'electric' ELSE 'oil' END`;
  const energyOrderExpr = `CASE WHEN is_nev_bool THEN 2 ELSE 1 END`;

  const natureLabelExpr = `CASE WHEN is_renewal_bool THEN '续保' WHEN is_new_car_bool THEN '新保' ELSE '转保' END`;
  const natureKeyExpr = `CASE WHEN is_renewal_bool THEN 'renewal' WHEN is_new_car_bool THEN 'new_business' ELSE 'transfer_business' END`;
  const natureOrderExpr = `CASE WHEN is_new_car_bool THEN 1 WHEN is_renewal_bool THEN 3 ELSE 2 END`;

  if (expandDims === 'energy') {
    return {
      labelExpr: energyLabelExpr,
      keyExpr: energyKeyExpr,
      orderExpr: energyOrderExpr,
    };
  }

  if (expandDims === 'business_nature') {
    return {
      labelExpr: natureLabelExpr,
      keyExpr: natureKeyExpr,
      orderExpr: natureOrderExpr,
    };
  }

  return {
    labelExpr: `(${energyLabelExpr}) || '+' || (${natureLabelExpr})`,
    keyExpr: `(${energyKeyExpr}) || '_' || (${natureKeyExpr})`,
    orderExpr: `(CASE WHEN is_nev_bool THEN 3 ELSE 0 END) + (${natureOrderExpr})`,
  };
}

export function drillStepToWhere(step: PerformanceDrilldownStep, colPrefix: string): string {
  const esc = escapeSqlValue;
  const boolDef = BOOL_DIMENSIONS[step.dimension];
  if (boolDef) {
    if (step.value === boolDef.trueLabel) {
      return truthyExpr(`${colPrefix}${boolDef.field}`);
    }
    return `NOT ${truthyExpr(`${colPrefix}${boolDef.field}`)}`;
  }

  switch (step.dimension) {
    case 'org_level_3':
      return `${colPrefix}org_level_3 = '${esc(step.value)}'`;
    case 'team':
      return `COALESCE(tm.team_name, '未归属团队') = '${esc(step.value)}'`;
    case 'salesman':
      // 下钻传带工号 key（group_name=salesman_name），精确匹配单个真人；
      // 勿用去工号短名（会命中同名多人）
      return `COALESCE(${colPrefix}salesman_name, '未知') = '${esc(step.value)}'`;
    case 'customer_category':
      return `COALESCE(${colPrefix}customer_category, '未知') = '${esc(step.value)}'`;
    case 'tonnage_segment':
      return `COALESCE(${colPrefix}tonnage_segment, '未分段') = '${esc(step.value)}'`;
    default:
      return '1=1';
  }
}

export function getGroupByConfig(dimension: PerformanceDimension | null, colPrefix: string): GroupByConfig {
  if (!dimension) {
    return {
      selectExpr: `'分公司整体' AS group_name`,
      groupByExpr: `'分公司整体'`,
    };
  }

  const boolDef = BOOL_DIMENSIONS[dimension];
  if (boolDef) {
    return {
      selectExpr: `CASE WHEN ${truthyExpr(`${colPrefix}${boolDef.field}`)} THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END AS group_name`,
      groupByExpr: `CASE WHEN ${truthyExpr(`${colPrefix}${boolDef.field}`)} THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END`,
    };
  }

  switch (dimension) {
    case 'org_level_3':
      return {
        selectExpr: `COALESCE(${colPrefix}org_level_3, '未知') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}org_level_3, '未知')`,
      };
    case 'team':
      return {
        selectExpr: `COALESCE(tm.team_name, '未归属团队') AS group_name`,
        groupByExpr: `COALESCE(tm.team_name, '未归属团队')`,
      };
    case 'salesman':
      // 聚合键必须用带工号全名（salesman_name=工号+姓名=人唯一键），禁去工号——
      // 否则同名不同工号的真人被合并（张丽×3 等）。短名仅用于展示层 display_name。
      return {
        selectExpr: `COALESCE(${colPrefix}salesman_name, '未知') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}salesman_name, '未知')`,
      };
    case 'customer_category':
      return {
        selectExpr: `COALESCE(${colPrefix}customer_category, '未知') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}customer_category, '未知')`,
      };
    case 'tonnage_segment':
      return {
        selectExpr: `COALESCE(${colPrefix}tonnage_segment, '未分段') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}tonnage_segment, '未分段')`,
      };
    default:
      return {
        selectExpr: `'分公司整体' AS group_name`,
        groupByExpr: `'分公司整体'`,
      };
  }
}

export function supportsAnnualPlanByDimension(dimension: PerformanceDimension | null): boolean {
  return (
    dimension === null
    || dimension === 'org_level_3'
    || dimension === 'team'
    || dimension === 'salesman'
  );
}

export function getTrendLineSourceSql(segmentTag: PerformanceSegmentTag): string {
  if (segmentTag === 'all') {
    return `
      SELECT 'overall' AS line_key, '整体' AS line_label, 1 AS line_order, pd, policy_key, is_endorsement, premium_wan FROM selected_rows
      UNION ALL
      SELECT 'non_business_passenger', '非营客', 2, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE segment_tag = 'non_business_passenger'
      UNION ALL
      SELECT 'business_passenger', '营客', 3, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE segment_tag = 'business_passenger'
      UNION ALL
      SELECT 'business_truck', '营货', 4, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE segment_tag = 'business_truck'
      UNION ALL
      SELECT 'non_business_truck', '非营货', 5, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE segment_tag = 'non_business_truck'
      UNION ALL
      SELECT 'motorcycle', '摩托车', 6, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE segment_tag = 'motorcycle'
    `;
  }

  if (segmentTag === 'non_business_passenger') {
    return `
      SELECT 'overall' AS line_key, '非营客整体' AS line_label, 1 AS line_order, pd, policy_key, is_endorsement, premium_wan FROM selected_rows
      UNION ALL
      SELECT 'non_business_personal', '非营业个人客车', 2, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE customer_category = '非营业个人客车'
      UNION ALL
      SELECT 'non_business_enterprise', '非营业企业客车', 3, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE customer_category = '非营业企业客车'
      UNION ALL
      SELECT 'non_business_agency', '非营业机关客车', 4, pd, policy_key, is_endorsement, premium_wan FROM selected_rows WHERE customer_category = '非营业机关客车'
    `;
  }

  if (segmentTag === 'business_truck' || segmentTag === 'non_business_truck' || segmentTag === 'truck') {
    return `
      SELECT 'overall' AS line_key, '整体' AS line_label, 1 AS line_order, pd, policy_key, is_endorsement, premium_wan FROM selected_rows
      UNION ALL
      SELECT
        'tonnage_' || REPLACE(REPLACE(norm_tonnage, '-', '_'), '吨', '') AS line_key,
        norm_tonnage AS line_label,
        1 + CASE norm_tonnage
          WHEN '1吨以下' THEN 1
          WHEN '1-2吨' THEN 2
          WHEN '2-9吨' THEN 3
          WHEN '9-10吨' THEN 4
          WHEN '10吨以上' THEN 5
          ELSE 99
        END AS line_order,
        pd,
        policy_key,
        is_endorsement,
        premium_wan
      FROM selected_rows
    `;
  }

  return `
    SELECT 'overall' AS line_key, '整体' AS line_label, 1 AS line_order, pd, policy_key, is_endorsement, premium_wan FROM selected_rows
  `;
}
