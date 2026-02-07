/**
 * 机构战报SQL查询生成器
 *
 * 表一：机构战报
 * - 三级机构、车险保费、商业险保费、车险开单率、商业险开单率
 * - 开单率 = 节假日有出单业务员数 / 总业务员数
 */

import { generateHolidayValuesSql } from '../utils/holidayUtils';

export interface OrgReportQueryParams {
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
 * 生成机构战报SQL查询
 *
 * 核心逻辑：
 * 1. 统计各机构的总业务员数（在筛选时间范围内有签单的）
 * 2. 统计各机构在节假日有车险出单的业务员数
 * 3. 统计各机构在节假日有商业险出单的业务员数
 * 4. 计算开单率 = 节假日出单业务员数 / 总业务员数
 *
 * 险别判断：
 * - 车险：insurance_type 包含 '交强' 或纯车险
 * - 商业险：insurance_type = '商业保险'
 */
export function generateOrgReportQuery(params: OrgReportQueryParams): string {
  const { dateField, startDate, endDate, year, orgFilter } = params;

  // 生成节假日 VALUES SQL
  const holidayValues = generateHolidayValuesSql(startDate, endDate);

  // 基础筛选条件
  const baseWhere = `
    YEAR(${dateField}) = ${year}
    AND ${dateField} >= '${startDate}'
    AND ${dateField} <= '${endDate}'
    ${orgFilter && orgFilter.length > 0 ? `AND org_level_3 IN (${orgFilter.map((o) => `'${o}'`).join(', ')})` : ''}
  `;

  return `
WITH
-- 筛选日期范围内的节假日
holiday_dates AS (
  SELECT CAST(date_str AS DATE) as holiday_date
  FROM (VALUES ${holidayValues}) AS h(date_str)
),

-- 各机构的业务员总数（在筛选时间范围内有签单的）
org_salesmen AS (
  SELECT
    org_level_3,
    COUNT(DISTINCT salesman_name) as total_salesmen
  FROM PolicyFact
  WHERE ${baseWhere}
  GROUP BY org_level_3
),

-- 各机构在节假日的车险出单业务员
org_car_holiday AS (
  SELECT
    p.org_level_3,
    COUNT(DISTINCT p.salesman_name) as car_holiday_salesmen
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.holiday_date
  WHERE (p.insurance_type LIKE '%交强%' OR p.insurance_type = '交强险')
    AND ${baseWhere.replace(/^\s+/gm, '    ')}
  GROUP BY p.org_level_3
),

-- 各机构在节假日的商业险出单业务员
org_commercial_holiday AS (
  SELECT
    p.org_level_3,
    COUNT(DISTINCT p.salesman_name) as commercial_holiday_salesmen
  FROM PolicyFact p
  INNER JOIN holiday_dates h ON CAST(p.${dateField} AS DATE) = h.holiday_date
  WHERE p.insurance_type = '商业保险'
    AND ${baseWhere.replace(/^\s+/gm, '    ')}
  GROUP BY p.org_level_3
),

-- 各机构保费汇总
org_premium AS (
  SELECT
    org_level_3,
    SUM(CASE WHEN insurance_type LIKE '%交强%' OR insurance_type = '交强险' THEN premium ELSE 0 END) as car_premium,
    SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) as commercial_premium
  FROM PolicyFact
  WHERE ${baseWhere}
  GROUP BY org_level_3
)

-- 最终查询
SELECT
  o.org_level_3,
  COALESCE(op.car_premium, 0) / 10000 as "车险保费",
  COALESCE(op.commercial_premium, 0) / 10000 as "商业险保费",
  COALESCE(ch.car_holiday_salesmen, 0) * 1.0 / NULLIF(o.total_salesmen, 0) as "车险开单率",
  COALESCE(cmh.commercial_holiday_salesmen, 0) * 1.0 / NULLIF(o.total_salesmen, 0) as "商业险开单率",
  o.total_salesmen as "总业务员数",
  COALESCE(ch.car_holiday_salesmen, 0) as "车险出单人数",
  COALESCE(cmh.commercial_holiday_salesmen, 0) as "商业险出单人数"
FROM org_salesmen o
LEFT JOIN org_premium op ON o.org_level_3 = op.org_level_3
LEFT JOIN org_car_holiday ch ON o.org_level_3 = ch.org_level_3
LEFT JOIN org_commercial_holiday cmh ON o.org_level_3 = cmh.org_level_3
ORDER BY "车险保费" DESC
`;
}
