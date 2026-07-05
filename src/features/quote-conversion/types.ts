/** 报价转化分析类型定义 */

export interface QuoteFilters {
  dateStart?: string;
  dateEnd?: string;
  renewalType?: '续保' | '转保';
  orgName?: string;
  teamName?: string;
  salesmanNo?: string;
  customerCategory?: string;
  insuranceCombo?: '主全' | '交三';
  isTelemarketing?: '电销' | '非电销';
  isNewEnergy?: '是' | '否';
  isTransferred?: '是' | '否';
  riskGrade?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'X';
  /** 字符串形式，服务端 zod coerce 为 number */
  ncdMin?: string;
  /** 字符串形式，服务端 zod coerce 为 number */
  ncdMax?: string;
}

export interface QuoteKpi {
  total_quotes: number;
  total_insured: number;
  /** 承保率（单据级：承保件数 / 报价件数）。权威字段。 */
  underwriting_rate: number;
  /** @deprecated v1.1 — 与 underwriting_rate 同值，仅为向后兼容保留。新代码请用 underwriting_rate */
  conversion_rate?: number;
  avg_discount_rate: number;
  insured_premium: number;
  salesman_count: number;
  renewal_quotes: number;
  renewal_insured: number;
  renewal_insured_premium: number;
  switch_quotes: number;
  switch_insured: number;
  switch_insured_premium: number;
}

export interface FunnelRow {
  renewal_type: string;
  l1_total: number;
  l2_valid: number;
  l3_quality: number;
  l4_insured: number;
}

export interface DrilldownRow {
  group_key: string;
  group_name: string;
  total_quotes: number;
  total_insured: number;
  /** 承保率（单据级）。权威字段。 */
  underwriting_rate: number;
  /** @deprecated v1.1 — 与 underwriting_rate 同值，向后兼容保留 */
  conversion_rate?: number;
  renewal_rate: number;
  switch_rate: number;
  avg_discount: number;
}

export interface HeatmapRow {
  org: string;
  dim_value: string;
  total_quotes: number;
  total_insured: number;
  /** 承保率（单据级）。权威字段。 */
  underwriting_rate: number;
  /** @deprecated v1.1 — 与 underwriting_rate 同值，向后兼容保留 */
  conversion_rate?: number;
}

export interface PriceRow {
  discount_bin: number;
  total_quotes: number;
  total_insured: number;
  /** 承保率（单据级）。权威字段。 */
  underwriting_rate: number;
  /** @deprecated v1.1 — 与 underwriting_rate 同值，向后兼容保留 */
  conversion_rate?: number;
  avg_premium: number;
  avg_pricing_coef: number;
}

export interface TrendRow {
  time_bucket: string;
  renewal_type: string;
  total_quotes: number;
  total_insured: number;
  /** 承保率（单据级）。权威字段。 */
  underwriting_rate: number;
  /** @deprecated v1.1 — 与 underwriting_rate 同值，向后兼容保留 */
  conversion_rate?: number;
}

export interface RankingRow {
  dim_value: string;
  total_quotes: number;
  total_insured: number;
  /** 承保率（单据级）。权威字段。 */
  underwriting_rate: number;
  /** @deprecated v1.1 — 与 underwriting_rate 同值，向后兼容保留 */
  conversion_rate?: number;
  avg_discount: number;
}

export type DrillLevel = 'org' | 'team' | 'salesman';
