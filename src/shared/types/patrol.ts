/**
 * 巡检报告类型定义
 */

export type PatrolAlertLevel = 'red' | 'orange' | 'yellow' | 'green';

export interface MetricResult {
  value: number | null;
  display: string;
  alert: PatrolAlertLevel;
  display_name?: string;
}

export interface PatrolFinding {
  dim_value: string;
  sample_size: number;
  metrics: Record<string, MetricResult>;
  worst_alert: PatrolAlertLevel;
}

export interface PatrolSection {
  dimension_id: string;
  dimension_name: string;
  group_count: number;
  findings: PatrolFinding[];
}

export interface PatrolBlindspot {
  dimensions: Array<{ id: string; name: string; value: string }>;
  metric_id: string;
  metric_name: string;
  metric_value: number;
  metric_display: string;
  overall_value: number;
  overall_display: string;
  deviation: number;
  deviation_display: string;
  sample_size: number;
  alert: PatrolAlertLevel;
  direction: 'above' | 'below';
}

export interface PatrolComparison {
  prev_period: string;
  curr_period: string;
  prev_sample: number;
  curr_sample: number;
  changes: Array<{
    metric_id: string;
    metric_name: string;
    prev_value: number;
    curr_value: number;
    prev_display: string;
    curr_display: string;
    change: number;
    change_display: string;
    significant: boolean;
  }>;
}

export interface AIFinding {
  severity: PatrolAlertLevel;
  title: string;
  metric_value: string;
  overall_value: string;
  narrative: string;
  dimensions: Array<{ id: string; value: string }>;
  evidence?: Array<{ query: string; result: string }>;
  discovered_via: 'config_drill' | 'cross_drill' | 'exploration';
}

export interface AIPatrolMeta {
  generated_at: string;
  queries_executed: number;
  extra_dimensions_explored: string[];
  duration_seconds: number;
}

export interface PatrolReport {
  domain: string;
  display_name: string;
  generated_at: string;
  data_source: string;
  summary: {
    total_records?: number;
    total_alerts: number;
    red_count: number;
    orange_count: number;
    yellow_count: number;
    green_count: number;
    dimensions_checked: number;
    blindspots_found: number;
    comparisons_checked: number;
    elapsed_seconds: number;
  };
  overall: Record<string, MetricResult>;
  sections: PatrolSection[];
  blindspots: PatrolBlindspot[];
  comparisons: PatrolComparison[];
  alerts: Record<PatrolAlertLevel, number>;
  ai_findings?: AIFinding[];
  ai_meta?: AIPatrolMeta;
}
