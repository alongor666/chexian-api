/**
 * 报价转化分析 SQL 生成器
 *
 * 数据源：QuoteConversion 视图（04_报价清单 Parquet + salesman dim JOIN）
 * 粒度：单据级（每条报价单一行），用于业务员/机构绩效分析
 *
 * 字段：quote_time, org_level_3, customer_category, renewal_status, is_underwritten,
 *       coverage_combination, insurance_grade, commercial_ncd,
 *       pure_risk_premium, final_quote_premium, ncd_premium, commercial_pricing_factor,
 *       is_telemarketing, is_transfer, is_nev, traffic_risk_grade,
 *       highway_risk_level, tonnage_segment, insurance_type,
 *       brand_model_category, fuel_type, new_vehicle_price, vehicle_age,
 *       ncd_yoy_change, pricing_factor_yoy_change,
 *       salesman_name, salesman_no, team
 *
 * L2 历史快照额外字段：quote_count, salesman_count, org_count, first_quote_time, last_quote_time
 *
 * 指标字段命名：
 *   - underwriting_rate：承保率（注册表 id: underwriting_rate，v1.0.0 起权威名称）
 *   - conversion_rate：@deprecated v1.1，旧别名，与 underwriting_rate 同值。新前端代码请用 underwriting_rate。
 */

import { escapeSqlValue } from '../utils/security.js';

export interface QuoteConversionFilters {
  dateStart?: string;
  dateEnd?: string;
  renewalType?: string;      // 续保 | 转保
  orgName?: string;          // 三级机构
  teamName?: string;         // 团队
  salesmanNo?: string;       // 业务员编号
  customerCategory?: string; // 客户类别
  insuranceCombo?: string;   // 险别组合：主全 | 交三
  isTelemarketing?: '电销' | '非电销';
  isNewEnergy?: '是' | '否';
  isTransferred?: '是' | '否';
  riskGrade?: 'A' | 'B' | 'C' | 'D';
  ncdMin?: number;
  ncdMax?: number;
}

const esc = escapeSqlValue;

function buildWhere(filters: QuoteConversionFilters): string {
  const conds: string[] = ['1=1'];

  if (filters.dateStart) {
    conds.push(`CAST(quote_time AS DATE) >= '${esc(filters.dateStart)}'`);
  }
  if (filters.dateEnd) {
    conds.push(`CAST(quote_time AS DATE) <= '${esc(filters.dateEnd)}'`);
  }
  if (filters.renewalType) {
    conds.push(`renewal_status = '${esc(filters.renewalType)}'`);
  }
  if (filters.orgName) {
    conds.push(`org_level_3 = '${esc(filters.orgName)}'`);
  }
  if (filters.teamName) {
    conds.push(`team = '${esc(filters.teamName)}'`);
  }
  if (filters.salesmanNo) {
    conds.push(`salesman_no = '${esc(filters.salesmanNo)}'`);
  }
  if (filters.customerCategory) {
    conds.push(`customer_category = '${esc(filters.customerCategory)}'`);
  }
  if (filters.insuranceCombo) {
    conds.push(`coverage_combination = '${esc(filters.insuranceCombo)}'`);
  }
  if (filters.isTelemarketing) {
    conds.push(`is_telemarketing = '${esc(filters.isTelemarketing)}'`);
  }
  if (filters.isNewEnergy) {
    conds.push(`is_nev = '${esc(filters.isNewEnergy)}'`);
  }
  if (filters.isTransferred) {
    conds.push(`is_transfer = '${esc(filters.isTransferred)}'`);
  }
  if (filters.riskGrade) {
    conds.push(`insurance_grade = '${esc(filters.riskGrade)}'`);
  }
  if (typeof filters.ncdMin === 'number') {
    conds.push(`commercial_ncd >= ${filters.ncdMin}`);
  }
  if (typeof filters.ncdMax === 'number') {
    conds.push(`commercial_ncd <= ${filters.ncdMax}`);
  }

  return conds.join(' AND ');
}

/** KPI 概览卡片 */
export function generateQuoteKpiQuery(filters: QuoteConversionFilters = {}, whereClause: string = '1=1'): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS underwriting_rate,
      ROUND(SUM(CASE WHEN pure_risk_premium > 0 THEN final_quote_premium END) / NULLIF(SUM(CASE WHEN pure_risk_premium > 0 THEN pure_risk_premium END), 0), 3) AS avg_discount_rate,
      ROUND(SUM(CASE WHEN is_underwritten = '承保' THEN final_quote_premium ELSE 0 END), 0) AS insured_premium,
      COUNT(DISTINCT salesman_no) AS salesman_count,
      -- 续保/转保分拆
      COUNT(CASE WHEN renewal_status = '续保' THEN 1 END) AS renewal_quotes,
      COUNT(CASE WHEN renewal_status = '续保' AND is_underwritten = '承保' THEN 1 END) AS renewal_insured,
      ROUND(SUM(CASE WHEN renewal_status = '续保' AND is_underwritten = '承保' THEN final_quote_premium ELSE 0 END), 0) AS renewal_insured_premium,
      COUNT(CASE WHEN renewal_status = '转保' THEN 1 END) AS switch_quotes,
      COUNT(CASE WHEN renewal_status = '转保' AND is_underwritten = '承保' THEN 1 END) AS switch_insured,
      ROUND(SUM(CASE WHEN renewal_status = '转保' AND is_underwritten = '承保' THEN final_quote_premium ELSE 0 END), 0) AS switch_insured_premium
    FROM QuoteConversion
    WHERE ${finalWhere}
  `;
}

/** 转化漏斗（续保/转保分开） */
export function generateQuoteFunnelQuery(filters: QuoteConversionFilters = {}, whereClause: string = '1=1'): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      renewal_status AS renewal_type,
      COUNT(*) AS l1_total,
      COUNT(CASE WHEN final_quote_premium > 0 THEN 1 END) AS l2_valid,
      COUNT(CASE WHEN final_quote_premium > 0 AND insurance_grade IN ('A','B','C','D') AND commercial_ncd <= 1.0 THEN 1 END) AS l3_quality,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS l4_insured
    FROM QuoteConversion
    WHERE ${finalWhere}
    GROUP BY renewal_status
    ORDER BY renewal_status
  `;
}

/** 三级下钻表 */
export function generateQuoteDrilldownQuery(
  filters: QuoteConversionFilters = {},
  level: 'org' | 'team' | 'salesman' = 'org',
  whereClause: string = '1=1'
): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;

  let groupCol: string;
  let nameCol: string;
  switch (level) {
    case 'org':
      groupCol = 'org_level_3';
      nameCol = 'org_level_3';
      break;
    case 'team':
      groupCol = 'team';
      nameCol = 'team';
      break;
    case 'salesman':
      groupCol = 'salesman_no';
      nameCol = 'salesman_name';
      break;
  }

  return `
    SELECT
      ${groupCol} AS group_key,
      ${level === 'salesman' ? `ANY_VALUE(${nameCol})` : `${nameCol}`} AS group_name,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS underwriting_rate,
      -- 续保转化率
      ROUND(100.0 * COUNT(CASE WHEN renewal_status = '续保' AND is_underwritten = '承保' THEN 1 END)
        / NULLIF(COUNT(CASE WHEN renewal_status = '续保' THEN 1 END), 0), 1) AS renewal_rate,
      -- 转保转化率
      ROUND(100.0 * COUNT(CASE WHEN renewal_status = '转保' AND is_underwritten = '承保' THEN 1 END)
        / NULLIF(COUNT(CASE WHEN renewal_status = '转保' THEN 1 END), 0), 1) AS switch_rate,
      -- 平均折扣率
      ROUND(SUM(CASE WHEN pure_risk_premium > 0 THEN final_quote_premium END) / NULLIF(SUM(CASE WHEN pure_risk_premium > 0 THEN pure_risk_premium END), 0), 3) AS avg_discount
    FROM QuoteConversion
    WHERE ${finalWhere}
    GROUP BY ${groupCol}${level === 'salesman' ? '' : `, ${nameCol}`}
    ORDER BY total_quotes DESC
  `;
}

/** 维度热力图 */
export function generateQuoteHeatmapQuery(
  filters: QuoteConversionFilters = {},
  colDimension: string = 'renewal_status',
  whereClause: string = '1=1'
): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  const safeCol = esc(colDimension);
  // 允许的列维度白名单
  const allowedCols: Record<string, string> = {
    'renewal_status': 'renewal_status',
    'insurance_grade': 'insurance_grade',
    'commercial_ncd': "CAST(commercial_ncd AS VARCHAR)",
    'coverage_combination': 'coverage_combination',
    'customer_category': 'customer_category',
    'is_telemarketing': 'is_telemarketing',
    'is_nev': 'is_nev',
    'traffic_risk_grade': 'traffic_risk_grade',
  };
  const colExpr = allowedCols[safeCol] ?? 'renewal_status';

  return `
    SELECT
      org_level_3 AS org,
      ${colExpr} AS dim_value,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS underwriting_rate
    FROM QuoteConversion
    WHERE ${finalWhere}
    GROUP BY org_level_3, ${colExpr}
    ORDER BY org_level_3, dim_value
  `;
}

/** 价格敏感度分析 */
export function generateQuotePriceQuery(filters: QuoteConversionFilters = {}, whereClause: string = '1=1'): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      ROUND(CASE WHEN pure_risk_premium > 0 THEN final_quote_premium / pure_risk_premium END * 20) / 20.0 AS discount_bin,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS underwriting_rate,
      ROUND(AVG(final_quote_premium), 0) AS avg_premium,
      ROUND(SUM(commercial_pricing_factor * final_quote_premium) / NULLIF(SUM(CASE WHEN commercial_pricing_factor IS NOT NULL AND commercial_pricing_factor > 0 THEN final_quote_premium END), 0), 3) AS avg_pricing_coef
    FROM QuoteConversion
    WHERE ${finalWhere} AND pure_risk_premium > 0
    GROUP BY discount_bin
    ORDER BY discount_bin
  `;
}

/** 多维度排行 */
export function generateQuoteRankingQuery(
  filters: QuoteConversionFilters = {},
  dimension: string = 'customer_category',
  whereClause: string = '1=1'
): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  const allowedDims: Record<string, string> = {
    'customer_category': 'customer_category',
    'commercial_ncd': "CAST(commercial_ncd AS VARCHAR)",
    'insurance_grade': 'insurance_grade',
    'is_nev': 'is_nev',
    'tonnage_segment': 'tonnage_segment',
    'traffic_risk_grade': 'traffic_risk_grade',
    'is_telemarketing': 'is_telemarketing',
    'is_transfer': 'is_transfer',
  };
  const dimExpr = allowedDims[esc(dimension)] ?? 'customer_category';

  return `
    SELECT
      ${dimExpr} AS dim_value,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS underwriting_rate,
      ROUND(SUM(CASE WHEN pure_risk_premium > 0 THEN final_quote_premium END) / NULLIF(SUM(CASE WHEN pure_risk_premium > 0 THEN pure_risk_premium END), 0), 3) AS avg_discount
    FROM QuoteConversion
    WHERE ${finalWhere}
    GROUP BY ${dimExpr}
    ORDER BY total_quotes DESC
  `;
}

/** 时间趋势 */
export function generateQuoteTrendQuery(
  filters: QuoteConversionFilters = {},
  granularity: 'day' | 'week' | 'month' = 'week',
  whereClause: string = '1=1'
): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause && whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;

  let timeBucket: string;
  switch (granularity) {
    case 'day':
      timeBucket = "STRFTIME('%Y-%m-%d', CAST(quote_time AS DATE))";
      break;
    case 'week':
      timeBucket = "STRFTIME('%Y-W%W', CAST(quote_time AS DATE))";
      break;
    case 'month':
      timeBucket = "STRFTIME('%Y-%m', CAST(quote_time AS DATE))";
      break;
  }

  return `
    SELECT
      ${timeBucket} AS time_bucket,
      renewal_status AS renewal_type,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(100.0 * COUNT(CASE WHEN is_underwritten = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS underwriting_rate
    FROM QuoteConversion
    WHERE ${finalWhere}
    GROUP BY ${timeBucket}, renewal_status
    ORDER BY time_bucket, renewal_status
  `;
}
