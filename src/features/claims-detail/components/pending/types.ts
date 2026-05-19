/**
 * 未决赔案监控面板专用类型
 */

export type Severity = 'bad' | 'warn' | 'good' | 'neutral';

export interface OverviewRow {
  claim_status?: string;
  cases?: number;
  injury_cases?: number;
  reserve_wan?: number;
  injury_reserve_wan?: number;
  avg_reserve?: number;
}

export interface OrgRow {
  org?: string;
  cases?: number;
  reserve_wan?: number;
  avg_reserve?: number;
  injury_cases?: number;
  avg_pending_days?: number;
  max_pending_days?: number;
}

export interface AgingRow {
  aging_bucket?: string;
  cases?: number;
  reserve_wan?: number;
}

export interface CauseRow {
  accident_cause?: string;
  cases?: number;
  reserve_wan?: number;
  avg_reserve?: number;
  injury_pct?: number;
}

export interface CycleRow {
  type?: string;
  cases?: number;
  avg_report_days?: number;
  avg_open_days?: number;
  avg_settle_days?: number;
  avg_pay_days?: number;
  avg_total_days?: number;
  median_total_days?: number;
}

export interface Insight {
  id: string;
  severity: Severity;
  iconKey: 'alert' | 'clock' | 'activity' | 'check';
  title: string;
  body: string;
  metricValue: string;
  metricLabel: string;
}
