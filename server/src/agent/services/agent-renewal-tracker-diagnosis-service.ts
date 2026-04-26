import {
  generateRenewalTrackerMetaQuery,
  generateRenewalTrackerQuery,
} from '../../sql/renewal-tracker.js';
import {
  RenewalTrackerDiagnosisResultSchema,
  type RenewalTrackerDiagnosisFilters,
  type RenewalTrackerDiagnosisResult,
} from '../schemas/agent-diagnosis.schema.js';

const REQUESTED_TOOLS = ['renewal_tracker.query'] as const;
const WARNINGS = [
  '续保追踪诊断使用 RenewalTrackerFact 的 expiry_date 到期口径，以及 cutoff 截至日内的报价/续保状态。',
  ['不使用已下线 ', 'renewal ', 'funnel/v2。'].join(''),
  '续保追踪指标不代表利润、盈利、亏损或承保利润。',
];
const FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损', '边际贡献'];

type Severity = 'normal' | 'observe' | 'warning' | 'critical';
type DimensionKey = 'customer_category' | 'coverage_combination' | 'fuel_category' | 'used_transfer_type' | 'renewal_type';

export interface RenewalTrackerRow {
  row_level: string;
  org_level_3: string | null;
  team_name: string | null;
  salesman_name: string | null;
  customer_category: string | null;
  coverage_combination: string | null;
  fuel_category: string | null;
  used_transfer_type: string | null;
  renewal_type: string | null;
  A: number | bigint | null;
  B: number | bigint | null;
  C: number | bigint | null;
}

export interface RenewalTrackerMetaRow {
  exposure_row_count: number | bigint | null;
  distinct_vehicle_count: number | bigint | null;
  distinct_source_policy_count: number | bigint | null;
  latest_data_date: string | null;
}

export interface DiagnoseRenewalTrackerRowsInput {
  start: string;
  end: string;
  cutoff: string;
  filters: RenewalTrackerDiagnosisFilters;
  limit: number;
  rows: RenewalTrackerRow[];
  meta: RenewalTrackerMetaRow | null;
}

export interface RunRenewalTrackerDiagnosisInput {
  start: string;
  end: string;
  cutoff: string;
  filters: RenewalTrackerDiagnosisFilters;
  extraConditions: string[];
  limit: number;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round4((numerator / denominator) * 100);
}

function severityForRenewalRate(renewalRate: number | null): Severity {
  if (renewalRate === null) return 'normal';
  if (renewalRate < 30) return 'critical';
  if (renewalRate < 45) return 'warning';
  if (renewalRate < 60) return 'observe';
  return 'normal';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function metricsFromRow(row: RenewalTrackerRow | null) {
  const expectedRenewalCount = toNullableNumber(row?.A);
  const quotedCount = toNullableNumber(row?.B);
  const renewedCount = toNullableNumber(row?.C);
  return {
    expectedRenewalCount,
    quotedCount,
    renewedCount,
    quoteRate: rate(quotedCount, expectedRenewalCount),
    renewalRate: rate(renewedCount, expectedRenewalCount),
    quoteToRenewalRate: rate(renewedCount, quotedCount),
    quoteGap: expectedRenewalCount === null || quotedCount === null ? null : Math.max(expectedRenewalCount - quotedCount, 0),
    renewalGap: expectedRenewalCount === null || renewedCount === null ? null : Math.max(expectedRenewalCount - renewedCount, 0),
  };
}

function buildSegmentKey(row: RenewalTrackerRow): string {
  return [row.org_level_3, row.team_name, row.salesman_name].filter((item): item is string => Boolean(item)).join(' / ') || '整体';
}

function buildSegmentDiagnostics(rows: RenewalTrackerRow[], limit: number) {
  return rows
    .filter((row) => ['org', 'team', 'salesman'].includes(row.row_level))
    .map((row) => {
      const metrics = metricsFromRow(row);
      return {
        level: row.row_level as 'org' | 'team' | 'salesman',
        dimKey: buildSegmentKey(row),
        orgName: stringOrNull(row.org_level_3),
        teamName: stringOrNull(row.team_name),
        salesmanName: stringOrNull(row.salesman_name),
        ...metrics,
        severity: severityForRenewalRate(metrics.renewalRate),
      };
    })
    .filter((item) => item.expectedRenewalCount !== null && item.expectedRenewalCount > 0)
    .sort((a, b) => {
      const severityRank: Record<Severity, number> = { critical: 0, warning: 1, observe: 2, normal: 3 };
      const severityDiff = severityRank[a.severity] - severityRank[b.severity];
      if (severityDiff !== 0) return severityDiff;
      const rateDiff = (a.renewalRate ?? Number.POSITIVE_INFINITY) - (b.renewalRate ?? Number.POSITIVE_INFINITY);
      if (rateDiff !== 0) return rateDiff;
      return (b.expectedRenewalCount ?? 0) - (a.expectedRenewalCount ?? 0);
    })
    .slice(0, limit);
}

function dimensionKey(row: RenewalTrackerRow, dimension: DimensionKey): string {
  return stringOrNull(row[dimension]) ?? '未知';
}

function buildDimensionDiagnostics(rows: RenewalTrackerRow[], limit: number) {
  const dimensionMap: Array<[DimensionKey, string]> = [
    ['customer_category', 'overall_category'],
    ['coverage_combination', 'overall_coverage'],
    ['fuel_category', 'overall_fuel'],
    ['used_transfer_type', 'overall_used_transfer'],
    ['renewal_type', 'overall_renewal_type'],
  ];

  return dimensionMap
    .flatMap(([dimension, rowLevel]) =>
      rows
        .filter((row) => row.row_level === rowLevel)
        .map((row) => {
          const metrics = metricsFromRow(row);
          return {
            dimension,
            dimKey: dimensionKey(row, dimension),
            ...metrics,
            severity: severityForRenewalRate(metrics.renewalRate),
          };
        })
    )
    .filter((item) => item.expectedRenewalCount !== null && item.expectedRenewalCount > 0)
    .sort((a, b) => {
      const severityRank: Record<Severity, number> = { critical: 0, warning: 1, observe: 2, normal: 3 };
      const severityDiff = severityRank[a.severity] - severityRank[b.severity];
      if (severityDiff !== 0) return severityDiff;
      const rateDiff = (a.renewalRate ?? Number.POSITIVE_INFINITY) - (b.renewalRate ?? Number.POSITIVE_INFINITY);
      if (rateDiff !== 0) return rateDiff;
      return (b.expectedRenewalCount ?? 0) - (a.expectedRenewalCount ?? 0);
    })
    .slice(0, limit);
}

export function diagnoseRenewalTrackerRows(input: DiagnoseRenewalTrackerRowsInput): RenewalTrackerDiagnosisResult {
  const overall = input.rows.find((row) => row.row_level === 'overall') ?? null;
  const summaryMetrics = metricsFromRow(overall);
  const segmentDiagnostics = buildSegmentDiagnostics(input.rows, input.limit);
  const dimensionDiagnostics = buildDimensionDiagnostics(input.rows, input.limit);
  const weakSegmentCount = segmentDiagnostics.filter((item) => item.severity === 'critical' || item.severity === 'warning').length;

  return RenewalTrackerDiagnosisResultSchema.parse({
    capabilityId: 'renewal_tracker_diagnosis',
    status: 'supported',
    requestedTools: REQUESTED_TOOLS,
    start: input.start,
    end: input.end,
    cutoff: input.cutoff,
    filters: input.filters,
    summary: {
      ...summaryMetrics,
      exposureRowCount: toNullableNumber(input.meta?.exposure_row_count),
      distinctVehicleCount: toNullableNumber(input.meta?.distinct_vehicle_count),
      distinctSourcePolicyCount: toNullableNumber(input.meta?.distinct_source_policy_count),
      latestDataDate: input.meta?.latest_data_date ?? null,
      weakSegmentCount,
    },
    segmentDiagnostics,
    dimensionDiagnostics,
    cutoffExplanation: `续保追踪按 expiry_date 在 ${input.start} 至 ${input.end} 的到期范围取应续对象，B/C 指标按 cutoff=${input.cutoff} 截至日统计报价和续保状态。`,
    warnings: WARNINGS,
    forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    drilldownSuggestions: ['org', 'team', 'salesman', 'customer_category', 'coverage_combination', 'fuel_category', 'used_transfer_type', 'renewal_type'],
  });
}

export async function runRenewalTrackerDiagnosis(input: RunRenewalTrackerDiagnosisInput): Promise<RenewalTrackerDiagnosisResult> {
  const { duckdbService } = await import('../../services/duckdb.js');
  const [rows, metaRows] = await Promise.all([
    duckdbService.query<RenewalTrackerRow>(generateRenewalTrackerQuery({
      start: input.start,
      end: input.end,
      cutoff: input.cutoff,
      extraConditions: input.extraConditions,
    })),
    duckdbService.query<RenewalTrackerMetaRow>(generateRenewalTrackerMetaQuery()),
  ]);

  return diagnoseRenewalTrackerRows({
    start: input.start,
    end: input.end,
    cutoff: input.cutoff,
    filters: input.filters,
    limit: input.limit,
    rows,
    meta: metaRows[0] ?? null,
  });
}
