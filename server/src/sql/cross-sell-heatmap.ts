/**
 * 交叉销售热力图 SQL 生成器
 * Cross-Sell Heatmap SQL Generator
 *
 * 按时间粒度（日/周/月/季）+三级机构分组，返回最近14个时段的数据
 * 支持推介率、件均保费、计划达成率
 * 颜色映射：优秀(绿)/健康(蓝)/异常(橙)/危险(红)
 */

import { logger } from '../utils/logger.js';
import { getVehicleCategoryFilter, type VehicleCategory, crossSellTruthyExpr } from './cross-sell/shared.js';
import { buildTeamMappingCte } from './stripped-dim-cte.js';
import { escapeSqlValue } from '../utils/security.js';

export interface CrossSellHeatmapDrillStep {
  dimension: CrossSellHeatmapGroupDimension;
  value: string;
}

/** 生成 CrossSellDailyAgg 的 drillFilter WHERE 子句（无表前缀） */
function crossSellDrillToWhereAgg(steps: CrossSellHeatmapDrillStep[]): string {
  if (!steps || steps.length === 0) return '';
  const clauses = steps.map((step) => {
    const v = `'${escapeSqlValue(step.value)}'`;
    switch (step.dimension) {
      case 'org_level_3':
        return `TRIM(CAST(org_level_3 AS VARCHAR)) = ${v}`;
      case 'coverage_combination':
        return `TRIM(CAST(coverage_combination AS VARCHAR)) = ${v}`;
      case 'energy_type':
        return step.value === '新能源'
          ? `COALESCE(CAST(is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`
          : `NOT COALESCE(CAST(is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
      case 'business_nature':
        {
          const renewalWhere = `COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          const newBusinessWhere = `NOT COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE') AND COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          const transferBusinessWhere = `NOT COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1','true','TRUE') AND NOT COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1','true','TRUE')`;
          const transferInTransferWhere = `${transferBusinessWhere} AND COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          const nonTransferInTransferWhere = `${transferBusinessWhere} AND NOT COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1','true','TRUE')`;
          switch (step.value) {
            case '续保': return renewalWhere;
            case '新保':
            case '新车': return newBusinessWhere;
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

/** 生成 PolicyFact（别名 p. + tm.）的 drillFilter WHERE 子句 */
function crossSellDrillToWherePF(steps: CrossSellHeatmapDrillStep[]): string {
  if (!steps || steps.length === 0) return '';
  const clauses = steps.map((step) => {
    const v = `'${escapeSqlValue(step.value)}'`;
    switch (step.dimension) {
      case 'org_level_3':
        return `TRIM(CAST(p.org_level_3 AS VARCHAR)) = ${v}`;
      case 'team':
        return `COALESCE(tm.team_name, '未归属团队') = ${v}`;
      case 'salesman':
        return `TRIM(CAST(p.salesman_name AS VARCHAR)) = ${v}`;
      case 'coverage_combination':
        return `TRIM(CAST(p.coverage_combination AS VARCHAR)) = ${v}`;
      case 'energy_type':
        return step.value === '新能源'
          ? `COALESCE(CAST(p.is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`
          : `NOT COALESCE(CAST(p.is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
      case 'business_nature':
        {
          const renewalWhere = `COALESCE(CAST(p.is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          const newBusinessWhere = `NOT COALESCE(CAST(p.is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE') AND COALESCE(CAST(p.is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          const transferBusinessWhere = `NOT COALESCE(CAST(p.is_renewal AS VARCHAR), '0') IN ('1','true','TRUE') AND NOT COALESCE(CAST(p.is_new_car AS VARCHAR), '0') IN ('1','true','TRUE')`;
          const transferInTransferWhere = `${transferBusinessWhere} AND COALESCE(CAST(p.is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE')`;
          const nonTransferInTransferWhere = `${transferBusinessWhere} AND NOT COALESCE(CAST(p.is_transfer AS VARCHAR), '0') IN ('1','true','TRUE')`;
          switch (step.value) {
            case '续保': return renewalWhere;
            case '新保':
            case '新车': return newBusinessWhere;
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

type CrossSellHeatmapTimePeriod = 'day' | 'week' | 'month' | 'quarter';

export interface HeatmapRow {
  date: string;
  org_level_3: string;
  auto_count: number;
  driver_count: number;
  driver_policy_count: number;
  driver_premium: number;
  penetration_base_premium: number;
  rate: number;
  penetration_rate: number | null;
  avg_premium: number;
  achievement_rate: number | null;
}

/**
 * 根据 timePeriod 获取计划分母（年计划除以多少得到单期计划）
 */
function getDriverPlanDenominator(timePeriod: CrossSellHeatmapTimePeriod): number {
  switch (timePeriod) {
    case 'day': return 365;
    case 'week': return 52;
    case 'month': return 12;
    case 'quarter': return 4;
    default: return 365;
  }
}

/**
 * 热力图维度分组类型（驾意险）
 */
export type CrossSellHeatmapGroupDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'coverage_combination'
  | 'energy_type'
  | 'business_nature';

/** 是否需要用 PolicyFact（team/salesman 不在 CrossSellDailyAgg 中） */
function needsPolicyFact(
  groupByDimension: CrossSellHeatmapGroupDimension,
  drillFilter: CrossSellHeatmapDrillStep[]
): boolean {
  if (groupByDimension === 'team' || groupByDimension === 'salesman') return true;
  return drillFilter.some((s) => s.dimension === 'team' || s.dimension === 'salesman');
}

/** CrossSellDailyAgg 的维度表达式（无表前缀） */
function getCrossSellHeatmapDimExprAgg(
  dimension: CrossSellHeatmapGroupDimension
): { selectExpr: string; alias: string } {
  switch (dimension) {
    case 'coverage_combination':
      return { selectExpr: `COALESCE(NULLIF(TRIM(CAST(coverage_combination AS VARCHAR)), ''), '未知')`, alias: 'dim_value' };
    case 'energy_type':
      return { selectExpr: `CASE WHEN COALESCE(CAST(is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '新能源' ELSE '燃油' END`, alias: 'dim_value' };
    case 'business_nature':
      return {
        selectExpr: `CASE
          WHEN COALESCE(CAST(is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '续保'
          WHEN COALESCE(CAST(is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '新保'
          WHEN COALESCE(CAST(is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '过户转保'
          ELSE '非过户转保'
        END`,
        alias: 'dim_value',
      };
    default: // org_level_3
      return { selectExpr: 'org_level_3', alias: 'dim_value' };
  }
}

/** PolicyFact（别名 p. + tm.）的维度表达式 */
function getCrossSellHeatmapDimExprPF(
  dimension: CrossSellHeatmapGroupDimension
): { selectExpr: string; alias: string } {
  switch (dimension) {
    case 'team':
      return { selectExpr: `COALESCE(tm.team_name, '未归属团队')`, alias: 'dim_value' };
    case 'salesman':
      return { selectExpr: `COALESCE(NULLIF(TRIM(CAST(p.salesman_name AS VARCHAR)), ''), '未知业务员')`, alias: 'dim_value' };
    case 'coverage_combination':
      return { selectExpr: `COALESCE(NULLIF(TRIM(CAST(p.coverage_combination AS VARCHAR)), ''), '未知')`, alias: 'dim_value' };
    case 'energy_type':
      return { selectExpr: `CASE WHEN COALESCE(CAST(p.is_nev AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '新能源' ELSE '燃油' END`, alias: 'dim_value' };
    case 'business_nature':
      return {
        selectExpr: `CASE
          WHEN COALESCE(CAST(p.is_renewal AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '续保'
          WHEN COALESCE(CAST(p.is_new_car AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '新保'
          WHEN COALESCE(CAST(p.is_transfer AS VARCHAR), '0') IN ('1', 'true', 'TRUE') THEN '过户转保'
          ELSE '非过户转保'
        END`,
        alias: 'dim_value',
      };
    default: // org_level_3
      return { selectExpr: `COALESCE(NULLIF(TRIM(CAST(p.org_level_3 AS VARCHAR)), ''), '未知机构')`, alias: 'dim_value' };
  }
}

/**
 * 生成交叉销售热力图查询（支持多时间粒度 + 计划达成率 + 多维度分组）
 *
 * 返回字段：date, org_level_3, auto_count, driver_count, rate, penetration_rate, avg_premium, achievement_rate
 * 按最近15个时间窗口 + 所有分组维度分组
 *
 * @param baseWhereClause - 基础 WHERE 子句（含 RBAC + org 过滤）
 * @param vehicleCategory - 车辆类别
 * @param seatCoverageClause - 座位险保额过滤子句（可选）
 * @param timePeriod - 时间粒度 day/week/month/quarter（默认 day）
 * @param groupByDimension - 分组维度（默认 org_level_3）
 */
export function generateCrossSellHeatmapQuery(
  baseWhereClause: string,
  vehicleCategory: VehicleCategory,
  seatCoverageClause?: string,
  timePeriod: CrossSellHeatmapTimePeriod = 'day',
  groupByDimension: CrossSellHeatmapGroupDimension = 'org_level_3',
  drillFilter: CrossSellHeatmapDrillStep[] = [],
  dateField: string = 'policy_date',
  rlsBranchCode?: string
): string {
  logger.debug('Generating cross-sell heatmap query', { vehicleCategory, hasSeatClause: !!seatCoverageClause, timePeriod, groupByDimension, drillFilterCount: drillFilter.length });

  const vehicleFilter = getVehicleCategoryFilter(vehicleCategory);
  const seatClause = seatCoverageClause ? `AND ${seatCoverageClause}` : '';
  const usePF = needsPolicyFact(groupByDimension, drillFilter);
  // usePF 路径 JOIN team_mapping（剥列 CTE：只投影 full_name+team_name，不含 branch_code）——
  // baseWhereClause 里 permissionFilter 的裸 branch_code 天然只解析到事实表 p.，无二义。
  // Agg 路径（!usePF）FROM CrossSellDailyAgg 无 tm JOIN，裸 branch_code 本就不歧义。
  // （2026-07-09 生产 Binder Error 结构层根治，替代 qualifyBranchCodeColumn；CTE 不去重不按省过滤 → 数字与现网一致）
  const drillAnd = (() => {
    const clause = usePF ? crossSellDrillToWherePF(drillFilter) : crossSellDrillToWhereAgg(drillFilter);
    return clause ? `AND ${clause}` : '';
  })();
  const safePeriods = 15;
  const planDenom = getDriverPlanDenominator(timePeriod);
  const dimConfig = usePF ? getCrossSellHeatmapDimExprPF(groupByDimension) : getCrossSellHeatmapDimExprAgg(groupByDimension);

  // 根据 timePeriod 动态生成 SQL 片段
  let truncExpr: string;
  let windowOffset: string;
  let seriesStep: string;

  switch (timePeriod) {
    case 'week':
      truncExpr = `DATE_TRUNC('week', pd)::DATE`;
      windowOffset = `${safePeriods - 1} WEEK`;
      seriesStep = 'INTERVAL 1 WEEK';
      break;
    case 'month':
      truncExpr = `DATE_TRUNC('month', pd)::DATE`;
      windowOffset = `${safePeriods - 1} MONTH`;
      seriesStep = 'INTERVAL 1 MONTH';
      break;
    case 'quarter':
      truncExpr = `DATE_TRUNC('quarter', pd)::DATE`;
      windowOffset = `${(safePeriods - 1) * 3} MONTH`;
      seriesStep = 'INTERVAL 3 MONTH';
      break;
    default: // 'day'
      truncExpr = 'pd';
      windowOffset = `${safePeriods - 1} DAY`;
      seriesStep = 'INTERVAL 1 DAY';
      break;
  }

  const refDateExpr = timePeriod === 'day'
    ? 'MAX(pd)'
    : `DATE_TRUNC('${timePeriod === 'quarter' ? 'quarter' : timePeriod}', MAX(pd))::DATE`;

  const isCrossSelltruthy = crossSellTruthyExpr('p.is_cross_sell');

  const filteredCte = usePF ? `
    WITH ${buildTeamMappingCte(rlsBranchCode)},
    normalized AS (
      SELECT
        CAST(p.${dateField} AS DATE) AS pd,
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        COALESCE(
          NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        NULLIF(TRIM(CAST(p.policy_no AS VARCHAR)), '') AS raw_policy_no,
        COALESCE(NULLIF(TRIM(CAST(p.coverage_combination AS VARCHAR)), ''), '未知') AS coverage_combination,
        ${isCrossSelltruthy} AS is_cross_sell,
        COALESCE(CAST(p.cross_sell_premium_driver AS DOUBLE), 0) AS cross_sell_premium_driver,
        COALESCE(CAST(p.premium AS DOUBLE), 0) AS premium,
        CASE
          WHEN COALESCE(CAST(p.insurance_type AS VARCHAR), '') IN ('商业险', '商业保险', '商车统保', '商业险+交强险')
          THEN COALESCE(CAST(p.premium AS DOUBLE), 0)
          ELSE 0
        END AS commercial_premium,
        CASE
          WHEN COALESCE(CAST(p.insurance_type AS VARCHAR), '') = '交强险'
          THEN COALESCE(CAST(p.premium AS DOUBLE), 0)
          ELSE 0
        END AS compulsory_premium
      FROM PolicyFact p
      LEFT JOIN team_mapping tm ON TRIM(CAST(p.salesman_name AS VARCHAR)) = TRIM(CAST(tm.full_name AS VARCHAR))
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
        ${seatClause}
        ${drillAnd}
        AND p.org_level_3 IS NOT NULL
        AND TRIM(CAST(p.org_level_3 AS VARCHAR)) != ''
    ),
    filtered AS (
      SELECT
        pd,
        ${dimConfig.alias},
        -- 推介率分子分母限定主全/交三（红线：分母不含纯交强/单交），对齐 cross-sell.ts total_auto/driver_count
        COUNT(DISTINCT CASE WHEN coverage_combination IN ('主全', '交三') THEN dedup_key END) AS auto_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell AND coverage_combination IN ('主全', '交三') THEN dedup_key END) AS driver_count,
        COUNT(DISTINCT CASE WHEN is_cross_sell THEN raw_policy_no END) AS driver_policy_count,
        SUM(CASE WHEN is_cross_sell THEN cross_sell_premium_driver ELSE 0 END) AS driver_premium,
        SUM(commercial_premium) AS commercial_premium,
        SUM(compulsory_premium) AS compulsory_premium,
        SUM(
          CASE
            WHEN coverage_combination = '单交' THEN compulsory_premium
            WHEN coverage_combination IN ('交三', '主全') THEN commercial_premium
            ELSE 0
          END
        ) AS penetration_base_premium
      FROM normalized
      WHERE dedup_key IS NOT NULL
      GROUP BY pd, ${dimConfig.alias}
    ),` : `
    WITH filtered AS (
      SELECT
        CAST(policy_date AS DATE) AS pd,
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        -- 推介率分子分母限定主全/交三（红线：分母不含纯交强/单交），对齐 cross-sell.ts total_auto/driver_count
        SUM(CASE WHEN coverage_combination IN ('主全', '交三') THEN auto_count ELSE 0 END) AS auto_count,
        SUM(CASE WHEN coverage_combination IN ('主全', '交三') THEN driver_count ELSE 0 END) AS driver_count,
        SUM(driver_policy_count) AS driver_policy_count,
        SUM(driver_premium) AS driver_premium,
        SUM(commercial_premium) AS commercial_premium,
        SUM(compulsory_premium) AS compulsory_premium,
        SUM(
          CASE
            WHEN coverage_combination = '单交' THEN compulsory_premium
            WHEN coverage_combination IN ('交三', '主全') THEN commercial_premium
            ELSE 0
          END
        ) AS penetration_base_premium
      FROM CrossSellDailyAgg
      WHERE ${baseWhereClause}
        AND ${vehicleFilter}
        ${seatClause}
        ${drillAnd}
        AND org_level_3 IS NOT NULL
        AND TRIM(org_level_3) != ''
      GROUP BY pd, ${dimConfig.alias}
    ),`;

  const sql = `${filteredCte}
    period_bounds AS (
      SELECT
        ${refDateExpr} AS ref_date,
        ${refDateExpr} - INTERVAL ${windowOffset} AS start_date
      FROM filtered
    ),
    window_rows AS (
      SELECT f.*, ${truncExpr} AS period_key
      FROM filtered f
      CROSS JOIN period_bounds pb
      WHERE f.pd >= pb.start_date AND f.pd <= pb.ref_date ${timePeriod !== 'day' ? `+ INTERVAL ${timePeriod === 'quarter' ? '3 MONTH' : '1 ' + timePeriod} - INTERVAL 1 DAY` : ''}
    ),
    dim_period AS (
      SELECT
        wr.${dimConfig.alias},
        wr.period_key,
        SUM(wr.auto_count) AS auto_count,
        SUM(wr.driver_count) AS driver_count,
        SUM(wr.driver_policy_count) AS driver_policy_count,
        SUM(wr.driver_premium) AS driver_premium,
        SUM(wr.penetration_base_premium) AS penetration_base_premium
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
    base_grid AS (
      SELECT o.${dimConfig.alias}, pp.period_key
      FROM dim_pool o
      CROSS JOIN period_pool pp
    ),
    driver_plan AS (
      SELECT
        level_key AS plan_org,
        plan_premium AS plan_premium_wan
      FROM KpiPlanConfig
      WHERE business_line = 'driver'
        AND level = 'org'
        AND plan_year = COALESCE(
          CAST(EXTRACT(YEAR FROM (SELECT ref_date FROM period_bounds LIMIT 1)) AS INTEGER),
          EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
        )
    )
    SELECT
      bg.${dimConfig.alias} AS org_level_3,
      STRFTIME(bg.period_key, '%Y-%m-%d') AS date,
      COALESCE(cur.auto_count, 0) AS auto_count,
      COALESCE(cur.driver_count, 0) AS driver_count,
      COALESCE(cur.driver_policy_count, 0) AS driver_policy_count,
      COALESCE(cur.driver_premium, 0) AS driver_premium,
      COALESCE(cur.penetration_base_premium, 0) AS penetration_base_premium,
      CASE
        WHEN COALESCE(cur.auto_count, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(cur.driver_count, 0) * 100.0 / COALESCE(cur.auto_count, 0), 2)
      END AS rate,
      CASE
        WHEN COALESCE(cur.penetration_base_premium, 0) <= 0 THEN NULL
        ELSE ROUND(COALESCE(cur.driver_premium, 0) * 100.0 / COALESCE(cur.penetration_base_premium, 0), 2)
      END AS penetration_rate,
      CASE
        WHEN COALESCE(cur.driver_policy_count, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(cur.driver_premium, 0) / COALESCE(cur.driver_policy_count, 0), 2)
      END AS avg_premium,
      ${groupByDimension === 'org_level_3' ? `CASE
        WHEN COALESCE(dp.plan_premium_wan, 0) <= 0 THEN NULL
        ELSE ROUND(
          COALESCE(cur.driver_premium, 0) / 10000.0
          / (dp.plan_premium_wan / ${planDenom}.0)
          * 100.0,
          2
        )
      END` : 'NULL'} AS achievement_rate
    FROM base_grid bg
    LEFT JOIN dim_period cur ON cur.${dimConfig.alias} = bg.${dimConfig.alias} AND cur.period_key = bg.period_key
    ${groupByDimension === 'org_level_3' ? `LEFT JOIN driver_plan dp ON dp.plan_org = bg.${dimConfig.alias}` : ''}
    ORDER BY bg.${dimConfig.alias}, bg.period_key
  `;

  logger.debug('Generated cross-sell heatmap SQL', { sqlLength: sql.length, timePeriod, groupByDimension });
  return sql;
}
