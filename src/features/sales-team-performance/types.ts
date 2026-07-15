export type SalesTeamDimension = 'salesman' | 'team' | 'org' | 'insurance_class';

export interface SalesTeamPerformanceRow {
  dim_value: string;
  sales_team_row_count: number;
  received_premium: number;
  standard_premium: number;
}

export interface SalesTeamPerformanceTotal {
  sales_team_row_count: number;
  received_premium: number;
  standard_premium: number;
  latest_confirm_date: string | null;
}

export interface SalesTeamPerformanceData {
  dimension: SalesTeamDimension;
  rows: SalesTeamPerformanceRow[];
  total: SalesTeamPerformanceTotal | null;
}

export const DIMENSION_LABELS: Record<SalesTeamDimension, string> = {
  salesman: '业务员',
  team: '销售团队',
  org: '机构',
  insurance_class: '险种大类',
};
