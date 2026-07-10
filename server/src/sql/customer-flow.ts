/**
 * 客户来源去向分析 SQL 生成器
 *
 * 数据源：CustomerFlow VIEW（派生自 PolicyFact，BACKLOG 86d10f）
 *   - 业务字段：policy_no / insurance_start_date / previous_insurer / next_insurer
 *   - RLS 字段：org_level_3 / branch_code / is_telemarketing
 *   - 业务上 2025 保单含 next_insurer + 2026 保单含 previous_insurer 即全集
 * 核心分析：转入分析（从哪家转入华安）+ 流失分析（流向哪家竞争公司）
 *
 * RLS：所有生成器接 whereClause 入参，路由层从 parseFiltersAndBuildWhere 取值。
 */

/** 转入分析：上年承保主体 → 华安 */
export interface CustomerFlowFilters {
  year?: number;
  direction?: 'inflow' | 'outflow';
}

/** 年份过滤用日期范围比较（保住 zonemap 剪枝），与 YEAR(col)=N 语义等价（NULL 行两种写法均被过滤） */
function yearRangeClause(year: number): string {
  const y = Math.trunc(year);
  return `AND CAST(insurance_start_date AS DATE) BETWEEN DATE '${y}-01-01' AND DATE '${y}-12-31'`;
}

export function generateInflowQuery(filters: CustomerFlowFilters, whereClause: string = '1=1'): string {
  const yearClause = filters.year
    ? yearRangeClause(Number(filters.year))
    : '';
  return `
    SELECT
      previous_insurer AS insurer,
      COUNT(*) AS policy_count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS share_pct
    FROM CustomerFlow
    WHERE previous_insurer IS NOT NULL
      AND TRIM(previous_insurer) != ''
      AND previous_insurer NOT LIKE '%华安%'
      ${yearClause}
      AND (${whereClause})
    GROUP BY previous_insurer
    ORDER BY policy_count DESC
    LIMIT 20
  `.trim();
}

/** 流失分析：华安 → 次年保险公司 */
export function generateOutflowQuery(filters: CustomerFlowFilters, whereClause: string = '1=1'): string {
  const yearClause = filters.year
    ? yearRangeClause(Number(filters.year))
    : '';
  return `
    SELECT
      next_insurer AS insurer,
      COUNT(*) AS policy_count,
      ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS share_pct
    FROM CustomerFlow
    WHERE next_insurer IS NOT NULL
      AND TRIM(next_insurer) != ''
      AND next_insurer NOT LIKE '%华安%'
      ${yearClause}
      AND (${whereClause})
    GROUP BY next_insurer
    ORDER BY policy_count DESC
    LIMIT 20
  `.trim();
}

/** 月度流失趋势 */
export function generateFlowTrendQuery(filters: CustomerFlowFilters, whereClause: string = '1=1'): string {
  const yearClause = filters.year
    ? yearRangeClause(Number(filters.year))
    : '';
  return `
    SELECT
      STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS month,
      COUNT(*) AS total_policies,
      COUNT(CASE WHEN previous_insurer IS NOT NULL AND TRIM(previous_insurer) != '' AND previous_insurer NOT LIKE '%华安%' THEN 1 END) AS inflow_count,
      COUNT(CASE WHEN next_insurer IS NOT NULL AND TRIM(next_insurer) != '' AND next_insurer NOT LIKE '%华安%' THEN 1 END) AS outflow_count
    FROM CustomerFlow
    WHERE insurance_start_date IS NOT NULL
      ${yearClause}
      AND (${whereClause})
    GROUP BY month
    ORDER BY month
  `.trim();
}

/** 总览统计 */
export function generateFlowSummaryQuery(filters: CustomerFlowFilters, whereClause: string = '1=1'): string {
  const yearClause = filters.year
    ? yearRangeClause(Number(filters.year))
    : '';
  return `
    SELECT
      COUNT(*) AS total_policies,
      COUNT(CASE WHEN previous_insurer IS NOT NULL AND TRIM(previous_insurer) != '' THEN 1 END) AS has_previous,
      COUNT(CASE WHEN previous_insurer IS NOT NULL AND TRIM(previous_insurer) != '' AND previous_insurer NOT LIKE '%华安%' THEN 1 END) AS inflow_count,
      COUNT(CASE WHEN next_insurer IS NOT NULL AND TRIM(next_insurer) != '' THEN 1 END) AS has_next,
      COUNT(CASE WHEN next_insurer IS NOT NULL AND TRIM(next_insurer) != '' AND next_insurer NOT LIKE '%华安%' THEN 1 END) AS outflow_count,
      COUNT(CASE WHEN previous_insurer LIKE '%华安%' THEN 1 END) AS self_renewal_count
    FROM CustomerFlow
    WHERE 1=1 ${yearClause}
      AND (${whereClause})
  `.trim();
}

/** 元数据：可用年份 */
export function generateFlowMetadataQuery(whereClause: string = '1=1'): string {
  return `
    SELECT
      CAST(MIN(CAST(insurance_start_date AS DATE)) AS VARCHAR) AS min_date,
      CAST(MAX(CAST(insurance_start_date AS DATE)) AS VARCHAR) AS max_date,
      array_agg(DISTINCT YEAR(CAST(insurance_start_date AS DATE)) ORDER BY YEAR(CAST(insurance_start_date AS DATE))) AS years,
      COUNT(*) AS total_rows
    FROM CustomerFlow
    WHERE insurance_start_date IS NOT NULL
      AND (${whereClause})
  `.trim();
}
