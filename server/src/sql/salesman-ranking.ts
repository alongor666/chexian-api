// B301: 优质业务定义统一到单一事实源（以 kpi/trend 口径为准，业务确认 2026-05-31）。
// ⚠️ 口径变更：此前本模块用「网约车/出租车等营业客车」口径，现统一为「非营业客车」口径，
// 业务员优质业务排名结果会随之变化。生产数值须本地 Parquet 直查对账后再发布。
import { QUALITY_BUSINESS_CONDITION } from './shared/business-conditions.js';

/**
 * 业务员全部业务 TopN 排名查询
 */
export function generateSalesmanAllBusinessRankingQuery(
  whereClause: string,
  limit: number = 10
): string {
  return `
    SELECT
      salesman_name,
      org_level_3,
      SUM(premium) as total_premium,
      COUNT(*) as policy_count
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY salesman_name, org_level_3
    ORDER BY total_premium DESC
    LIMIT ${limit}
  `;
}

/**
 * 业务员优质业务 TopN 排名查询（按优质业务保费排序）
 */
export function generateSalesmanQualityBusinessRankingQuery(
  whereClause: string,
  limit: number = 10
): string {
  return `
    SELECT
      salesman_name,
      org_level_3,
      SUM(premium) as total_premium,
      COUNT(*) as policy_count
    FROM PolicyFact
    WHERE ${whereClause}
      AND ${QUALITY_BUSINESS_CONDITION}
    GROUP BY salesman_name, org_level_3
    ORDER BY total_premium DESC
    LIMIT ${limit}
  `;
}
