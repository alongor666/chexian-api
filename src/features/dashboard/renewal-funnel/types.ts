/** 续保漏斗 — 类型定义 */

export interface FunnelOverviewRow {
  org_level_3: string;
  total_due: number;
  in_window_count: number;
  total_quoted: number;
  total_renewed: number;
  window_rate: number;
  quote_rate: number;
  quote_to_renewal_rate: number;
  renewal_rate: number;
  self_retained_count: number;
  self_retention_rate: number;
  p1_count: number;
  p2_count: number;
}

export interface FunnelTrendRow {
  insurance_start_month: string;
  total_due: number;
  total_renewed: number;
  renewal_rate: number;
  mature_count: number;
  pending_count: number;
  future_count: number;
  mature_renewal_rate: number | null;
}

export interface FunnelTeamRow {
  team_name: string;
  total_due: number;
  total_quoted: number;
  total_renewed: number;
  renewal_rate: number;
  quote_to_renewal_rate: number;
  self_retained_count: number;
  lost_renewed_count: number;
  self_retention_rate: number;
}

export interface FunnelSalesmanRow {
  salesman_name: string;
  team_name: string;
  total_due: number;
  total_quoted: number;
  total_renewed: number;
  renewal_rate: number;
  self_retained_count: number;
  self_retention_rate: number;
  competitive_count: number;
}

export interface FunnelActionRow {
  policy_no: string;
  org_level_3: string;
  team_name: string;
  salesman_name: string;
  vehicle_frame_no: string;
  insurance_grade: string;
  customer_category: string;
  tonnage_segment: string;
  insurance_end_date: string;
  days_since_expiry: number;
  days_to_expiry: number;
  maturity: string;
  is_quoted: boolean;
  in_quote_window: boolean;
  quote_salesman_count: number;
  competition_level: string;
  quoted_insurance_grade: string;
  action_priority: string;
}

export interface FunnelMatrixRow {
  org_level_3: string;
  insurance_grade: string;
  total_due: number;
  total_renewed: number;
  renewal_rate: number;
}

export interface FunnelFilters {
  orgName?: string;
  teamName?: string;
  salesmanName?: string;
  month?: string;
  maturityFilter?: 'mature' | 'pending' | 'all';
  daysRange?: number;
}
