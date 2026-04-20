export interface RenewalRow {
  row_level: string;
  org_level_3: string | null;
  team_name: string | null;
  salesman_name: string | null;
  customer_category: string | null;
  coverage_combination: string | null;
  fuel_category: string | null;
  used_transfer_type: string | null;
  renewal_type: string | null;
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

export type TimeView = 'ytd' | 'mtd_today' | 'next_to_eom' | 'next_30_days' | 'by_month';

/**
 * 左侧表格当前选中口径（驱动右侧联动面板）
 */
export type Selection =
  | { kind: 'overall' }
  | { kind: 'org'; org: string }
  | { kind: 'team'; org: string; team: string }
  | { kind: 'salesman'; org: string; team: string | null; salesman: string };

/**
 * 右侧联动面板 Tab 维度
 */
export type LinkageDimension =
  | 'customer_category'
  | 'coverage_combination'
  | 'fuel_category'
  | 'used_transfer_type'
  | 'renewal_type';

export interface RenewalTrackerMeta {
  exposure_row_count: number;
  distinct_vehicle_count: number;
  distinct_source_policy_count: number;
  latest_data_date: string | null;
}

export interface RenewalTrackerResponse {
  orgRows: RenewalRow[];
  categoryRows: RenewalRow[];
  coverageRows: RenewalRow[];
  fuelRows: RenewalRow[];
  usedTransferRows: RenewalRow[];
  renewalTypeRows: RenewalRow[];
  overall: RenewalRow | null;
  meta?: RenewalTrackerMeta | null;
}
