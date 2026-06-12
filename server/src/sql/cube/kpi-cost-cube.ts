/**
 * KPI 成本立方体单行 SQL（通用可加性立方体 · 第四批次：KPI 路由接立方体）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md §3A.2 ①族（kpi 行）
 * BACKLOG：uid=2026-06-11-claude-90a92c
 *
 * /api/query/kpi 单行返回 20+ 指标，可加性混合：
 *   ─ 可加（保费/费用/赔款/各类率值的 CASE WHEN）……继续走主 SQL 单遍 PolicyFact，
 *     P95 通常在数十毫秒
 *   ─ 非可加（salesman_count / per_vehicle_premium 的 COUNT DISTINCT vehicle_frame_no
 *     / bundle_renewal_rate 的套单配对）……保持主路径，结构性回退
 *   ─ **本立方体专管 cost 三项**（variable_cost_ratio / earned_claim_ratio /
 *     expense_ratio）：原路径的 P95 大头 = variable_cost_base CTE（B252 保单去重
 *     260 万行 + LEFT JOIN ClaimsAgg + 逐保单日期函数）→ 全部移到构建期，
 *     查询期单行扫小立方体即得
 *
 * 接线由 routes/query/kpi.ts 在双开关开启 + cube 可服务 + 新鲜时启用：
 *   主 SQL（excludeVariableCost=true）+ 本立方体 SQL 并行 → 合并三项 →
 *   总时延 ≈ max(主 SQL去 cost 后, 立方体)，cost JOIN 大头消除。
 *
 * 结构性回退（不可服务情形）：
 *   - dateField=policy_date：CubeCostDay 格子键含 insurance_start_date 不含 policy_date，
 *     原路径 latest_policy_date = MAX(policy_date)，立方体侧无法对应
 *   - WHERE 含立方体外列：复用 CubeCostDay 的 token 白名单（cost-cube.ts）
 */

import { getMetricSql } from '../../config/metric-registry/index.js';
import {
  COST_CUBE_TABLE,
  COST_CUBE_DIMENSIONS,
  COST_CUBE_OPTIONAL_DIMENSIONS,
} from './cost-cube.js';
import {
  buildWhereTokenAllowlist,
  isWhereServableForColumns,
  type CubeServability,
} from './servability.js';

const KPI_COST_WHERE_ALLOWLIST = buildWhereTokenAllowlist([
  ...COST_CUBE_DIMENSIONS,
  ...COST_CUBE_OPTIONAL_DIMENSIONS,
  // KPI 的 dateField 受限于 insurance_start_date（见 isKpiCostCubeServable），
  // 该列是 CubeCostDay 的格子键，窗口过滤可下推
  'insurance_start_date',
]);

export interface KpiCostCubeServabilityArgs {
  /** 等于 KPI handler 的 whereWithDate（含权限过滤 + dateField 日期窗） */
  whereClause: string;
  /** KPI handler 的 dateField；仅 insurance_start_date 时立方体可服务 */
  dateField: string;
}

/** 判定 KPI 的 cost 三项能否由 CubeCostDay 精确回答 */
export function isKpiCostCubeServable(args: KpiCostCubeServabilityArgs): CubeServability {
  if (args.dateField !== 'insurance_start_date') {
    return {
      servable: false,
      reason: `dateField=${args.dateField}（KPI cost 立方体仅在按起保日口径时可服务，签单日口径下立方体无 policy_date 列）`,
    };
  }
  return isWhereServableForColumns(args.whereClause, KPI_COST_WHERE_ALLOWLIST);
}

/**
 * 生成 KPI cost 三项的立方体单行 SQL（输出列与 generateKpiQuery 的 vc.* 三列同名）。
 *
 * 等价性依据：dateField=insurance_start_date 时，
 *   原路径 latest_policy_date = MAX(insurance_start_date)（受同 whereClause 过滤）
 * 在立方体上对同一 WHERE 取 MAX(insurance_start_date) 完全等价（CubeCostDay 含此列）。
 * 满期天数/保险期限按 ratio-of-sums 在格子行内联（格内保单共享起保日 →
 * earned_days/policy_term 为格内常量），注册表表达式逐字内联即与原路径同义。
 *
 * 单行返回（无 GROUP BY）：variable_cost_ratio / earned_claim_ratio / expense_ratio。
 *
 * 调用方必须先通过 isKpiCostCubeServable + ensureCostCubeFresh（含跨格保单探针）。
 */
export function generateKpiCostCubeQuery(whereClause: string = '1=1'): string {
  return `
    WITH latest_policy AS (
      SELECT MAX(insurance_start_date) AS latest_policy_date
      FROM ${COST_CUBE_TABLE}
      WHERE ${whereClause}
    ),
    cell_exposure AS (
      SELECT
        premium_sum AS premium,
        fee_sum AS fee_amount,
        reported_claims_sum AS reported_claims,
        DATEDIFF('day', c.insurance_start_date, c.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
        LEAST(
          GREATEST(
            DATEDIFF('day', c.insurance_start_date, lp.latest_policy_date) + 1,
            0
          ),
          DATEDIFF('day', c.insurance_start_date, c.insurance_start_date + INTERVAL 1 YEAR)
        ) AS earned_days
      FROM ${COST_CUBE_TABLE} c
      CROSS JOIN latest_policy lp
      WHERE ${whereClause}
    )
    SELECT
      ${getMetricSql('variable_cost_ratio')},
      ${getMetricSql('earned_claim_ratio')},
      ${getMetricSql('expense_ratio')}
    FROM cell_exposure
  `;
}
