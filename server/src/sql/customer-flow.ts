/**
 * 客户来源去向分析 SQL 生成器
 *
 * 数据源：CustomerFlow VIEW（4列：保单号/保险起期/车架号/次年保险公司）
 * 核心分析：按车架号识别续保客户流失到哪家公司
 */

import { escapeSqlValue } from '../utils/security.js';

export interface CustomerFlowFilters {
  year?: number;
  direction?: 'inflow' | 'outflow';
}

/** 转入分析已废弃：当前源仅保留次年保险公司。保留空结果以兼容旧端点。 */
export function generateInflowQuery(filters: CustomerFlowFilters): string {
  void filters;
  return `
    SELECT
      CAST(NULL AS VARCHAR) AS insurer,
      CAST(NULL AS BIGINT) AS policy_count,
      CAST(NULL AS DOUBLE) AS share_pct
    WHERE FALSE
  `.trim();
}

/** 流失分析：按车架号去重，统计续保客户流向的次年保险公司 */
export function generateOutflowQuery(filters: CustomerFlowFilters): string {
  const yearClause = filters.year
    ? `AND YEAR(CAST(insurance_start_date AS DATE)) = ${Number(filters.year)}`
    : '';
  return `
    WITH vin_latest AS (
      SELECT vehicle_frame_no, NULLIF(TRIM(next_insurer), '') AS next_insurer
      FROM (
        SELECT
          TRIM(vehicle_frame_no) AS vehicle_frame_no,
          next_insurer,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(vehicle_frame_no)
            ORDER BY CAST(insurance_start_date AS DATE) DESC NULLS LAST, policy_no DESC NULLS LAST
          ) AS rn
        FROM CustomerFlow
        WHERE vehicle_frame_no IS NOT NULL
          AND TRIM(vehicle_frame_no) != ''
          ${yearClause}
      ) WHERE rn = 1
    )
    SELECT
      next_insurer AS insurer,
      COUNT(*) AS policy_count,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS share_pct
    FROM vin_latest
    WHERE next_insurer IS NOT NULL
      AND next_insurer NOT LIKE '%华安%'
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
    WITH monthly_vin AS (
      SELECT month, vehicle_frame_no, NULLIF(TRIM(next_insurer), '') AS next_insurer
      FROM (
        SELECT
          STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS month,
          TRIM(vehicle_frame_no) AS vehicle_frame_no,
          next_insurer,
          ROW_NUMBER() OVER (
            PARTITION BY STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m'), TRIM(vehicle_frame_no)
            ORDER BY CAST(insurance_start_date AS DATE) DESC NULLS LAST, policy_no DESC NULLS LAST
          ) AS rn
        FROM CustomerFlow
        WHERE insurance_start_date IS NOT NULL
          AND vehicle_frame_no IS NOT NULL
          AND TRIM(vehicle_frame_no) != ''
          ${yearClause}
      ) WHERE rn = 1
    )
    SELECT
      month,
      COUNT(*) AS total_policies,
      CAST(NULL AS BIGINT) AS inflow_count,
      COUNT(CASE WHEN next_insurer IS NOT NULL AND next_insurer NOT LIKE '%华安%' THEN 1 END) AS outflow_count
    FROM monthly_vin
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
    WITH vin_latest AS (
      SELECT vehicle_frame_no, NULLIF(TRIM(next_insurer), '') AS next_insurer
      FROM (
        SELECT
          TRIM(vehicle_frame_no) AS vehicle_frame_no,
          next_insurer,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(vehicle_frame_no)
            ORDER BY CAST(insurance_start_date AS DATE) DESC NULLS LAST, policy_no DESC NULLS LAST
          ) AS rn
        FROM CustomerFlow
        WHERE vehicle_frame_no IS NOT NULL
          AND TRIM(vehicle_frame_no) != ''
          ${yearClause}
      ) WHERE rn = 1
    )
    SELECT
      COUNT(*) AS total_policies,
      CAST(NULL AS BIGINT) AS has_previous,
      CAST(NULL AS BIGINT) AS inflow_count,
      COUNT(CASE WHEN next_insurer IS NOT NULL THEN 1 END) AS has_next,
      COUNT(CASE WHEN next_insurer IS NOT NULL AND next_insurer NOT LIKE '%华安%' THEN 1 END) AS outflow_count,
      CAST(NULL AS BIGINT) AS self_renewal_count
    FROM vin_latest
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
