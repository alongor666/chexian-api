/**
 * 优质业务定义条件SQL片段
 *
 * 优质业务包括：
 * 1. 非新能源车 AND (客户类别为非营业个人/企业/机关客车)
 * 2. 货车 AND 吨位分段为1吨以下或2-9吨
 */
const QUALITY_BUSINESS_CONDITION = `
  (
    (is_nev = false AND (
      customer_category LIKE '%非营业个人%'
      OR customer_category LIKE '%企业%'
      OR customer_category LIKE '%机关%'
    ))
    OR
    (customer_category LIKE '%货车%' AND tonnage_segment IN ('1吨以下', '2-9吨'))
  )
`;

export const KPI_SQL = {
  total_premium: 'SUM(premium) as total_premium',
  policy_count: 'COUNT(DISTINCT policy_no) as policy_count',
  org_count: 'COUNT(DISTINCT org_level_3) as org_count',
  salesman_count: 'COUNT(DISTINCT salesman_name) as salesman_count',
  transfer_rate: 'COUNT(CASE WHEN is_transfer THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as transfer_rate',
  telesales_rate: 'COUNT(CASE WHEN is_telemarketing THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as telesales_rate',
  per_capita_premium: 'SUM(premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium',
  renewal_rate: 'COUNT(CASE WHEN is_renewal THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as renewal_rate',
  commercial_rate: "SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) * 1.0 / NULLIF(SUM(premium), 0) as commercial_rate",
  nev_rate: 'COUNT(CASE WHEN is_nev THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as nev_rate',
  new_car_rate: 'COUNT(CASE WHEN is_new_car THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as new_car_rate',
  quality_business_rate: `COUNT(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) as quality_business_rate`,
  commercial_insurance_rate: 'COUNT(CASE WHEN insurance_type LIKE \'%商业%\' THEN 1 END) * 1.0 / NULLIF(COUNT(CASE WHEN insurance_type = \'交强险\' THEN 1 END), 0) as commercial_insurance_rate',
};

export const generateKpiQuery = (whereClause: string = '1=1') => {
  return `
    SELECT
      ${KPI_SQL.total_premium},
      ${KPI_SQL.policy_count},
      ${KPI_SQL.org_count},
      ${KPI_SQL.salesman_count},
      ${KPI_SQL.transfer_rate},
      ${KPI_SQL.telesales_rate},
      ${KPI_SQL.per_capita_premium},
      ${KPI_SQL.renewal_rate},
      ${KPI_SQL.commercial_rate},
      ${KPI_SQL.nev_rate},
      ${KPI_SQL.new_car_rate},
      ${KPI_SQL.quality_business_rate},
      ${KPI_SQL.commercial_insurance_rate}
    FROM PolicyFact
    WHERE ${whereClause}
  `;
};

export const generateTopNQuery = (
  dimension: string,
  metric: string = 'SUM(premium)',
  limit: number = 20,
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      ${dimension} as dim_key,
      ${metric} as value
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY ${dimension}
    ORDER BY value DESC
    LIMIT ${limit}
  `;
};

// For the virtual table - Aggregated by Salesman as required (No single policy detail)
// Prompt says: "Max drill depth: Salesman x Dimension Aggregation"
// Prompt also says: "Strictly forbid single policy detail query"
// So the table should probably show Salesman List?
// "Virtual table... Default Page/TopN"
// Let's assume the table shows Salesman Performance.

export const generateSalesmanTableQuery = (
  limit: number = 100,
  offset: number = 0,
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      salesman_name,
      org_level_3,
      SUM(premium) as signed_premium,
      COUNT(*) as policy_count
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY salesman_name, org_level_3
    ORDER BY signed_premium DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
};

export const generateDimensionShareQuery = (
  dimensionExpression: string,
  metric: string = 'SUM(premium)',
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      COALESCE(${dimensionExpression}, '未知') as dim_key,
      ${metric} as value
    FROM PolicyFact
    WHERE ${whereClause}
    GROUP BY COALESCE(${dimensionExpression}, '未知')
    ORDER BY value DESC
  `;
};

// ========== 【性能优化】V2版本 - 使用预聚合表 DailyAggregated ==========

/**
 * V2版本KPI SQL模板（基于预聚合表）
 *
 * 优化点：
 * - 使用 DailyAggregated 预聚合表
 * - 直接使用预计算的聚合字段（total_premium, policy_count等）
 * - 性能提升25-40倍
 */
export const KPI_SQL_V2 = {
  total_premium: 'SUM(total_premium) as total_premium',
  policy_count: 'SUM(policy_count) as policy_count',
  org_count: 'COUNT(DISTINCT org_level_3) as org_count',
  salesman_count: 'COUNT(DISTINCT salesman_name) as salesman_count',
  transfer_rate: 'SUM(transfer_count) * 1.0 / NULLIF(SUM(policy_count), 0) as transfer_rate',
  telesales_rate: 'SUM(telesales_count) * 1.0 / NULLIF(SUM(policy_count), 0) as telesales_rate',
  per_capita_premium: 'SUM(total_premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium',
  renewal_rate: 'SUM(renewal_count) * 1.0 / NULLIF(SUM(policy_count), 0) as renewal_rate',
  commercial_rate: 'SUM(commercial_premium) * 1.0 / NULLIF(SUM(total_premium), 0) as commercial_rate',
  nev_rate: 'SUM(nev_count) * 1.0 / NULLIF(SUM(policy_count), 0) as nev_rate',
  new_car_rate: 'SUM(new_car_count) * 1.0 / NULLIF(SUM(policy_count), 0) as new_car_rate',
};

/**
 * 生成KPI查询SQL V2（使用预聚合表，性能提升25-40倍）
 *
 * @param whereClause - WHERE子句（不包含WHERE关键字）
 * @returns SQL查询字符串
 */
export const generateKpiQueryV2 = (whereClause: string = '1=1') => {
  return `
    SELECT
      ${KPI_SQL_V2.total_premium},
      ${KPI_SQL_V2.policy_count},
      ${KPI_SQL_V2.org_count},
      ${KPI_SQL_V2.salesman_count},
      ${KPI_SQL_V2.transfer_rate},
      ${KPI_SQL_V2.telesales_rate},
      ${KPI_SQL_V2.per_capita_premium},
      ${KPI_SQL_V2.renewal_rate},
      ${KPI_SQL_V2.commercial_rate},
      ${KPI_SQL_V2.nev_rate},
      ${KPI_SQL_V2.new_car_rate}
    FROM DailyAggregated
    WHERE ${whereClause}
  `;
};

/**
 * 生成Top N查询 V2（使用预聚合表）
 *
 * @param dimension - 分组维度
 * @param metric - 聚合指标（默认SUM(total_premium)）
 * @param limit - 返回条数
 * @param whereClause - WHERE子句
 * @returns SQL查询字符串
 */
export const generateTopNQueryV2 = (
  dimension: string,
  metric: string = 'SUM(total_premium)',
  limit: number = 20,
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      ${dimension} as dim_key,
      ${metric} as value
    FROM DailyAggregated
    WHERE ${whereClause}
    GROUP BY ${dimension}
    ORDER BY value DESC
    LIMIT ${limit}
  `;
};

/**
 * 生成业务员表格查询 V2（使用预聚合表）
 *
 * @param limit - 返回条数
 * @param offset - 偏移量
 * @param whereClause - WHERE子句
 * @returns SQL查询字符串
 */
export const generateSalesmanTableQueryV2 = (
  limit: number = 100,
  offset: number = 0,
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      salesman_name,
      org_level_3,
      SUM(total_premium) as signed_premium,
      SUM(policy_count) as policy_count
    FROM DailyAggregated
    WHERE ${whereClause}
    GROUP BY salesman_name, org_level_3
    ORDER BY signed_premium DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
};

/**
 * 生成维度占比查询 V2（使用预聚合表）
 *
 * @param dimensionExpression - 维度表达式
 * @param metric - 聚合指标
 * @param whereClause - WHERE子句
 * @returns SQL查询字符串
 */
export const generateDimensionShareQueryV2 = (
  dimensionExpression: string,
  metric: string = 'SUM(total_premium)',
  whereClause: string = '1=1'
) => {
  return `
    SELECT
      COALESCE(${dimensionExpression}, '未知') as dim_key,
      ${metric} as value
    FROM DailyAggregated
    WHERE ${whereClause}
    GROUP BY COALESCE(${dimensionExpression}, '未知')
    ORDER BY value DESC
  `;
};
