/**
 * 业绩分析 SQL 生成器 — 趋势查询
 *
 * 包含：
 * - generatePerformanceTrendQuery() — 按时间粒度（日/周/月）分组的趋势查询
 */

import { logger } from '../../utils/logger.js';
import {
  segmentTagExpr,
  getPerformanceSegmentFilter,
  trendTimeGroupExpr,
  getTrendLineSourceSql,
  type PerformanceSegmentTag,
  type PerformanceTrendGranularity,
} from './shared.js';

export function generatePerformanceTrendQuery(
  whereWithDate: string,
  segmentTag: PerformanceSegmentTag,
  granularity: PerformanceTrendGranularity,
  dateField: string = 'policy_date'
): string {
  const selectedFilter = getPerformanceSegmentFilter(segmentTag);
  const timeExpr = trendTimeGroupExpr(granularity);
  const lineSourceSql = getTrendLineSourceSql(segmentTag);

  const sql = `
    WITH base_rows AS (
      SELECT
        CAST(${dateField} AS DATE) AS pd,
        COALESCE(
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), '')
        ) AS policy_key,
        NULLIF(TRIM(CAST(endorsement_no AS VARCHAR)), '') IS NOT NULL AS is_endorsement,
        COALESCE(premium, 0) / 10000.0 AS premium_wan,
        COALESCE(TRIM(CAST(customer_category AS VARCHAR)), '') AS customer_category,
        COALESCE(NULLIF(TRIM(CAST(tonnage_segment AS VARCHAR)), ''), '未知') AS norm_tonnage,
        ${segmentTagExpr()} AS segment_tag
      FROM PolicyFact
      WHERE ${whereWithDate}
    ),
    selected_rows AS (
      SELECT *
      FROM base_rows
      WHERE ${selectedFilter}
    ),
    line_source AS (
      ${lineSourceSql}
    )
    SELECT
      ${timeExpr} AS time_period,
      line_key,
      line_label,
      line_order,
      ROUND(SUM(premium_wan), 4) AS premium,
      COUNT(DISTINCT CASE WHEN NOT is_endorsement THEN policy_key END) AS auto_count
    FROM line_source
    GROUP BY time_period, line_key, line_label, line_order
    ORDER BY time_period, line_order
  `;

  logger.debug('Generated performance trend SQL', {
    segmentTag,
    granularity,
    sqlLength: sql.length,
  });
  return sql;
}
