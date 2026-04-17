/**
 * 车驾意推介率 SQL 生成器（层层下钻版）
 * Cross-Sell Recommendation Rate SQL Generator (Hierarchical Drilldown)
 *
 * 支持层层下钻：
 * Level 0: 四川分公司汇总（单行）
 * Level N: 用户选择维度 → 按该维度分组，同时应用之前所有层级的过滤条件
 *
 * 下钻路径示例：
 *   [] + groupBy=null                           → 公司汇总
 *   [] + groupBy=org_level_3                     → 按三级机构分组
 *   [{dim: org_level_3, val: '天府'}] + groupBy=is_new_car → 筛选天府，按新车分组
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
      // salesman 的 group_name 是去掉工号的名字，所以用 LIKE 匹配
      return `REGEXP_REPLACE(${colPrefix}salesman_name, '^[0-9]+', '') = '${esc(step.value)}'`;
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
      return {
        selectExpr: `REGEXP_REPLACE(${colPrefix}salesman_name, '^[0-9]+', '') AS group_name`,
        groupByExpr: `${colPrefix}salesman_name`,
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
  groupBy: CrossSellDimension | null = null
): string {
  logger.debug('Generating cross-sell query', { baseWhereClause, drillPath, groupBy });

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
    return generateSummaryOnly(tableRef, teamJoin, fullWhere, colPrefix);
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
 * 生成汇总查询（仅一行，四川分公司汇总）
 */
function generateSummaryOnly(
  tableRef: string,
  teamJoin: string,
  fullWhere: string,
  colPrefix: string
): string {
  return `
    WITH summary AS (
      SELECT
        '四川分公司' AS group_name,
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
