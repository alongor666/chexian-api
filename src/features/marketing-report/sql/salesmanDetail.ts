/**
 * 业务员明细SQL查询生成器
 *
 * 表二：业务员明细表
 * - 业务员、三级机构、团队、假日车险签单天数、假日天数、假日车险签单比例、
 *   假日商业险签单天数、假日商业险签单比例
 * - 签单比例 = 签单天数 / 节假日天数
 */

import { generateHolidayValuesSql, countHolidaysInRange } from '../utils/holidayUtils';

export interface SalesmanDetailQueryParams {
  /** 日期字段：policy_date | insurance_start_date */
  dateField: 'policy_date' | 'insurance_start_date';
  /** 起始日期 YYYY-MM-DD */
  startDate: string;
  /** 结束日期 YYYY-MM-DD */
  endDate: string;
  /** 分析年度 */
  year: number;
  /** 机构筛选（可选） */
  orgFilter?: string[];
}

/**
 * 生成业务员明细SQL查询
 *
 * 核心逻辑：
 * 1. 从 SalesmanPlanFact 获取业务员的机构和团队信息
 * 2. 统计每个业务员在节假日的车险签单天数
 * 3. 统计每个业务员在节假日的商业险签单天数
 * 4. 计算签单比例 = 签单天数 / 节假日天数
 *
 * 注意：需要先上传业务员保费计划数据以创建 SalesmanPlanFact 视图
 */
export function generateSalesmanDetailQuery(params: SalesmanDetailQueryParams): string {
  const { dateField, startDate, endDate, year, orgFilter } = params;

  // 生成节假日 VALUES SQL
  const holidayValues = generateHolidayValuesSql(startDate, endDate);

  // 计算节假日天数
  const holidayCount = countHolidaysInRange(startDate, endDate);

  // 机构筛选条件（用于 SalesmanPlanFact 的 org_name 字段）
  const orgWhere =
    orgFilter && orgFilter.length > 0
      ? `AND si.org_name IN (${orgFilter.map((o) => `'${o}'`).join(', ')})`
      : '';

  return `
WITH
-- 筛选日期范围内的节假日
holiday_dates AS (
  SELECT CAST(date_str AS DATE) as holiday_date
  FROM (VALUES ${holidayValues}) AS h(date_str)
),

-- 业务员团队信息（从保费计划表获取）
salesman_info AS (
  SELECT DISTINCT
    salesman_name,
    org_name as org_level_3,
    team_name
  FROM SalesmanPlanFact
  WHERE plan_year = ${year}
),

-- 业务员节假日车险签单天数统计
salesman_car_holiday AS (
  SELECT
    p.salesman_name,
    COUNT(DISTINCT CAST(p.${dateField} AS DATE)) as holiday_car_days
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.holiday_date
  WHERE (p.insurance_type LIKE '%交强%' OR p.insurance_type = '交强险')
    AND YEAR(p.${dateField}) = ${year}
    AND p.${dateField} >= '${startDate}'
    AND p.${dateField} <= '${endDate}'
  GROUP BY p.salesman_name
),

-- 业务员节假日商业险签单天数统计
salesman_commercial_holiday AS (
  SELECT
    p.salesman_name,
    COUNT(DISTINCT CAST(p.${dateField} AS DATE)) as holiday_commercial_days
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.holiday_date
  WHERE p.insurance_type = '商业保险'
    AND YEAR(p.${dateField}) = ${year}
    AND p.${dateField} >= '${startDate}'
    AND p.${dateField} <= '${endDate}'
  GROUP BY p.salesman_name
)

-- 最终查询
SELECT
  si.salesman_name,
  si.org_level_3,
  COALESCE(si.team_name, '未分配团队') as team_name,
  COALESCE(sch.holiday_car_days, 0) as "假日车险签单天数",
  ${holidayCount} as "假日天数",
  COALESCE(sch.holiday_car_days, 0) * 1.0 / NULLIF(${holidayCount}, 0) as "假日车险签单比例",
  COALESCE(scm.holiday_commercial_days, 0) as "假日商业险签单天数",
  COALESCE(scm.holiday_commercial_days, 0) * 1.0 / NULLIF(${holidayCount}, 0) as "假日商业险签单比例"
FROM salesman_info si
LEFT JOIN salesman_car_holiday sch ON si.salesman_name = sch.salesman_name
LEFT JOIN salesman_commercial_holiday scm ON si.salesman_name = scm.salesman_name
WHERE 1=1
  ${orgWhere}
ORDER BY "假日车险签单天数" DESC, "假日商业险签单天数" DESC
`;
}
