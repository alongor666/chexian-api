/**
 * 保费报表 SQL 生成器（后端版）
 *
 * 功能：
 * - 按机构汇总保费（商业险/交强险/车险分拆）+ 同比增长
 * - 按业务员汇总保费 + 续保率 + 非过户率（JOIN SalesmanPlanFact 获取团队）
 */

/**
 * 生成机构保费报表查询 SQL
 *
 * 返回：org_level_3, 车险保费, 商业险保费, 交强险保费, 车险件数, 商业险件数, 交强险件数,
 *       人均保费, 业务员数, 同比增长率
 */
export function generateOrgPremiumReportQuery(
  whereClause: string,
  dateField: string = 'policy_date'
): string {
  // 从 whereClause 中提取年份（用于同比计算）
  // 通用思路：用 EXTRACT(YEAR FROM MIN(date)) 从数据中推断
  return `
WITH
-- 当期数据
current_period AS (
  SELECT
    org_level_3,
    SUM(CASE WHEN insurance_type IN ('商业险', '商车统保', '商业险+交强险') THEN premium ELSE 0 END) / 10000 AS 商业险保费,
    SUM(CASE WHEN insurance_type = '交强险' THEN premium ELSE 0 END) / 10000 AS 交强险保费,
    SUM(premium) / 10000 AS 车险保费,
    COUNT(DISTINCT policy_no) AS 车险件数,
    COUNT(DISTINCT CASE WHEN insurance_type IN ('商业险', '商车统保', '商业险+交强险') THEN policy_no END) AS 商业险件数,
    COUNT(DISTINCT CASE WHEN insurance_type = '交强险' THEN policy_no END) AS 交强险件数,
    COUNT(DISTINCT salesman_name) AS 业务员数
  FROM PolicyFact
  WHERE ${whereClause}
  GROUP BY org_level_3
),

-- 推断当期日期范围
date_bounds AS (
  SELECT
    MIN(${dateField}) AS min_date,
    MAX(${dateField}) AS max_date
  FROM PolicyFact
  WHERE ${whereClause}
),

-- 去年同期数据（日期范围整体前移一年）
last_year_period AS (
  SELECT
    org_level_3,
    SUM(premium) / 10000 AS 去年保费
  FROM PolicyFact
  WHERE ${dateField} >= (SELECT CAST(min_date AS DATE) - INTERVAL 1 YEAR FROM date_bounds)
    AND ${dateField} <= (SELECT CAST(max_date AS DATE) - INTERVAL 1 YEAR FROM date_bounds)
    -- 保留非日期维度的筛选条件（机构等）
    AND ${whereClause.replace(/1=1 AND /g, '').replace(new RegExp(`${dateField}\\s*[><=]+\\s*'[^']*'`, 'g'), '1=1')}
  GROUP BY org_level_3
)

SELECT
  c.org_level_3,
  ROUND(c.车险保费, 2) AS "车险保费",
  ROUND(c.商业险保费, 2) AS "商业险保费",
  ROUND(c.交强险保费, 2) AS "交强险保费",
  c.车险件数 AS "车险件数",
  c.商业险件数 AS "商业险件数",
  c.交强险件数 AS "交强险件数",
  CASE
    WHEN c.业务员数 > 0 THEN ROUND(c.车险保费 / c.业务员数, 2)
    ELSE 0
  END AS "人均保费",
  c.业务员数 AS "业务员数",
  CASE
    WHEN l.去年保费 > 0 THEN ROUND((c.车险保费 - l.去年保费) / l.去年保费 * 100, 2)
    ELSE NULL
  END AS "同比增长率"
FROM current_period c
LEFT JOIN last_year_period l ON c.org_level_3 = l.org_level_3
ORDER BY c.车险保费 DESC
  `.trim();
}

/**
 * 生成业务员保费报表查询 SQL
 *
 * 返回：salesman_name, org_level_3, team_name, 车险保费, 商业险保费, 交强险保费,
 *       车险件数, 商业险件数, 交强险件数, 续保率, 非过户率
 */
export function generateSalesmanPremiumReportQuery(
  whereClause: string,
  planYear: number = 2026
): string {
  return `
SELECT
  p.salesman_name,
  p.org_level_3,
  COALESCE(s.team_name, '未分配团队') AS team_name,
  ROUND(SUM(p.premium) / 10000, 2) AS "车险保费",
  ROUND(SUM(CASE WHEN p.insurance_type IN ('商业险', '商车统保', '商业险+交强险') THEN p.premium ELSE 0 END) / 10000, 2) AS "商业险保费",
  ROUND(SUM(CASE WHEN p.insurance_type = '交强险' THEN p.premium ELSE 0 END) / 10000, 2) AS "交强险保费",
  COUNT(DISTINCT p.policy_no) AS "车险件数",
  COUNT(DISTINCT CASE WHEN p.insurance_type IN ('商业险', '商车统保', '商业险+交强险') THEN p.policy_no END) AS "商业险件数",
  COUNT(DISTINCT CASE WHEN p.insurance_type = '交强险' THEN p.policy_no END) AS "交强险件数",
  CASE
    WHEN COUNT(DISTINCT p.policy_no) > 0 THEN
      ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.is_renewal = 1 THEN p.policy_no END) / COUNT(DISTINCT p.policy_no), 2)
    ELSE 0
  END AS "续保率",
  CASE
    WHEN COUNT(DISTINCT p.policy_no) > 0 THEN
      ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.is_transfer = 0 THEN p.policy_no END) / COUNT(DISTINCT p.policy_no), 2)
    ELSE 0
  END AS "非过户率"
FROM PolicyFact p
LEFT JOIN (
  SELECT DISTINCT salesman_name, team_name
  FROM SalesmanPlanFact
  WHERE plan_year = ${planYear}
) s ON p.salesman_name = s.salesman_name
WHERE ${whereClause}
GROUP BY p.salesman_name, p.org_level_3, COALESCE(s.team_name, '未分配团队')
ORDER BY "车险保费" DESC
  `.trim();
}
