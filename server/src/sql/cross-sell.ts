/**
 * 车驾意推介率 SQL 生成器
 * Cross-Sell Recommendation Rate SQL Generator
 *
 * 第一层：四川分公司汇总（单行）
 * 下钻维度（可选）：三级机构、销售团队、业务员、客户类别、是否新车、是否过户、是否新能源、是否电销、是否续保
 */

import { logger } from '../utils/logger.js';

/**
 * 支持的下钻维度
 */
export type CrossSellDimension =
  | 'summary'          // 公司汇总（第一层，单行）
  | 'org_level_3'      // 三级机构
  | 'team'             // 销售团队（需 JOIN SalesmanPlanFact）
  | 'salesman'         // 业务员
  | 'customer_category'// 客户类别
  | 'is_new_car'       // 是否新车
  | 'is_transfer'      // 是否过户
  | 'is_nev'           // 是否新能源
  | 'is_telemarketing' // 是否电销
  | 'is_renewal';      // 是否续保

/**
 * 维度 → SQL 字段映射
 */
function getDimensionConfig(dimension: CrossSellDimension): {
  groupByExpr: string;    // GROUP BY 表达式
  selectExpr: string;     // SELECT 中的 AS group_name
  needsTeamJoin: boolean; // 是否需要 JOIN SalesmanPlanFact
} {
  switch (dimension) {
    case 'summary':
      return {
        selectExpr: "'四川分公司' AS group_name",
        groupByExpr: "'四川分公司'",
        needsTeamJoin: false,
      };
    case 'org_level_3':
      return {
        selectExpr: 'org_level_3 AS group_name',
        groupByExpr: 'org_level_3',
        needsTeamJoin: false,
      };
    case 'team':
      return {
        selectExpr: "COALESCE(t.team_name, '未归属团队') AS group_name",
        groupByExpr: "COALESCE(t.team_name, '未归属团队')",
        needsTeamJoin: true,
      };
    case 'salesman':
      return {
        selectExpr: "REGEXP_REPLACE(salesman_name, '^[0-9]+', '') AS group_name",
        groupByExpr: 'salesman_name',
        needsTeamJoin: false,
      };
    case 'customer_category':
      return {
        selectExpr: "COALESCE(customer_category, '未知') AS group_name",
        groupByExpr: "COALESCE(customer_category, '未知')",
        needsTeamJoin: false,
      };
    case 'is_new_car':
      return {
        selectExpr: "CASE WHEN is_new_car = true THEN '新车' ELSE '旧车' END AS group_name",
        groupByExpr: 'is_new_car',
        needsTeamJoin: false,
      };
    case 'is_transfer':
      return {
        selectExpr: "CASE WHEN is_transfer = true THEN '过户车' ELSE '非过户车' END AS group_name",
        groupByExpr: 'is_transfer',
        needsTeamJoin: false,
      };
    case 'is_nev':
      return {
        selectExpr: "CASE WHEN is_nev = true THEN '新能源' ELSE '非新能源' END AS group_name",
        groupByExpr: 'is_nev',
        needsTeamJoin: false,
      };
    case 'is_telemarketing':
      return {
        selectExpr: "CASE WHEN is_telemarketing = true THEN '电销' ELSE '非电销' END AS group_name",
        groupByExpr: 'is_telemarketing',
        needsTeamJoin: false,
      };
    case 'is_renewal':
      return {
        selectExpr: "CASE WHEN is_renewal = true THEN '续保' ELSE '新保' END AS group_name",
        groupByExpr: 'is_renewal',
        needsTeamJoin: false,
      };
    default:
      return {
        selectExpr: 'org_level_3 AS group_name',
        groupByExpr: 'org_level_3',
        needsTeamJoin: false,
      };
  }
}

/**
 * 生成车驾意推介率查询
 *
 * @param whereClause - 已构建的 WHERE 子句（含权限过滤）
 * @param dimension - 下钻维度
 * @returns SQL 查询字符串
 */
export function generateCrossSellQuery(
  whereClause: string,
  dimension: CrossSellDimension = 'summary'
): string {
  logger.debug('Generating cross-sell query', { whereClause, dimension });

  const config = getDimensionConfig(dimension);
  const tableAlias = config.needsTeamJoin ? 'p' : '';
  const tableRef = config.needsTeamJoin ? 'PolicyFact p' : 'PolicyFact';
  const colPrefix = config.needsTeamJoin ? 'p.' : '';

  // 团队维度需要 LEFT JOIN SalesmanPlanFact 获取 team_name
  const teamJoin = config.needsTeamJoin
    ? `LEFT JOIN (
        SELECT DISTINCT salesman_name, team_name
        FROM SalesmanPlanFact
        WHERE plan_year = YEAR(CURRENT_DATE)
      ) t ON p.salesman_name = t.salesman_name`
    : '';

  const sql = `
    WITH cross_sell_base AS (
      SELECT
        ${config.selectExpr},
        -- 总计
        COUNT(DISTINCT ${colPrefix}policy_no) AS total_auto_count,
        COUNT(DISTINCT CASE WHEN ${colPrefix}is_cross_sell = true THEN ${colPrefix}policy_no END) AS total_driver_count,
        -- 单交
        COUNT(DISTINCT CASE WHEN ${colPrefix}coverage_combination = '单交' THEN ${colPrefix}policy_no END) AS danjiao_auto_count,
        COUNT(DISTINCT CASE WHEN ${colPrefix}coverage_combination = '单交' AND ${colPrefix}is_cross_sell = true THEN ${colPrefix}policy_no END) AS danjiao_driver_count,
        -- 交三
        COUNT(DISTINCT CASE WHEN ${colPrefix}coverage_combination = '交三' THEN ${colPrefix}policy_no END) AS jiaosan_auto_count,
        COUNT(DISTINCT CASE WHEN ${colPrefix}coverage_combination = '交三' AND ${colPrefix}is_cross_sell = true THEN ${colPrefix}policy_no END) AS jiaosan_driver_count,
        -- 主全
        COUNT(DISTINCT CASE WHEN ${colPrefix}coverage_combination = '主全' THEN ${colPrefix}policy_no END) AS zhuquan_auto_count,
        COUNT(DISTINCT CASE WHEN ${colPrefix}coverage_combination = '主全' AND ${colPrefix}is_cross_sell = true THEN ${colPrefix}policy_no END) AS zhuquan_driver_count
      FROM ${tableRef}
      ${teamJoin}
      WHERE ${whereClause}
      GROUP BY ${config.groupByExpr}
      HAVING COUNT(DISTINCT ${colPrefix}policy_no) > 0
    )
    SELECT
      group_name,
      total_auto_count,
      total_driver_count,
      -- 单交
      danjiao_auto_count,
      danjiao_driver_count,
      CASE WHEN danjiao_auto_count = 0 THEN 0
        ELSE ROUND(danjiao_driver_count * 100.0 / danjiao_auto_count, 2)
      END AS danjiao_rate,
      -- 交三
      jiaosan_auto_count,
      jiaosan_driver_count,
      CASE WHEN jiaosan_auto_count = 0 THEN 0
        ELSE ROUND(jiaosan_driver_count * 100.0 / jiaosan_auto_count, 2)
      END AS jiaosan_rate,
      -- 主全
      zhuquan_auto_count,
      zhuquan_driver_count,
      CASE WHEN zhuquan_auto_count = 0 THEN 0
        ELSE ROUND(zhuquan_driver_count * 100.0 / zhuquan_auto_count, 2)
      END AS zhuquan_rate,
      -- 总推介率
      CASE WHEN total_auto_count = 0 THEN 0
        ELSE ROUND(total_driver_count * 100.0 / total_auto_count, 2)
      END AS total_rate
    FROM cross_sell_base
    ORDER BY total_auto_count DESC
  `;

  logger.debug('Generated cross-sell SQL', { sqlLength: sql.length });
  return sql;
}
