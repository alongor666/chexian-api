/**
 * 赔案明细 SQL 生成器
 *
 * 数据源：ClaimsDetail VIEW（赔案级明细）+ PolicyFact（保单维度 JOIN）
 * 端点：/api/query/claims-detail/*
 */

// ── 类型 ──

export interface ClaimsDetailFilters {
  dateStart?: string;    // 出险时间开始
  dateEnd?: string;      // 出险时间结束
  orgName?: string;      // 三级机构
  claimStatus?: string;  // 赔案类型：已业务结案/未业务结案
  isBodilyInjury?: string; // 是否人伤：true/false
  accidentCause?: string;  // 出险原因
  accidentCity?: string;   // 出险城市
  customerCategory?: string; // 客户类别
}

function buildWhere(filters: ClaimsDetailFilters, tableAlias = 'c'): string {
  const conditions: string[] = [];
  if (filters.dateStart) conditions.push(`${tableAlias}.accident_time >= '${filters.dateStart}'`);
  if (filters.dateEnd) conditions.push(`${tableAlias}.accident_time <= '${filters.dateEnd} 23:59:59'`);
  if (filters.claimStatus) conditions.push(`${tableAlias}.claim_status = '${filters.claimStatus}'`);
  if (filters.isBodilyInjury !== undefined) {
    conditions.push(`${tableAlias}.is_bodily_injury = ${filters.isBodilyInjury === 'true'}`);
  }
  if (filters.accidentCause) conditions.push(`${tableAlias}.accident_cause = '${filters.accidentCause}'`);
  if (filters.accidentCity) conditions.push(`${tableAlias}.accident_city = '${filters.accidentCity}'`);
  return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
}

function buildPolicyWhere(filters: ClaimsDetailFilters): string {
  const conditions: string[] = [];
  if (filters.orgName) conditions.push(`p.org_level_3 = '${filters.orgName}'`);
  if (filters.customerCategory) conditions.push(`p.customer_category = '${filters.customerCategory}'`);
  return conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
}

// ── 1. 未决赔案概览 ──

export function generatePendingOverviewQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      c.claim_status,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN c.is_bodily_injury THEN c.reserve_amount ELSE 0 END) / 1e4, 0) AS injury_reserve_wan,
      ROUND(SUM(c.reserve_bodily_amount) / 1e4, 0) AS bodily_wan,
      ROUND(SUM(c.reserve_vehicle_amount) / 1e4, 0) AS vehicle_wan,
      ROUND(SUM(c.reserve_property_amount) / 1e4, 0) AS property_wan
    FROM ClaimsDetail c
    JOIN PolicyFact p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY c.claim_status
  `;
}

// ── 2. 未决赔案机构分布 ──

export function generatePendingByOrgQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere({ ...filters, claimStatus: '未业务结案' });
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      p.org_level_3 AS org,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(AVG(DATEDIFF('day', c.accident_time, CURRENT_DATE)), 0) AS avg_pending_days,
      MAX(DATEDIFF('day', c.accident_time, CURRENT_DATE)) AS max_pending_days
    FROM ClaimsDetail c
    JOIN PolicyFact p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY p.org_level_3
    ORDER BY reserve_wan DESC
  `;
}

// ── 3. 未决赔案账龄分布 ──

export function generatePendingAgingQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere({ ...filters, claimStatus: '未业务结案' });
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      CASE
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 30 THEN '0-30天'
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 90 THEN '31-90天'
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 180 THEN '91-180天'
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 365 THEN '181-365天'
        ELSE '365天+'
      END AS aging_bucket,
      CASE
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 30 THEN 1
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 90 THEN 2
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 180 THEN 3
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 365 THEN 4
        ELSE 5
      END AS sort_order,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases
    FROM ClaimsDetail c
    JOIN PolicyFact p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY aging_bucket, sort_order
    ORDER BY sort_order
  `;
}

// ── 4. 出险原因 + 人伤分析 ──

export function generateCauseAnalysisQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      c.accident_cause,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS injury_pct
    FROM ClaimsDetail c
    JOIN PolicyFact p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY c.accident_cause
    ORDER BY cases DESC
  `;
}

// ── 5. 地理风险分析（出险地点）──

export function generateGeoRiskByAccidentQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      c.accident_province AS province,
      c.accident_city AS city,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS injury_pct,
      ROUND(AVG(DATEDIFF('day', c.accident_time, c.payment_time))
        FILTER (WHERE c.payment_time IS NOT NULL), 0) AS avg_cycle_days
    FROM ClaimsDetail c
    JOIN PolicyFact p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
      AND c.accident_city IS NOT NULL
    GROUP BY c.accident_province, c.accident_city
    ORDER BY cases DESC
    LIMIT 100
  `;
}

// ── 6. 地理风险分析（车牌归属地）──

export function generateGeoRiskByPlateQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    WITH claim_with_plate AS (
      SELECT
        c.*,
        p.plate_no,
        p.org_level_3,
        p.customer_category,
        CASE
          WHEN p.plate_no LIKE '川A%' THEN '成都'
          WHEN p.plate_no LIKE '川B%' THEN '绵阳'
          WHEN p.plate_no LIKE '川C%' THEN '自贡'
          WHEN p.plate_no LIKE '川D%' THEN '攀枝花'
          WHEN p.plate_no LIKE '川E%' THEN '泸州'
          WHEN p.plate_no LIKE '川F%' THEN '德阳'
          WHEN p.plate_no LIKE '川H%' THEN '遂宁'
          WHEN p.plate_no LIKE '川J%' THEN '内江'
          WHEN p.plate_no LIKE '川K%' THEN '乐山'
          WHEN p.plate_no LIKE '川L%' THEN '南充'
          WHEN p.plate_no LIKE '川M%' THEN '眉山'
          WHEN p.plate_no LIKE '川Q%' THEN '宜宾'
          WHEN p.plate_no LIKE '川R%' THEN '达州'
          WHEN p.plate_no LIKE '川S%' THEN '雅安'
          WHEN p.plate_no LIKE '川T%' THEN '资阳'
          WHEN p.plate_no LIKE '川U%' THEN '阿坝'
          WHEN p.plate_no LIKE '川V%' THEN '甘孜'
          WHEN p.plate_no LIKE '川W%' THEN '凉山'
          WHEN p.plate_no LIKE '川X%' THEN '广安'
          WHEN p.plate_no LIKE '川Y%' THEN '巴中'
          WHEN p.plate_no LIKE '川Z%' THEN '广元'
          WHEN p.plate_no LIKE '渝%' THEN '重庆'
          ELSE '其他'
        END AS plate_city
      FROM ClaimsDetail c
      JOIN PolicyFact p ON c.policy_no = p.policy_no
      WHERE ${where}${policyWhere}
    )
    SELECT
      plate_city,
      COUNT(*) AS cases,
      ROUND(SUM(reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS injury_pct
    FROM claim_with_plate
    WHERE plate_city != '其他'
    GROUP BY plate_city
    ORDER BY cases DESC
  `;
}

// ── 7. 地理风险对比（出险地 vs 车牌归属地）──

export function generateGeoComparisonQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    WITH base AS (
      SELECT
        c.accident_city,
        CASE
          WHEN p.plate_no LIKE '川A%' THEN '成都'
          WHEN p.plate_no LIKE '川B%' THEN '绵阳'
          WHEN p.plate_no LIKE '川C%' THEN '自贡'
          WHEN p.plate_no LIKE '川D%' THEN '攀枝花'
          WHEN p.plate_no LIKE '川E%' THEN '泸州'
          WHEN p.plate_no LIKE '川F%' THEN '德阳'
          WHEN p.plate_no LIKE '川H%' THEN '遂宁'
          WHEN p.plate_no LIKE '川J%' THEN '内江'
          WHEN p.plate_no LIKE '川K%' THEN '乐山'
          WHEN p.plate_no LIKE '川L%' THEN '南充'
          WHEN p.plate_no LIKE '川M%' THEN '眉山'
          WHEN p.plate_no LIKE '川Q%' THEN '宜宾'
          WHEN p.plate_no LIKE '川R%' THEN '达州'
          WHEN p.plate_no LIKE '川S%' THEN '雅安'
          WHEN p.plate_no LIKE '川T%' THEN '资阳'
          WHEN p.plate_no LIKE '川X%' THEN '广安'
          WHEN p.plate_no LIKE '川Y%' THEN '巴中'
          WHEN p.plate_no LIKE '川Z%' THEN '广元'
          WHEN p.plate_no LIKE '渝%' THEN '重庆'
          ELSE '其他'
        END AS plate_city,
        c.reserve_amount,
        c.is_bodily_injury,
        CASE WHEN c.accident_city != (
          CASE
            WHEN p.plate_no LIKE '川A%' THEN '510100成都市'
            WHEN p.plate_no LIKE '川B%' THEN '510700绵阳市'
            WHEN p.plate_no LIKE '川C%' THEN '510300自贡市'
            WHEN p.plate_no LIKE '川E%' THEN '510500泸州市'
            WHEN p.plate_no LIKE '川F%' THEN '510600德阳市'
            WHEN p.plate_no LIKE '川Q%' THEN '511500宜宾市'
            ELSE 'MATCH'
          END
        ) THEN TRUE ELSE FALSE END AS is_cross_region
      FROM ClaimsDetail c
      JOIN PolicyFact p ON c.policy_no = p.policy_no
      WHERE ${where}${policyWhere}
        AND p.plate_no IS NOT NULL
    )
    SELECT
      COUNT(*) AS total_cases,
      SUM(CASE WHEN is_cross_region THEN 1 ELSE 0 END) AS cross_region_cases,
      ROUND(SUM(CASE WHEN is_cross_region THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS cross_region_pct,
      ROUND(AVG(CASE WHEN is_cross_region THEN reserve_amount END), 0) AS cross_region_avg_reserve,
      ROUND(AVG(CASE WHEN NOT is_cross_region THEN reserve_amount END), 0) AS local_avg_reserve
    FROM base
  `;
}

// ── 8. 理赔时效分析 ──

export function generateClaimCycleQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere({ ...filters, claimStatus: '已业务结案' });
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      CASE WHEN c.is_bodily_injury THEN '人伤' ELSE '非人伤' END AS type,
      COUNT(*) AS cases,
      ROUND(AVG(DATEDIFF('day', c.accident_time, c.report_time)), 1) AS avg_report_days,
      ROUND(AVG(DATEDIFF('day', c.report_time, c.case_open_time)), 1) AS avg_open_days,
      ROUND(AVG(DATEDIFF('day', c.case_open_time, c.settlement_time)), 1) AS avg_settle_days,
      ROUND(AVG(DATEDIFF('day', c.settlement_time, c.payment_time)), 1) AS avg_pay_days,
      ROUND(AVG(DATEDIFF('day', c.accident_time, c.payment_time)), 1) AS avg_total_days,
      ROUND(MEDIAN(DATEDIFF('day', c.accident_time, c.payment_time)), 1) AS median_total_days
    FROM ClaimsDetail c
    JOIN PolicyFact p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
      AND c.payment_time IS NOT NULL
    GROUP BY c.is_bodily_injury
  `;
}

// ── 9. 出险频度同比 ──

export function generateFrequencyYoyQuery(filters: ClaimsDetailFilters): string {
  const policyWhere = buildPolicyWhere(filters);
  // 取最近3个完整年份的Q1-Q4数据
  return `
    WITH quarterly_claims AS (
      SELECT
        YEAR(c.accident_time) AS year,
        QUARTER(c.accident_time) AS quarter,
        COUNT(*) AS claim_count,
        SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_count,
        ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan
      FROM ClaimsDetail c
      JOIN PolicyFact p ON c.policy_no = p.policy_no
      WHERE c.accident_time >= '2022-01-01'${policyWhere}
      GROUP BY YEAR(c.accident_time), QUARTER(c.accident_time)
    ),
    quarterly_policies AS (
      SELECT
        YEAR(insurance_start_date) AS year,
        QUARTER(insurance_start_date) AS quarter,
        COUNT(DISTINCT policy_no) AS policy_count
      FROM PolicyFact p
      WHERE insurance_start_date >= '2022-01-01'${policyWhere.replace(/p\./g, '')}
      GROUP BY YEAR(insurance_start_date), QUARTER(insurance_start_date)
    )
    SELECT
      c.year, c.quarter,
      c.claim_count, c.injury_count, c.reserve_wan,
      e.policy_count,
      ROUND(c.claim_count * 1000.0 / NULLIF(e.policy_count, 0), 2) AS freq_per_1000,
      ROUND(c.injury_count * 100.0 / NULLIF(c.claim_count, 0), 1) AS injury_pct
    FROM quarterly_claims c
    LEFT JOIN quarterly_policies e ON c.year = e.year AND c.quarter = e.quarter
    ORDER BY c.year, c.quarter
  `;
}
