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
}

export interface QuoteKpi {
  total_quotes: number;
  total_insured: number;
  conversion_rate: number;
  avg_discount_rate: number;
  insured_premium: number;
  salesman_count: number;
  renewal_quotes: number;
  renewal_insured: number;
  switch_quotes: number;
  switch_insured: number;
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
  conversion_rate: number;
  renewal_rate: number;
  switch_rate: number;
  avg_discount: number;
}

export interface HeatmapRow {
  org: string;
  dim_value: string;
  total_quotes: number;
  total_insured: number;
  conversion_rate: number;
}

export interface PriceRow {
  discount_bin: number;
  total_quotes: number;
  total_insured: number;
  conversion_rate: number;
  avg_premium: number;
  avg_pricing_coef: number;
}

export interface TrendRow {
  time_bucket: string;
  renewal_type: string;
  total_quotes: number;
  total_insured: number;
  conversion_rate: number;
}

export interface RankingRow {
  dim_value: string;
  total_quotes: number;
  total_insured: number;
  conversion_rate: number;
  avg_discount: number;
}

export type DrillLevel = 'org' | 'team' | 'salesman';
