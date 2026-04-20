/**
 * 续保追踪 SQL 生成器
 *
 * 数据源：RenewalTrackerFact VIEW（派生域，由 ETL 预计算的 warehouse/fact/renewal_tracker/latest.parquet）
 *
 * 字段：
 *   source_policy_no, vehicle_frame_no, expiry_date, expiry_month, expected_expiry_date,
 *   org_level_3, team_name, salesman_name, customer_category,
 *   coverage_combination, fuel_category, is_nev, is_new_car, is_transfer, is_renewal,
 *   used_transfer_type, renewal_type,
 *   is_renewed, renewed_policy_no, renewed_date,
 *   is_quoted, first_quote_time, quote_count
 *
 * 指标：
 *   A = 应续件数（VIN 去重）
 *   B = 报价件数（cutoff 截至日内）
 *   C = 已续件数（cutoff 截至日内）
 *
 * 输出 24 种层级（一次 GROUPING SETS 查询）：
 *   基础层（4）：overall / org / team / salesman
 *   维度层（4 层 × 5 维度 = 20）：
 *     {level}_{dim} 其中 level ∈ {overall, org, team, salesman}，
 *     dim ∈ {category, coverage, fuel, used_transfer, renewal_type}
 */

import { isValidDateFormat } from '../utils/sql-sanitizer.js';

export interface RenewalTrackerQueryParams {
  /** expiry_date 范围起（YYYY-MM-DD） */
  start: string;
  /** expiry_date 范围止（YYYY-MM-DD） */
  end: string;
  /** 报价/续保截至日（YYYY-MM-DD），用于 YTD 视图下的件数切片 */
  cutoff: string;
  /** 非时间 WHERE 片段（org/salesman/category/coverage/fuel/... + 权限过滤），每段独立，由路由层预处理完毕 */
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

  // row_level 判定：基础层 (org/team/salesman grouping) + 维度层 (dim grouping)
  // GROUPING(col)=1 表示该列被聚合（即当前分组未使用此列）
  //
  // 维度判断顺序：先判定基础层（org/team/salesman 粒度），再按 5 个 dim 是否展开决定后缀
  const rowLevelCase = `
    CASE
      WHEN GROUPING(customer_category)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_category'
          WHEN GROUPING(team_name)=1 THEN 'org_category'
          WHEN GROUPING(salesman_name)=1 THEN 'team_category'
          ELSE 'salesman_category'
        END
      WHEN GROUPING(coverage_combination)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_coverage'
          WHEN GROUPING(team_name)=1 THEN 'org_coverage'
          WHEN GROUPING(salesman_name)=1 THEN 'team_coverage'
          ELSE 'salesman_coverage'
        END
      WHEN GROUPING(fuel_category)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_fuel'
          WHEN GROUPING(team_name)=1 THEN 'org_fuel'
          WHEN GROUPING(salesman_name)=1 THEN 'team_fuel'
          ELSE 'salesman_fuel'
        END
      WHEN GROUPING(used_transfer_type)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_used_transfer'
          WHEN GROUPING(team_name)=1 THEN 'org_used_transfer'
          WHEN GROUPING(salesman_name)=1 THEN 'team_used_transfer'
          ELSE 'salesman_used_transfer'
        END
      WHEN GROUPING(renewal_type)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_renewal_type'
          WHEN GROUPING(team_name)=1 THEN 'org_renewal_type'
          WHEN GROUPING(salesman_name)=1 THEN 'team_renewal_type'
          ELSE 'salesman_renewal_type'
        END
      ELSE
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall'
          WHEN GROUPING(team_name)=1 THEN 'org'
          WHEN GROUPING(salesman_name)=1 THEN 'team'
          ELSE 'salesman'
        END
    END AS row_level`;

  return `
    SELECT
      ${rowLevelCase.trim()},
      org_level_3,
      team_name,
      salesman_name,
      customer_category,
      coverage_combination,
      fuel_category,
      used_transfer_type,
      renewal_type,
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
      (org_level_3, customer_category),
      (org_level_3, team_name, customer_category),
      (org_level_3, team_name, salesman_name, customer_category),
      (coverage_combination),
      (org_level_3, coverage_combination),
      (org_level_3, team_name, coverage_combination),
      (org_level_3, team_name, salesman_name, coverage_combination),
      (fuel_category),
      (org_level_3, fuel_category),
      (org_level_3, team_name, fuel_category),
      (org_level_3, team_name, salesman_name, fuel_category),
      (used_transfer_type),
      (org_level_3, used_transfer_type),
      (org_level_3, team_name, used_transfer_type),
      (org_level_3, team_name, salesman_name, used_transfer_type),
      (renewal_type),
      (org_level_3, renewal_type),
      (org_level_3, team_name, renewal_type),
      (org_level_3, team_name, salesman_name, renewal_type)
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
