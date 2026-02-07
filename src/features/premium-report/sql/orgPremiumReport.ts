/**
 * 机构保费报表 SQL 生成器
 *
 * 功能：
 * - 按机构汇总保费数据
 * - 支持日期口径筛选（签单/起保）
 * - 支持机构筛选
 * - 计算关键指标（保费、件数、同比增长率）
 */

interface OrgPremiumReportQueryOptions {
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
 * 生成机构保费报表查询 SQL
 *
 * 返回字段：
 * - org_level_3: 三级机构名称
 * - 车险保费: 车险总保费（万元）
 * - 商业险保费: 商业险保费（万元）
 * - 交强险保费: 交强险保费（万元）
 * - 车险件数: 车险保单件数
 * - 商业险件数: 商业险保单件数
 * - 交强险件数: 交强险保单件数
 * - 人均保费: 人均车险保费（万元）
 * - 业务员数: 业务员数量
 * - 同比增长率: 同比增长率（%）
 */
export function generateOrgPremiumReportQuery(
  options: OrgPremiumReportQueryOptions
): string {
  const { dateField, startDate, endDate, year, orgFilter } = options;

  // 日期条件
  const dateCondition = `${dateField} >= '${startDate}' AND ${dateField} <= '${endDate}'`;

  // 机构筛选条件
  const orgCondition = orgFilter && orgFilter.length > 0
    ? `AND org_level_3 IN (${orgFilter.map((v) => `'${v}'`).join(', ')})`
    : '';

  // 去年同期日期范围
  const lastYearStartDate = startDate.replace(/\d{4}/, String(year - 1));
  const lastYearEndDate = endDate.replace(/\d{4}/, String(year - 1));
  const lastYearDateCondition = `${dateField} >= '${lastYearStartDate}' AND ${dateField} <= '${lastYearEndDate}'`;

  return `
-- 机构保费报表
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
  WHERE ${dateCondition}
    ${orgCondition}
  GROUP BY org_level_3
),

-- 去年同期数据
last_year_period AS (
  SELECT
    org_level_3,
    SUM(premium) / 10000 AS 去年保费
  FROM PolicyFact
  WHERE ${lastYearDateCondition}
    ${orgCondition}
  GROUP BY org_level_3
)

SELECT
  c.org_level_3,
  ROUND(c.车险保费, 2) AS 车险保费,
  ROUND(c.商业险保费, 2) AS 商业险保费,
  ROUND(c.交强险保费, 2) AS 交强险保费,
  c.车险件数,
  c.商业险件数,
  c.交强险件数,
  CASE
    WHEN c.业务员数 > 0 THEN ROUND(c.车险保费 / c.业务员数, 2)
    ELSE 0
  END AS 人均保费,
  c.业务员数,
  CASE
    WHEN l.去年保费 > 0 THEN ROUND((c.车险保费 - l.去年保费) / l.去年保费 * 100, 2)
    ELSE NULL
  END AS 同比增长率
FROM current_period c
LEFT JOIN last_year_period l ON c.org_level_3 = l.org_level_3
ORDER BY c.车险保费 DESC;
  `.trim();
}

/**
 * 生成业务员保费报表查询 SQL
 *
 * 返回字段：
 * - salesman_name: 业务员姓名
 * - org_level_3: 所属机构
 * - team_name: 所属团队
 * - 车险保费: 车险总保费（万元）
 * - 商业险保费: 商业险保费（万元）
 * - 交强险保费: 交强险保费（万元）
 * - 车险件数: 车险保单件数
 * - 商业险件数: 商业险保单件数
 * - 交强险件数: 交强险保单件数
 * - 续保率: 续保率（%）
 * - 非过户率: 非过户率（%）
 */
export function generateSalesmanPremiumReportQuery(
  options: OrgPremiumReportQueryOptions
): string {
  const { dateField, startDate, endDate, year, orgFilter } = options;

  // 日期条件
  const dateCondition = `p.${dateField} >= '${startDate}' AND p.${dateField} <= '${endDate}'`;

  // 机构筛选条件
  const orgCondition = orgFilter && orgFilter.length > 0
    ? `AND p.org_level_3 IN (${orgFilter.map((v) => `'${v}'`).join(', ')})`
    : '';

  return `
-- 业务员保费报表
SELECT
  p.salesman_name,
  p.org_level_3,
  COALESCE(s.team_name, '未分配团队') AS team_name,
  ROUND(SUM(p.premium) / 10000, 2) AS 车险保费,
  ROUND(SUM(CASE WHEN p.insurance_type IN ('商业险', '商车统保', '商业险+交强险') THEN p.premium ELSE 0 END) / 10000, 2) AS 商业险保费,
  ROUND(SUM(CASE WHEN p.insurance_type = '交强险' THEN p.premium ELSE 0 END) / 10000, 2) AS 交强险保费,
  COUNT(DISTINCT p.policy_no) AS 车险件数,
  COUNT(DISTINCT CASE WHEN p.insurance_type IN ('商业险', '商车统保', '商业险+交强险') THEN p.policy_no END) AS 商业险件数,
  COUNT(DISTINCT CASE WHEN p.insurance_type = '交强险' THEN p.policy_no END) AS 交强险件数,
  CASE
    WHEN COUNT(DISTINCT p.policy_no) > 0 THEN
      ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.is_renewal = 1 THEN p.policy_no END) / COUNT(DISTINCT p.policy_no), 2)
    ELSE 0
  END AS 续保率,
  CASE
    WHEN COUNT(DISTINCT p.policy_no) > 0 THEN
      ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.is_transfer = 0 THEN p.policy_no END) / COUNT(DISTINCT p.policy_no), 2)
    ELSE 0
  END AS 非过户率
FROM PolicyFact p
LEFT JOIN (
  SELECT DISTINCT salesman_name, team_name
  FROM SalesmanPlanFact
  WHERE plan_year = ${year}
) s ON p.salesman_name = s.salesman_name
WHERE ${dateCondition}
  ${orgCondition}
GROUP BY p.salesman_name, p.org_level_3, COALESCE(s.team_name, '未分配团队')
ORDER BY 车险保费 DESC;
  `.trim();
}
