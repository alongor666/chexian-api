/**
 * 客户来源去向分析 SQL 生成器
 *
 * 数据源：CustomerFlow VIEW（5列：保单号/保险起期/车架号/上年承保主体/次年保险公司）
 * 核心分析：转入分析（从哪家转入华安）+ 流失分析（流向哪家竞争公司）
 */

import { escapeSqlValue } from '../utils/security.js';

export interface CustomerFlowFilters {
  year?: number;
}

/** 转入分析：上年承保主体 → 华安 */
export function generateInflowQuery(filters: CustomerFlowFilters): string {
  const yearClause = filters.year
    ? `AND YEAR(CAST(insurance_start_date AS DATE)) = ${Number(filters.year)}`
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
    GROUP BY previous_insurer
    ORDER BY policy_count DESC
    LIMIT 20
  `.trim();
}

/** 流失分析：华安 → 次年保险公司 */
export function generateOutflowQuery(filters: CustomerFlowFilters): string {
  const yearClause = filters.year
    ? `AND YEAR(CAST(insurance_start_date AS DATE)) = ${Number(filters.year)}`
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
    GROUP BY next_insurer
    ORDER BY policy_count DESC
    LIMIT 20
  `.trim();
}

/** 月度流失趋势 */
export function generateFlowTrendQuery(filters: CustomerFlowFilters): string {
  const yearClause = filters.year
    ? `AND YEAR(CAST(insurance_start_date AS DATE)) = ${Number(filters.year)}`
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
    GROUP BY month
    ORDER BY month
  `.trim();
}

/** 总览统计 */
export function generateFlowSummaryQuery(filters: CustomerFlowFilters): string {
  const yearClause = filters.year
    ? `AND YEAR(CAST(insurance_start_date AS DATE)) = ${Number(filters.year)}`
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
  `.trim();
}

/** 元数据：可用年份 */
export function generateFlowMetadataQuery(): string {
  return `
    SELECT
      CAST(MIN(CAST(insurance_start_date AS DATE)) AS VARCHAR) AS min_date,
      CAST(MAX(CAST(insurance_start_date AS DATE)) AS VARCHAR) AS max_date,
      array_agg(DISTINCT YEAR(CAST(insurance_start_date AS DATE)) ORDER BY YEAR(CAST(insurance_start_date AS DATE))) AS years,
      COUNT(*) AS total_rows
    FROM CustomerFlow
    WHERE insurance_start_date IS NOT NULL
  `.trim();
}
