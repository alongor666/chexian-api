/**
 * 报价转化分析 SQL 生成器
 *
 * 数据源：QuoteConversion 视图（报价 Parquet + salesman dim JOIN）
 * 字段：报价时间, 三级机构, 客户类别, 续保情况, 是否承保, 险别组合,
 *       车险分等级, NCD系数, 折前保费, 折后保费, 自主定价系数,
 *       是否电销, 是否过户车, 是否新能源车, 交通风险评分等级,
 *       货车吨位分段, 业务员编号, 业务员姓名, 团队
 */

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

function esc(val: string): string {
  return val.replace(/'/g, "''");
}

function buildWhere(filters: QuoteConversionFilters): string {
  const conds: string[] = ['1=1'];

  if (filters.dateStart) {
    conds.push(`CAST(报价时间 AS DATE) >= '${esc(filters.dateStart)}'`);
  }
  if (filters.dateEnd) {
    conds.push(`CAST(报价时间 AS DATE) <= '${esc(filters.dateEnd)}'`);
  }
  if (filters.renewalType) {
    conds.push(`续保情况 = '${esc(filters.renewalType)}'`);
  }
  if (filters.orgName) {
    conds.push(`三级机构 = '${esc(filters.orgName)}'`);
  }
  if (filters.teamName) {
    conds.push(`团队 = '${esc(filters.teamName)}'`);
  }
  if (filters.salesmanNo) {
    conds.push(`业务员编号 = '${esc(filters.salesmanNo)}'`);
  }
  if (filters.customerCategory) {
    conds.push(`客户类别 = '${esc(filters.customerCategory)}'`);
  }
  if (filters.insuranceCombo) {
    conds.push(`险别组合 = '${esc(filters.insuranceCombo)}'`);
  }
  if (filters.isTelemarketing) {
    conds.push(`是否电销 = '${esc(filters.isTelemarketing)}'`);
  }
  if (filters.isNewEnergy) {
    conds.push(`是否新能源车 = '${esc(filters.isNewEnergy)}'`);
  }
  if (filters.isTransferred) {
    conds.push(`是否过户车 = '${esc(filters.isTransferred)}'`);
  }
  if (filters.riskGrade) {
    conds.push(`车险分等级 = '${esc(filters.riskGrade)}'`);
  }
  if (typeof filters.ncdMin === 'number') {
    conds.push(`NCD系数 >= ${filters.ncdMin}`);
  }
  if (typeof filters.ncdMax === 'number') {
    conds.push(`NCD系数 <= ${filters.ncdMax}`);
  }

  return conds.join(' AND ');
}

/** KPI 概览卡片 */
export function generateQuoteKpiQuery(filters: QuoteConversionFilters = {}): string {
  const where = buildWhere(filters);
  return `
    SELECT
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(SUM(CASE WHEN 折前保费 > 0 THEN 折后保费 END) / NULLIF(SUM(CASE WHEN 折前保费 > 0 THEN 折前保费 END), 0), 3) AS avg_discount_rate,
      ROUND(SUM(CASE WHEN 是否承保 = '承保' THEN 折后保费 ELSE 0 END), 0) AS insured_premium,
      COUNT(DISTINCT 业务员编号) AS salesman_count,
      -- 续保/转保分拆
      COUNT(CASE WHEN 续保情况 = '续保' THEN 1 END) AS renewal_quotes,
      COUNT(CASE WHEN 续保情况 = '续保' AND 是否承保 = '承保' THEN 1 END) AS renewal_insured,
      ROUND(SUM(CASE WHEN 续保情况 = '续保' AND 是否承保 = '承保' THEN 折后保费 ELSE 0 END), 0) AS renewal_insured_premium,
      COUNT(CASE WHEN 续保情况 = '转保' THEN 1 END) AS switch_quotes,
      COUNT(CASE WHEN 续保情况 = '转保' AND 是否承保 = '承保' THEN 1 END) AS switch_insured,
      ROUND(SUM(CASE WHEN 续保情况 = '转保' AND 是否承保 = '承保' THEN 折后保费 ELSE 0 END), 0) AS switch_insured_premium
    FROM QuoteConversion
    WHERE ${where}
  `;
}

/** 转化漏斗（续保/转保分开） */
export function generateQuoteFunnelQuery(filters: QuoteConversionFilters = {}): string {
  const where = buildWhere(filters);
  return `
    SELECT
      续保情况 AS renewal_type,
      COUNT(*) AS l1_total,
      COUNT(CASE WHEN 折后保费 > 0 THEN 1 END) AS l2_valid,
      COUNT(CASE WHEN 折后保费 > 0 AND 车险分等级 IN ('A','B','C','D') AND NCD系数 <= 1.0 THEN 1 END) AS l3_quality,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS l4_insured
    FROM QuoteConversion
    WHERE ${where}
    GROUP BY 续保情况
    ORDER BY 续保情况
  `;
}

/** 三级下钻表 */
export function generateQuoteDrilldownQuery(
  filters: QuoteConversionFilters = {},
  level: 'org' | 'team' | 'salesman' = 'org'
): string {
  const where = buildWhere(filters);

  let groupCol: string;
  let nameCol: string;
  switch (level) {
    case 'org':
      groupCol = '三级机构';
      nameCol = '三级机构';
      break;
    case 'team':
      groupCol = '团队';
      nameCol = '团队';
      break;
    case 'salesman':
      groupCol = '业务员编号';
      nameCol = '业务员姓名';
      break;
  }

  return `
    SELECT
      ${groupCol} AS group_key,
      ${level === 'salesman' ? `ANY_VALUE(${nameCol})` : `${nameCol}`} AS group_name,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      -- 续保转化率
      ROUND(100.0 * COUNT(CASE WHEN 续保情况 = '续保' AND 是否承保 = '承保' THEN 1 END)
        / NULLIF(COUNT(CASE WHEN 续保情况 = '续保' THEN 1 END), 0), 1) AS renewal_rate,
      -- 转保转化率
      ROUND(100.0 * COUNT(CASE WHEN 续保情况 = '转保' AND 是否承保 = '承保' THEN 1 END)
        / NULLIF(COUNT(CASE WHEN 续保情况 = '转保' THEN 1 END), 0), 1) AS switch_rate,
      -- 平均折扣率
      ROUND(SUM(CASE WHEN 折前保费 > 0 THEN 折后保费 END) / NULLIF(SUM(CASE WHEN 折前保费 > 0 THEN 折前保费 END), 0), 3) AS avg_discount
    FROM QuoteConversion
    WHERE ${where}
    GROUP BY ${groupCol}${level === 'salesman' ? '' : `, ${nameCol}`}
    ORDER BY total_quotes DESC
  `;
}

/** 维度热力图 */
export function generateQuoteHeatmapQuery(
  filters: QuoteConversionFilters = {},
  colDimension: string = '续保情况'
): string {
  const where = buildWhere(filters);
  const safeCol = esc(colDimension);
  // 允许的列维度白名单
  const allowedCols: Record<string, string> = {
    '续保情况': '续保情况',
    '车险分等级': '车险分等级',
    'NCD系数': "CAST(NCD系数 AS VARCHAR)",
    '险别组合': '险别组合',
    '客户类别': '客户类别',
    '是否电销': '是否电销',
    '是否新能源车': '是否新能源车',
    '交通风险评分等级': '交通风险评分等级',
  };
  const colExpr = allowedCols[safeCol] ?? '续保情况';

  return `
    SELECT
      三级机构 AS org,
      ${colExpr} AS dim_value,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate
    FROM QuoteConversion
    WHERE ${where}
    GROUP BY 三级机构, ${colExpr}
    ORDER BY 三级机构, dim_value
  `;
}

/** 价格敏感度分析 */
export function generateQuotePriceQuery(filters: QuoteConversionFilters = {}): string {
  const where = buildWhere(filters);
  return `
    SELECT
      ROUND(CASE WHEN 折前保费 > 0 THEN 折后保费 / 折前保费 END * 20) / 20.0 AS discount_bin,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(AVG(折后保费), 0) AS avg_premium,
      ROUND(SUM(自主定价系数 * 折后保费) / NULLIF(SUM(CASE WHEN 自主定价系数 IS NOT NULL AND 自主定价系数 > 0 THEN 折后保费 END), 0), 3) AS avg_pricing_coef
    FROM QuoteConversion
    WHERE ${where} AND 折前保费 > 0
    GROUP BY discount_bin
    ORDER BY discount_bin
  `;
}

/** 多维度排行 */
export function generateQuoteRankingQuery(
  filters: QuoteConversionFilters = {},
  dimension: string = '客户类别'
): string {
  const where = buildWhere(filters);
  const allowedDims: Record<string, string> = {
    '客户类别': '客户类别',
    'NCD系数': "CAST(NCD系数 AS VARCHAR)",
    '车险分等级': '车险分等级',
    '是否新能源车': '是否新能源车',
    '货车吨位分段': '货车吨位分段',
    '交通风险评分等级': '交通风险评分等级',
    '是否电销': '是否电销',
    '是否过户车': '是否过户车',
  };
  const dimExpr = allowedDims[esc(dimension)] ?? '客户类别';

  return `
    SELECT
      ${dimExpr} AS dim_value,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate,
      ROUND(SUM(CASE WHEN 折前保费 > 0 THEN 折后保费 END) / NULLIF(SUM(CASE WHEN 折前保费 > 0 THEN 折前保费 END), 0), 3) AS avg_discount
    FROM QuoteConversion
    WHERE ${where}
    GROUP BY ${dimExpr}
    ORDER BY total_quotes DESC
  `;
}

/** 时间趋势 */
export function generateQuoteTrendQuery(
  filters: QuoteConversionFilters = {},
  granularity: 'day' | 'week' | 'month' = 'week'
): string {
  const where = buildWhere(filters);

  let timeBucket: string;
  switch (granularity) {
    case 'day':
      timeBucket = "STRFTIME('%Y-%m-%d', CAST(报价时间 AS DATE))";
      break;
    case 'week':
      timeBucket = "STRFTIME('%Y-W%W', CAST(报价时间 AS DATE))";
      break;
    case 'month':
      timeBucket = "STRFTIME('%Y-%m', CAST(报价时间 AS DATE))";
      break;
  }

  return `
    SELECT
      ${timeBucket} AS time_bucket,
      续保情况 AS renewal_type,
      COUNT(*) AS total_quotes,
      COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) AS total_insured,
      ROUND(100.0 * COUNT(CASE WHEN 是否承保 = '承保' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS conversion_rate
    FROM QuoteConversion
    WHERE ${where}
    GROUP BY ${timeBucket}, 续保情况
    ORDER BY time_bucket, 续保情况
  `;
}
