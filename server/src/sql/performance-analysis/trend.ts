/**
 * 业绩分析 SQL 生成器 — 趋势查询
 *
 * 包含：
 * - generatePerformanceTrendQuery() — 按时间粒度（日/周/月）分组的趋势查询
 */

import { logger } from '../../utils/logger.js';
import {
  segmentCaseExpr,
  getPerformanceSegmentFilter,
  trendTimeGroupExpr,
  getTrendLineSourceSql,
  type PerformanceSegmentTag,
  type PerformanceTrendGranularity,
} from '../performance-analysis-shared.js';

export function generatePerformanceTrendQuery(
  whereWithDate: string,
  segmentTag: PerformanceSegmentTag,
  granularity: PerformanceTrendGranularity
): string {
  const selectedFilter = getPerformanceSegmentFilter(segmentTag);
  const timeExpr = trendTimeGroupExpr(granularity);
  const lineSourceSql = getTrendLineSourceSql(segmentTag);

  const sql = `
    WITH base_rows AS (
      SELECT
        CAST(policy_date AS DATE) AS pd,
        COALESCE(
          NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''),
          NULLIF(TRIM(CAST(policy_no AS VARCHAR)), '')
        ) AS dedup_key,
        CASE WHEN premium > 0 THEN premium / 10000.0 ELSE 0 END AS premium_wan,
        COALESCE(TRIM(CAST(customer_category AS VARCHAR)), '') AS customer_category,
        COALESCE(NULLIF(TRIM(CAST(tonnage_segment AS VARCHAR)), ''), '未知') AS norm_tonnage,
        ${segmentCaseExpr()} AS segment_tag
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
      COUNT(DISTINCT dedup_key) AS auto_count
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
