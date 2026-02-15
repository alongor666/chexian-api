/**
 * 营销战报 SQL 生成器
 *
 * 生成假日营销分析相关的 SQL：
 * - 机构级假日签单统计（开单率、保费）
 * - 业务员级签单天数明细
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('MarketingReportSQL');

/**
 * 生成节假日日期 VALUES 子句
 */
function buildHolidayDateValues(holidayDates: string[]): string {
  if (holidayDates.length === 0) {
    return "('1900-01-01')";
  }
  return holidayDates.map(d => `('${d}')`).join(', ');
}

/**
 * 机构级假日签单统计
 *
 * 返回每个机构在假日期间的：
 * - 车险保费、商业险保费
 * - 车险开单率（有出单的业务员数 / 总业务员数）
 * - 商业险开单率
 */
export function generateOrgHolidayReportQuery(
  whereClause: string,
  holidayDates: string[],
  dateField: string = 'policy_date'
): string {
  const holidayValues = buildHolidayDateValues(holidayDates);

  logger.debug('Generating org holiday report SQL', {
    holidayCount: holidayDates.length,
    dateField,
  });

  return `
    WITH holiday_dates AS (
      SELECT CAST(col0 AS DATE) AS holiday_date
      FROM (VALUES ${holidayValues}) AS t(col0)
    ),
    -- 假日期间的签单数据
    holiday_policies AS (
      SELECT *
      FROM PolicyFact p
      WHERE ${whereClause}
        AND CAST(${dateField} AS DATE) IN (SELECT holiday_date FROM holiday_dates)
    ),
    -- 各机构总业务员数（全量数据）
    org_salesman_total AS (
      SELECT
        org_level_3,
        COUNT(DISTINCT salesman_name) AS total_salesman
      FROM PolicyFact
      WHERE ${whereClause}
      GROUP BY org_level_3
    ),
    -- 假日签单汇总
    org_holiday_stats AS (
      SELECT
        org_level_3,
        -- 车险保费（万元）
        COALESCE(SUM(premium), 0) / 10000.0 AS 车险保费,
        -- 商业险保费（万元）
        COALESCE(SUM(CASE WHEN is_commercial_insure = '套单' OR is_commercial_insure = '是' THEN premium ELSE 0 END), 0) / 10000.0 AS 商业险保费,
        -- 假日车险出单人数
        COUNT(DISTINCT salesman_name) AS 车险出单人数,
        -- 假日商业险出单人数
        COUNT(DISTINCT CASE WHEN is_commercial_insure = '套单' OR is_commercial_insure = '是' THEN salesman_name END) AS 商业险出单人数
      FROM holiday_policies
      GROUP BY org_level_3
    )
    SELECT
      h.org_level_3,
      COALESCE(h.车险保费, 0) AS 车险保费,
      COALESCE(h.商业险保费, 0) AS 商业险保费,
      COALESCE(t.total_salesman, 0) AS 总业务员数,
      COALESCE(h.车险出单人数, 0) AS 车险出单人数,
      COALESCE(h.商业险出单人数, 0) AS 商业险出单人数,
      -- 车险开单率
      CASE WHEN COALESCE(t.total_salesman, 0) = 0 THEN 0
        ELSE COALESCE(h.车险出单人数, 0) * 1.0 / t.total_salesman
      END AS 车险开单率,
      -- 商业险开单率
      CASE WHEN COALESCE(t.total_salesman, 0) = 0 THEN 0
        ELSE COALESCE(h.商业险出单人数, 0) * 1.0 / t.total_salesman
      END AS 商业险开单率
    FROM org_holiday_stats h
    LEFT JOIN org_salesman_total t ON h.org_level_3 = t.org_level_3
    ORDER BY h.车险保费 DESC
  `;
}

/**
 * 业务员级假日签单天数明细
 *
 * 返回每个业务员在假日期间的：
 * - 车险签单天数、商业险签单天数
 * - 各自的签单比例
 */
export function generateSalesmanHolidayDetailQuery(
  whereClause: string,
  holidayDates: string[],
  dateField: string = 'policy_date'
): string {
  const holidayValues = buildHolidayDateValues(holidayDates);
  const totalHolidayDays = holidayDates.length || 1;

  logger.debug('Generating salesman holiday detail SQL', {
    holidayCount: holidayDates.length,
    dateField,
  });

  return `
    WITH holiday_dates AS (
      SELECT CAST(col0 AS DATE) AS holiday_date
      FROM (VALUES ${holidayValues}) AS t(col0)
    ),
    holiday_policies AS (
      SELECT *
      FROM PolicyFact p
      WHERE ${whereClause}
        AND CAST(${dateField} AS DATE) IN (SELECT holiday_date FROM holiday_dates)
    ),
    salesman_stats AS (
      SELECT
        salesman_name,
        org_level_3,
        -- 车险签单天数（有出单的不同日期数）
        COUNT(DISTINCT CAST(${dateField} AS DATE)) AS 假日车险签单天数,
        -- 商业险签单天数
        COUNT(DISTINCT CASE
          WHEN is_commercial_insure = '套单' OR is_commercial_insure = '是'
          THEN CAST(${dateField} AS DATE)
        END) AS 假日商业险签单天数
      FROM holiday_policies
      GROUP BY salesman_name, org_level_3
    )
    SELECT
      salesman_name,
      org_level_3,
      '' AS team_name,
      假日车险签单天数,
      ${totalHolidayDays} AS 假日天数,
      假日车险签单天数 * 1.0 / ${totalHolidayDays} AS 假日车险签单比例,
      假日商业险签单天数,
      假日商业险签单天数 * 1.0 / ${totalHolidayDays} AS 假日商业险签单比例
    FROM salesman_stats
    ORDER BY 假日车险签单天数 DESC
  `;
}
