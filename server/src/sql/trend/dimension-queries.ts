/**
 * 保费趋势分析 SQL 生成器 — 机构列表与维度选项查询
 *
 * 从 trend.ts 提取的维度辅助查询函数。
 */

/**
 * 生成机构列表查询SQL
 * 用于获取所有唯一的三级机构
 *
 * @param whereClause - WHERE子句
 * @returns SQL查询字符串
 */
export function generateOrgListQuery(whereClause: string = '1=1'): string {
  return `
    SELECT DISTINCT org_level_3
    FROM PolicyFact
    WHERE ${whereClause}
    ORDER BY org_level_3
  `;
}

/**
 * 生成维度选项查询SQL（带计数）
 * 用于填充筛选面板的下拉选项
 *
 * @param dimension - 维度字段名
 * @returns SQL查询字符串，返回 value 和 count 字段
 */
export function generateDimensionOptionsQuery(dimension: string): string {
  return `
    SELECT
      ${dimension} AS value,
      COUNT(*) AS count
    FROM PolicyFact
    WHERE ${dimension} IS NOT NULL
    GROUP BY ${dimension}
    ORDER BY 2 DESC, 1
  `;
}
