const QUALITY_BUSINESS_CONDITION = `
  (
    (customer_category LIKE '%网约车%' AND insurance_type = '商业保险')
    OR
    (customer_category LIKE '%出租车%' AND insurance_type = '商业保险')
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )
`;

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
