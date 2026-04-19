export interface RenewalRow {
  row_level: string;
  org_level_3: string | null;
  team_name: string | null;
  salesman_name: string | null;
  customer_category: string | null;
  A: number;
  B: number;
  C: number;
}

export type SortField = 'A' | 'B' | 'C' | 'D' | 'E';
export type SortDir = 'asc' | 'desc';

export interface TimeRange {
  start: string;
  end: string;
  cutoff: string;
}

export type TimeView = 'ytd' | 'mtd_today' | 'mtd_full' | 'by_month' | 'custom';

export interface RenewalTrackerMeta {
  exposure_row_count: number;
  distinct_vehicle_count: number;
  distinct_source_policy_count: number;
  latest_data_date: string | null;
}

export interface FilteredRenewalData {
  orgRows: RenewalRow[];
  categoryRows: RenewalRow[];
  overall: RenewalRow | null;
}

export interface RenewalTrackerResponse {
  orgRows: RenewalRow[];
  categoryRows: RenewalRow[];
  overall: RenewalRow | null;
  meta?: RenewalTrackerMeta | null;
}
