/**
 * 续保追踪 SQL 生成器
 *
 * 数据源：RenewalTrackerFact VIEW（派生域，由 ETL 预计算的 warehouse/fact/renewal_tracker/latest.parquet）
 *
 * 字段：source_policy_no, vehicle_frame_no, expiry_date, expiry_month, expected_expiry_date,
 *       org_level_3, team_name, salesman_name, customer_category,
 *       is_renewed, renewed_policy_no, renewed_date,
 *       is_quoted, first_quote_time, quote_count
 *
 * 指标：
 *   A = 应续件数（VIN 去重）
 *   B = 报价件数（cutoff 截至日内）
 *   C = 已续件数（cutoff 截至日内）
 *
 * 输出 6 种层级（一次 GROUPING SETS 查询）：
 *   - overall / org / team / salesman / category / org_category
 */

import { isValidDateFormat } from '../utils/sql-sanitizer.js';

export interface RenewalTrackerQueryParams {
  /** expiry_date 范围起（YYYY-MM-DD） */
  start: string;
  /** expiry_date 范围止（YYYY-MM-DD） */
  end: string;
  /** 报价/续保截至日（YYYY-MM-DD），用于 YTD 视图下的件数切片 */
  cutoff: string;
  /** 非时间 WHERE 片段（org/salesman/category + 权限过滤），每段独立，由路由层预处理完毕 */
  extraConditions?: string[];
}

/**
 * 生成续保追踪主查询 SQL。
 *
 * 安全性：
 *   - 日期参数强制 YYYY-MM-DD 正则校验，否则抛错
 *   - extraConditions 由路由层用 buildInCondition 等安全工具构建，直接拼接
 */
export function generateRenewalTrackerQuery(params: RenewalTrackerQueryParams): string {
  const { start, end, cutoff, extraConditions = [] } = params;

  if (!isValidDateFormat(start)) throw new Error(`Invalid start date: ${start}`);
  if (!isValidDateFormat(end)) throw new Error(`Invalid end date: ${end}`);
  if (!isValidDateFormat(cutoff)) throw new Error(`Invalid cutoff date: ${cutoff}`);

  const whereClauses = [
    `expiry_date >= DATE '${start}'`,
    `expiry_date <= DATE '${end}'`,
    ...extraConditions,
  ];
  const whereSql = whereClauses.join('\n    AND ');

  return `
    SELECT
      CASE
        WHEN GROUPING(org_level_3)=1
         AND GROUPING(team_name)=1
         AND GROUPING(salesman_name)=1
         AND GROUPING(customer_category)=1 THEN 'overall'
        WHEN GROUPING(org_level_3)=1
         AND GROUPING(customer_category)=0 THEN 'category'
        WHEN GROUPING(org_level_3)=0
         AND GROUPING(customer_category)=0 THEN 'org_category'
        WHEN GROUPING(org_level_3)=0
         AND GROUPING(team_name)=1 THEN 'org'
        WHEN GROUPING(team_name)=0
         AND GROUPING(salesman_name)=1 THEN 'team'
        WHEN GROUPING(salesman_name)=0 THEN 'salesman'
      END AS row_level,
      org_level_3,
      team_name,
      salesman_name,
      customer_category,
      COUNT(DISTINCT vehicle_frame_no) AS A,
      COUNT(DISTINCT CASE
        WHEN is_quoted AND first_quote_time <= DATE '${cutoff}' THEN vehicle_frame_no
      END) AS B,
      COUNT(DISTINCT CASE
        WHEN is_renewed AND renewed_date <= DATE '${cutoff}' THEN vehicle_frame_no
      END) AS C
    FROM RenewalTrackerFact
    WHERE ${whereSql}
    GROUP BY GROUPING SETS (
      (),
      (org_level_3),
      (org_level_3, team_name),
      (org_level_3, team_name, salesman_name),
      (customer_category),
      (org_level_3, customer_category)
    )
  `.trim();
}

/**
 * 生成查询元数据的 SQL — universe 统计（暴露数 / 去重 VIN / 日期范围）
 *
 * 供前端在页面顶部展示"数据截至 / Universe 统计"信息。
 */
export function generateRenewalTrackerMetaQuery(): string {
  return `
    SELECT
      COUNT(*) AS exposure_row_count,
      COUNT(DISTINCT vehicle_frame_no) AS distinct_vehicle_count,
      COUNT(DISTINCT source_policy_no) AS distinct_source_policy_count,
      CAST(MAX(GREATEST(
        COALESCE(first_quote_time, DATE '1970-01-01'),
        COALESCE(renewed_date, DATE '1970-01-01')
      )) AS DATE) AS latest_data_date
    FROM RenewalTrackerFact
  `.trim();
}
