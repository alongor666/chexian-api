/**
 * 车驾意推介率 SQL 生成器（层层下钻版）
 * Cross-Sell Recommendation Rate SQL Generator (Hierarchical Drilldown)
 *
 * 支持层层下钻：
 * Level 0: 分公司汇总（单行，标签由调用方传入 — 默认 '四川分公司' 保持兼容期行为）
 * Level N: 用户选择维度 → 按该维度分组，同时应用之前所有层级的过滤条件
 *
 * 下钻路径示例：
 *   [] + groupBy=null                           → 公司汇总
 *   [] + groupBy=org_level_3                     → 按三级机构分组
 *   [{dim: org_level_3, val: '天府'}] + groupBy=is_new_car → 筛选天府，按新车分组
 *
 * 0E：summaryGroupName 参数化 — 由 route handler 按 req.user.branchCode 派生
 *     （server/src/config/branch-names.ts:getBranchCompanyName）
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';

/**
 * 支持的下钻维度
 */
export type CrossSellDimension =
  | 'org_level_3'       // 三级机构
  | 'team'              // 销售团队（JOIN SalesmanTeamMapping）
  | 'salesman'          // 业务员
  | 'is_new_car'        // 是否新车
  | 'is_transfer'       // 是否过户
  | 'is_nev'            // 是否新能源
  | 'is_telemarketing'  // 是否电销
  | 'is_renewal'        // 是否续保
  | 'insurance_grade';  // 车险风险等级（条件维度：仅非营业客车可用）

/**
 * 下钻路径中的一步
 */
export interface DrilldownStep {
  dimension: CrossSellDimension;
  value: string; // 显示值（如 '天府', '新车', '电销'）
}

/**
 * 维度中文标签（用于前端展示）
 */
export const DIMENSION_LABELS: Record<CrossSellDimension, string> = {
  org_level_3: '三级机构',
  team: '销售团队',
  salesman: '业务员',
  is_new_car: '是否新车',
  is_transfer: '是否过户',
  is_nev: '是否新能源',
  is_telemarketing: '是否电销',
  is_renewal: '是否续保',
  insurance_grade: '车险风险等级',
};

// ============================================================
// 维度 → SQL 映射
// ============================================================

/** 布尔维度的中文显示值 → SQL 条件映射 */
const BOOLEAN_DIM_MAP: Record<string, { field: string; trueLabel: string; falseLabel: string }> = {
  is_new_car: { field: 'is_new_car', trueLabel: '新车', falseLabel: '旧车' },
  is_transfer: { field: 'is_transfer', trueLabel: '过户车', falseLabel: '非过户车' },
  is_nev: { field: 'is_nev', trueLabel: '新能源', falseLabel: '非新能源' },
  is_telemarketing: { field: 'is_telemarketing', trueLabel: '电销', falseLabel: '非电销' },
  is_renewal: { field: 'is_renewal', trueLabel: '续保', falseLabel: '非续保' },
};

/**
 * 将下钻路径中的一步转为 WHERE 条件
 */
function drillStepToWhere(step: DrilldownStep, colPrefix: string): string {
  // 使用统一的 SQL 转义工具函数（AUDIT-005 修复）
  const esc = escapeSqlValue;

  // 布尔维度：中文显示值 → boolean
  const boolDef = BOOLEAN_DIM_MAP[step.dimension];
  if (boolDef) {
    const boolVal = step.value === boolDef.trueLabel ? 'true' : 'false';
    return `${colPrefix}${boolDef.field} = ${boolVal}`;
  }

  // 字符串维度
  switch (step.dimension) {
    case 'org_level_3':
      return `${colPrefix}org_level_3 = '${esc(step.value)}'`;
    case 'team':
      // team 过滤在 JOIN 后的 WHERE 中处理
      return `tm.team_name = '${esc(step.value)}'`;
    case 'salesman':
      // 下钻传带工号 key（group_name=salesman_name，工号+姓名=人唯一键），精确匹配单个真人；
      // 勿用去工号短名（会命中同名多人，把同名不同工号真人合并）。2026-06-27 口径修复，
      // 对齐 performance-analysis 样板 PR #830；口径见业务规则字典 §业务员（聚合键 vs 展示口径）
      return `COALESCE(${colPrefix}salesman_name, '未知') = '${esc(step.value)}'`;
    case 'insurance_grade':
      return `COALESCE(${colPrefix}insurance_grade, 'X') = '${esc(step.value)}'`;
    default:
      return '1=1';
  }
}

/**
 * 获取维度的 GROUP BY 和 SELECT 表达式
 */
function getGroupByConfig(dimension: CrossSellDimension, colPrefix: string): {
  selectExpr: string;
  groupByExpr: string;
} {
  const boolDef = BOOLEAN_DIM_MAP[dimension];
  if (boolDef) {
    return {
      selectExpr: `CASE WHEN ${colPrefix}${boolDef.field} = true THEN '${boolDef.trueLabel}' ELSE '${boolDef.falseLabel}' END AS group_name`,
      groupByExpr: `${colPrefix}${boolDef.field}`,
    };
  }

  switch (dimension) {
    case 'org_level_3':
      return {
        selectExpr: `${colPrefix}org_level_3 AS group_name`,
        groupByExpr: `${colPrefix}org_level_3`,
      };
    case 'team':
      return {
        selectExpr: "COALESCE(tm.team_name, '未归属团队') AS group_name",
        groupByExpr: "COALESCE(tm.team_name, '未归属团队')",
      };
    case 'salesman':
      // 聚合键必须用带工号全名（salesman_name=工号+姓名=人唯一键），禁去工号——
      // 否则同名不同工号的真人被合并（张丽×3 等）。短名仅用于展示层 display_name
      //（见 generateCrossSellQuery 外层 SELECT）。COALESCE 防空值，与下钻 WHERE 对齐。
      return {
        selectExpr: `COALESCE(${colPrefix}salesman_name, '未知') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}salesman_name, '未知')`,
      };
    case 'insurance_grade':
      return {
        selectExpr: `COALESCE(${colPrefix}insurance_grade, 'X') AS group_name`,
        groupByExpr: `COALESCE(${colPrefix}insurance_grade, 'X')`,
      };
    default:
      return {
        selectExpr: `${colPrefix}org_level_3 AS group_name`,
        groupByExpr: `${colPrefix}org_level_3`,
      };
  }
}

/**
 * 判断是否需要 JOIN SalesmanTeamMapping
 * Phase 2b: 业务员下钻附带 team_name 元数据，故 groupBy=salesman 时也需 JOIN
 */
function needsTeamJoin(drillPath: DrilldownStep[], groupBy: CrossSellDimension | null): boolean {
  if (groupBy === 'team' || groupBy === 'salesman') return true;
  return drillPath.some(s => s.dimension === 'team');
}

// ============================================================
// 主查询生成
// ============================================================

/**
 * 生成车驾意推介率查询
 *
 * @param baseWhereClause - 基础 WHERE 子句（来自筛选器 + 权限过滤）
 * @param drillPath - 下钻路径（维度+值数组，每步添加一个 WHERE 过滤）
 * @param groupBy - 当前分组维度（null 则仅返回汇总行）
 * @returns SQL 查询字符串
 */
export function generateCrossSellQuery(
  baseWhereClause: string,
  drillPath: DrilldownStep[] = [],
  groupBy: CrossSellDimension | null = null,
  /**
   * 0E：分公司汇总行的中文标签。默认 '四川分公司' 保持向后兼容；
   * 多分公司启用后由 route handler 传 getBranchCompanyName(req.user.branchCode)。
   */
  summaryGroupName: string = '四川分公司'
): string {
  logger.debug('Generating cross-sell query', { baseWhereClause, drillPath, groupBy, summaryGroupName });

  const useJoin = needsTeamJoin(drillPath, groupBy);
  const colPrefix = useJoin ? 'c.' : '';
  const tableRef = useJoin ? 'CrossSellDailyAgg c' : 'CrossSellDailyAgg';
  const teamJoin = useJoin
    ? `LEFT JOIN SalesmanTeamMapping tm ON ${colPrefix}salesman_name = tm.full_name`
    : '';

  // 构建 WHERE：基础条件 + 下钻路径的每一步过滤
  const whereParts = [baseWhereClause];
  for (const step of drillPath) {
    whereParts.push(drillStepToWhere(step, colPrefix));
  }
  const fullWhere = whereParts.join('\n      AND ');

  // 汇总查询（无 GROUP BY）
  if (!groupBy) {
    return generateSummaryOnly(tableRef, teamJoin, fullWhere, colPrefix, summaryGroupName);
  }

  // 分组查询
  const config = getGroupByConfig(groupBy, colPrefix);

  // Phase 2b: 业务员下钻附带 org_level_3 + team_name 元数据列
  const includeHierarchy = groupBy === 'salesman';
  const hierarchySelect = includeHierarchy
    ? `${colPrefix}org_level_3 AS org_level_3,
        COALESCE(tm.team_name, '未归属团队') AS team_name,`
    : '';
  const hierarchyGroupBy = includeHierarchy
    ? `, ${colPrefix}org_level_3, COALESCE(tm.team_name, '未归属团队')`
    : '';
  const hierarchyFinal = includeHierarchy
    ? `org_level_3,
      team_name,`
    : '';

  // display_name：salesman 维度用短名（去工号）做显示，两级判重消歧——
  // 短名唯一→短名；同短名跨机构→短名·机构；同机构同名→短名·机构#工号（绝对区分）；admin→直接个代。
  // group_name 始终保留带工号原值（人唯一键）供下钻精确传参，UI 显示用 display_name。
  // 其他维度 group_name 本身即显示名。对齐 performance-analysis 样板 PR #830。
  const displaySelect = includeHierarchy
    ? `CASE
        WHEN group_name ILIKE 'admin%' THEN '直接个代'
        WHEN COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(group_name, '^[0-9]+', '')) = 1
          THEN REGEXP_REPLACE(group_name, '^[0-9]+', '')
        WHEN COUNT(*) OVER (PARTITION BY REGEXP_REPLACE(group_name, '^[0-9]+', ''), org_level_3) = 1
          THEN REGEXP_REPLACE(group_name, '^[0-9]+', '') || '·' || COALESCE(org_level_3, '未知机构')
        ELSE REGEXP_REPLACE(group_name, '^[0-9]+', '') || '·' || COALESCE(org_level_3, '未知机构') || '#' || REGEXP_EXTRACT(group_name, '^[0-9]+')
      END AS display_name`
    : `group_name AS display_name`;

  const sql = `
    WITH cross_sell_base AS (
      SELECT
        ${config.selectExpr},
        ${hierarchySelect}
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination IN ('主全', '交三') THEN ${colPrefix}auto_count ELSE 0 END), 0) AS total_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination IN ('主全', '交三') THEN ${colPrefix}driver_count ELSE 0 END), 0) AS total_driver_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '单交' THEN ${colPrefix}auto_count ELSE 0 END), 0) AS danjiao_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '单交' THEN ${colPrefix}driver_count ELSE 0 END), 0) AS danjiao_driver_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '交三' THEN ${colPrefix}auto_count ELSE 0 END), 0) AS jiaosan_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '交三' THEN ${colPrefix}driver_count ELSE 0 END), 0) AS jiaosan_driver_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '主全' THEN ${colPrefix}auto_count ELSE 0 END), 0) AS zhuquan_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '主全' THEN ${colPrefix}driver_count ELSE 0 END), 0) AS zhuquan_driver_count
      FROM ${tableRef}
      ${teamJoin}
      WHERE ${fullWhere}
      GROUP BY ${config.groupByExpr}${hierarchyGroupBy}
      HAVING COALESCE(SUM(${colPrefix}auto_count), 0) > 0
    )
    SELECT
      group_name,
      ${displaySelect},
      ${hierarchyFinal}
      total_auto_count,
      total_driver_count,
      danjiao_auto_count,
      danjiao_driver_count,
      CASE WHEN danjiao_auto_count = 0 THEN 0
        ELSE ROUND(danjiao_driver_count * 100.0 / danjiao_auto_count, 2)
      END AS danjiao_rate,
      jiaosan_auto_count,
      jiaosan_driver_count,
      CASE WHEN jiaosan_auto_count = 0 THEN 0
        ELSE ROUND(jiaosan_driver_count * 100.0 / jiaosan_auto_count, 2)
      END AS jiaosan_rate,
      zhuquan_auto_count,
      zhuquan_driver_count,
      CASE WHEN zhuquan_auto_count = 0 THEN 0
        ELSE ROUND(zhuquan_driver_count * 100.0 / zhuquan_auto_count, 2)
      END AS zhuquan_rate,
      CASE WHEN total_auto_count = 0 THEN 0
        ELSE ROUND(total_driver_count * 100.0 / total_auto_count, 2)
      END AS total_rate
    FROM cross_sell_base
    ORDER BY total_auto_count DESC
  `;

  logger.debug('Generated cross-sell drilldown SQL', { sqlLength: sql.length });
  return sql;
}

/**
 * 生成汇总查询（仅一行，分公司汇总）
 *
 * 0E：summaryGroupName 默认 '四川分公司' 兼容；山西上线 / flag on 后由调用方传 getBranchCompanyName。
 * 安全：summaryGroupName 经 escapeSqlValue 转义（防 SQL 注入 — 即使当前来源是受控的服务端常量映射）。
 */
function generateSummaryOnly(
  tableRef: string,
  teamJoin: string,
  fullWhere: string,
  colPrefix: string,
  summaryGroupName: string = '四川分公司'
): string {
  const escapedName = escapeSqlValue(summaryGroupName);
  return `
    WITH summary AS (
      SELECT
        '${escapedName}' AS group_name,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination IN ('主全', '交三') THEN ${colPrefix}auto_count ELSE 0 END), 0) AS total_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination IN ('主全', '交三') THEN ${colPrefix}driver_count ELSE 0 END), 0) AS total_driver_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '单交' THEN ${colPrefix}auto_count ELSE 0 END), 0) AS danjiao_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '单交' THEN ${colPrefix}driver_count ELSE 0 END), 0) AS danjiao_driver_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '交三' THEN ${colPrefix}auto_count ELSE 0 END), 0) AS jiaosan_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '交三' THEN ${colPrefix}driver_count ELSE 0 END), 0) AS jiaosan_driver_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '主全' THEN ${colPrefix}auto_count ELSE 0 END), 0) AS zhuquan_auto_count,
        COALESCE(SUM(CASE WHEN ${colPrefix}coverage_combination = '主全' THEN ${colPrefix}driver_count ELSE 0 END), 0) AS zhuquan_driver_count
      FROM ${tableRef}
      ${teamJoin}
      WHERE ${fullWhere}
    )
    SELECT
      group_name,
      group_name AS display_name,
      total_auto_count,
      total_driver_count,
      danjiao_auto_count,
      danjiao_driver_count,
      CASE WHEN danjiao_auto_count = 0 THEN 0
        ELSE ROUND(danjiao_driver_count * 100.0 / danjiao_auto_count, 2)
      END AS danjiao_rate,
      jiaosan_auto_count,
      jiaosan_driver_count,
      CASE WHEN jiaosan_auto_count = 0 THEN 0
        ELSE ROUND(jiaosan_driver_count * 100.0 / jiaosan_auto_count, 2)
      END AS jiaosan_rate,
      zhuquan_auto_count,
      zhuquan_driver_count,
      CASE WHEN zhuquan_auto_count = 0 THEN 0
        ELSE ROUND(zhuquan_driver_count * 100.0 / zhuquan_auto_count, 2)
      END AS zhuquan_rate,
      CASE WHEN total_auto_count = 0 THEN 0
        ELSE ROUND(total_driver_count * 100.0 / total_auto_count, 2)
      END AS total_rate
    FROM summary
  `;
}
