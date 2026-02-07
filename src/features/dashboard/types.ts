export interface TopNChartDatum {
  dim_key: string;
  value: number;
}

export interface SalesmanTableRow {
  salesman_name: string;
  org_level_3: string;
  signed_premium: string;
  policy_count: number;
  [key: string]: string | number | boolean | bigint | null | undefined;
}

export interface SalesmanSummaryRow {
  salesman_name: string;
  org_level_3: string;
  total_premium: string;
  policy_count: number;
  [key: string]: string | number | boolean | bigint | null | undefined;
}

export interface RoseChartDatum {
  name: string;
  value: number;
}
