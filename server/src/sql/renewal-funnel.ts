/**
 * 续保漏斗 SQL 生成器
 *
 * 数据源：RenewalFunnel 视图（独立于 PolicyFact）
 * 来源：交商同保续保询报价数据 Excel → Parquet
 * 35,011 条到期保单，17 原始字段 + 4 计算字段
 */

export interface RenewalFunnelFilters {
  orgName?: string;
  teamName?: string;
  salesmanName?: string;
  month?: string;
  maturityFilter?: 'mature' | 'pending' | 'all';
  daysRange?: number;
  insuranceGrade?: string;
  actionPriority?: 'P1' | 'P2' | 'P3' | 'P4';
}

function buildWhere(filters: RenewalFunnelFilters): string {
  const conditions: string[] = ['1=1'];

  if (filters.orgName) {
    conditions.push(`org_level_3 = '${filters.orgName.replace(/'/g, "''")}'`);
  }
  if (filters.teamName) {
    conditions.push(`team_name = '${filters.teamName.replace(/'/g, "''")}'`);
  }
  if (filters.salesmanName) {
    conditions.push(`salesman_name = '${filters.salesmanName.replace(/'/g, "''")}'`);
  }
  if (filters.month) {
    conditions.push(`insurance_start_month = '${filters.month.replace(/'/g, "''")}'`);
  }
  if (filters.maturityFilter && filters.maturityFilter !== 'all') {
    conditions.push(`maturity = '${filters.maturityFilter}'`);
  }
  if (filters.insuranceGrade) {
    conditions.push(`insurance_grade = '${filters.insuranceGrade.replace(/'/g, "''")}'`);
  }

  return conditions.join(' AND ');
}

/**
 * 机构级漏斗总览（四级漏斗：应续→进入报价窗口→已报价→已续保）
 *
 * 业务规则：最早可报价日 = 到期日前30天。
 * in_quote_window = true 表示该保单已可以报价。
 */
export function generateFunnelOverviewQuery(filters: RenewalFunnelFilters = {}): string {
  const where = buildWhere(filters);

  return `
    SELECT
      org_level_3,
      COUNT(*) AS total_due,
      SUM(CASE WHEN in_quote_window THEN 1 ELSE 0 END) AS in_window_count,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS total_quoted,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
      ROUND(SUM(CASE WHEN in_quote_window THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS window_rate,
      ROUND(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN in_quote_window THEN 1 ELSE 0 END), 0), 1) AS quote_rate,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END), 0), 1) AS quote_to_renewal_rate,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      SUM(CASE WHEN is_self_retained THEN 1 ELSE 0 END) AS self_retained_count,
      ROUND(SUM(CASE WHEN is_self_retained THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END), 0), 1) AS self_retention_rate,
      SUM(CASE WHEN action_priority = 'P1' THEN 1 ELSE 0 END) AS p1_count,
      SUM(CASE WHEN action_priority = 'P2' THEN 1 ELSE 0 END) AS p2_count
    FROM RenewalFunnel
    WHERE ${where}
    GROUP BY org_level_3
    ORDER BY total_due DESC
  `;
}

/**
 * 月度趋势（含成熟度标记）
 */
export function generateFunnelTrendQuery(filters: RenewalFunnelFilters = {}): string {
  const where = buildWhere({ ...filters, month: undefined });

  return `
    SELECT
      insurance_start_month,
      COUNT(*) AS total_due,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      SUM(CASE WHEN maturity = 'mature' THEN 1 ELSE 0 END) AS mature_count,
      SUM(CASE WHEN maturity = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN maturity = 'future' THEN 1 ELSE 0 END) AS future_count,
      ROUND(
        SUM(CASE WHEN maturity = 'mature' AND is_renewed THEN 1 ELSE 0 END) * 100.0
        / NULLIF(SUM(CASE WHEN maturity = 'mature' THEN 1 ELSE 0 END), 0), 1
      ) AS mature_renewal_rate
    FROM RenewalFunnel
    WHERE ${where}
    GROUP BY insurance_start_month
    ORDER BY insurance_start_month
  `;
}

/**
 * 团队排行与对比
 */
export function generateFunnelTeamQuery(filters: RenewalFunnelFilters = {}): string {
  const where = buildWhere(filters);

  return `
    SELECT
      team_name,
      COUNT(*) AS total_due,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS total_quoted,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END), 0), 1) AS quote_to_renewal_rate,
      SUM(CASE WHEN is_self_retained THEN 1 ELSE 0 END) AS self_retained_count,
      SUM(CASE WHEN is_renewed AND NOT is_self_retained THEN 1 ELSE 0 END) AS lost_renewed_count,
      ROUND(SUM(CASE WHEN is_self_retained THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END), 0), 1) AS self_retention_rate
    FROM RenewalFunnel
    WHERE ${where}
    GROUP BY team_name
    ORDER BY renewal_rate DESC
  `;
}

/**
 * 业务员续保明细
 */
export function generateFunnelSalesmanQuery(filters: RenewalFunnelFilters = {}): string {
  const where = buildWhere(filters);

  return `
    SELECT
      salesman_name,
      team_name,
      COUNT(*) AS total_due,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS total_quoted,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      SUM(CASE WHEN is_self_retained THEN 1 ELSE 0 END) AS self_retained_count,
      ROUND(SUM(CASE WHEN is_self_retained THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END), 0), 1) AS self_retention_rate,
      SUM(CASE WHEN competition_level = 'competitive' THEN 1 ELSE 0 END) AS competitive_count
    FROM RenewalFunnel
    WHERE ${where}
    GROUP BY salesman_name, team_name
    ORDER BY total_due DESC
  `;
}

/**
 * 即将到期未续保清单（行动导向，按优先级排序）
 *
 * P1: 已进入报价窗口但未报价 → 立即行动
 * P2: 已报价、已到期 0-14 天 → 挽回窗口
 * P3: 已报价、已到期 15-30 天 → 紧急挽回
 * P4: 其他未续保 → 大概率流失
 */
export function generateFunnelActionListQuery(filters: RenewalFunnelFilters = {}): string {
  const conditions: string[] = ['NOT is_renewed'];

  if (filters.orgName) {
    conditions.push(`org_level_3 = '${filters.orgName.replace(/'/g, "''")}'`);
  }
  if (filters.teamName) {
    conditions.push(`team_name = '${filters.teamName.replace(/'/g, "''")}'`);
  }
  if (filters.salesmanName) {
    conditions.push(`salesman_name = '${filters.salesmanName.replace(/'/g, "''")}'`);
  }
  if (filters.daysRange !== undefined) {
    conditions.push(`days_since_expiry <= ${filters.daysRange}`);
  }

  if (filters.actionPriority) {
    conditions.push(`action_priority = '${filters.actionPriority}'`);
  }

  return `
    SELECT
      policy_no,
      org_level_3,
      team_name,
      salesman_name,
      vehicle_frame_no,
      insurance_grade,
      customer_category,
      tonnage_segment,
      CAST(insurance_end_date AS VARCHAR) AS insurance_end_date,
      days_since_expiry,
      days_to_expiry,
      maturity,
      is_quoted,
      in_quote_window,
      quote_salesman_count,
      competition_level,
      quoted_insurance_grade,
      action_priority
    FROM RenewalFunnel
    WHERE ${conditions.join(' AND ')}
    ORDER BY action_priority ASC, days_since_expiry DESC
  `;
}

/**
 * 机构×等级 续保率矩阵（分管总一眼定位洼地）
 */
export function generateFunnelMatrixQuery(filters: RenewalFunnelFilters = {}): string {
  const where = buildWhere(filters);

  return `
    SELECT
      org_level_3,
      insurance_grade,
      COUNT(*) AS total_due,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS renewal_rate
    FROM RenewalFunnel
    WHERE ${where}
    GROUP BY org_level_3, insurance_grade
    ORDER BY org_level_3, insurance_grade
  `;
}

/**
 * 风控等级交叉分析
 */
export function generateFunnelRiskQuery(filters: RenewalFunnelFilters = {}): string {
  const where = buildWhere(filters);

  return `
    SELECT
      insurance_grade,
      COUNT(*) AS total_due,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS total_renewed,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS total_quoted,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END), 0), 1) AS quote_to_renewal_rate,
      SUM(CASE WHEN competition_level = 'competitive' THEN 1 ELSE 0 END) AS competitive_count,
      ROUND(SUM(CASE WHEN competition_level = 'competitive' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS competitive_rate
    FROM RenewalFunnel
    WHERE ${where}
    GROUP BY insurance_grade
    ORDER BY total_due DESC
  `;
}
