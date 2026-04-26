import {
  generateCauseAnalysisQuery,
  generateFrequencyYoyQuery,
  generatePendingOverviewQuery,
  type ClaimsDetailFilters,
} from '../../sql/claims-detail.js';
import {
  ClaimsRiskDiagnosisResultSchema,
  type ClaimsRiskDiagnosisFilters,
  type ClaimsRiskDiagnosisResult,
} from '../schemas/agent-diagnosis.schema.js';

const REQUESTED_TOOLS = [
  'claims_detail.pending_overview',
  'claims_detail.cause_analysis',
  'claims_detail.frequency_yoy',
] as const;

const WARNINGS = [
  'ClaimsDetail 是当前快照视图，可用于赔案风险经营诊断。',
  '本能力不代表完整准备金、IBNR、精算终极赔付或财务盈亏判断。',
  '赔案风险诊断不输出承保利润、利润率、财务盈利或财务亏损。',
];
const FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损', '边际贡献', 'IBNR'];

type Severity = 'normal' | 'observe' | 'warning' | 'critical';
type RawRow = Record<string, unknown>;

export interface DiagnoseClaimsRiskRowsInput {
  filters: ClaimsRiskDiagnosisFilters;
  limit: number;
  pendingOverviewRows: RawRow[];
  causeRows: RawRow[];
  frequencyRows: RawRow[];
}

export interface RunClaimsRiskDiagnosisInput {
  filters: ClaimsRiskDiagnosisFilters;
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

function stringOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function isPendingStatus(status: unknown): boolean {
  return typeof status === 'string' && status.includes('未');
}

function severityForPending(pendingShare: number | null, pendingReserveWan: number | null): Severity {
  if ((pendingShare ?? 0) >= 20 || (pendingReserveWan ?? 0) >= 500) return 'critical';
  if ((pendingShare ?? 0) >= 10 || (pendingReserveWan ?? 0) >= 200) return 'warning';
  if ((pendingShare ?? 0) > 0 || (pendingReserveWan ?? 0) > 0) return 'observe';
  return 'normal';
}

function severityForCause(avgReserve: number | null, injuryPct: number | null): Severity {
  if ((avgReserve ?? 0) >= 25000 || (injuryPct ?? 0) >= 15) return 'critical';
  if ((avgReserve ?? 0) >= 15000 || (injuryPct ?? 0) >= 8) return 'warning';
  if ((avgReserve ?? 0) > 0 || (injuryPct ?? 0) > 0) return 'observe';
  return 'normal';
}

function severityForFrequency(yoyChange: number | null): Severity {
  if (yoyChange === null) return 'normal';
  if (yoyChange >= 10) return 'critical';
  if (yoyChange >= 5) return 'warning';
  if (yoyChange > 0) return 'observe';
  return 'normal';
}

function severityRank(severity: Severity): number {
  return { critical: 0, warning: 1, observe: 2, normal: 3 }[severity];
}

function buildPendingRisk(rows: RawRow[]) {
  const totalCases = rows.reduce((sum, row) => sum + (toNullableNumber(row.cases) ?? 0), 0);
  const pendingRow = rows.find((row) => isPendingStatus(row.claim_status)) ?? null;
  const pendingCases = toNullableNumber(pendingRow?.cases);
  const pendingReserveWan = toNullableNumber(pendingRow?.reserve_wan);
  const pendingCaseShare = rate(pendingCases, totalCases);

  return {
    totalCases,
    pendingRisk: {
      pendingCases,
      pendingReserveWan,
      avgReserve: toNullableNumber(pendingRow?.avg_reserve),
      injuryCases: toNullableNumber(pendingRow?.injury_cases),
      injuryReserveWan: toNullableNumber(pendingRow?.injury_reserve_wan),
      pendingCaseShare,
      severity: severityForPending(pendingCaseShare, pendingReserveWan),
    },
  };
}

function buildCauseDiagnostics(rows: RawRow[], limit: number) {
  return rows
    .map((row) => {
      const avgReserve = toNullableNumber(row.avg_reserve);
      const injuryPct = toNullableNumber(row.injury_pct);
      return {
        accidentCause: stringOf(row.accident_cause, '未知'),
        cases: toNullableNumber(row.cases),
        reserveWan: toNullableNumber(row.reserve_wan),
        avgReserve,
        injuryCases: toNullableNumber(row.injury_cases),
        injuryPct,
        severity: severityForCause(avgReserve, injuryPct),
      };
    })
    .sort((a, b) => {
      const severityDiff = severityRank(a.severity) - severityRank(b.severity);
      if (severityDiff !== 0) return severityDiff;
      return (b.reserveWan ?? 0) - (a.reserveWan ?? 0);
    })
    .slice(0, limit);
}

function buildFrequencyDiagnosticSeries(rows: RawRow[]) {
  const sortedRows = [...rows].sort((a, b) => {
    const yearDiff = (toNullableNumber(a.year) ?? 0) - (toNullableNumber(b.year) ?? 0);
    if (yearDiff !== 0) return yearDiff;
    return (toNullableNumber(a.quarter) ?? 0) - (toNullableNumber(b.quarter) ?? 0);
  });
  const previousByQuarter = new Map<number, number | null>();

  return sortedRows.map((row) => {
    const year = toNullableNumber(row.year) ?? 0;
    const quarter = toNullableNumber(row.quarter) ?? 0;
    const freqPer1000 = toNullableNumber(row.freq_per_1000);
    const previousFreqPer1000 = previousByQuarter.get(quarter) ?? null;
    const yoyChange = freqPer1000 === null || previousFreqPer1000 === null
      ? null
      : round4(freqPer1000 - previousFreqPer1000);
    previousByQuarter.set(quarter, freqPer1000);
    return {
      period: `${year}-Q${quarter}`,
      year,
      quarter,
      claimCount: toNullableNumber(row.claim_count),
      policyCount: toNullableNumber(row.policy_count),
      reserveWan: toNullableNumber(row.reserve_wan),
      freqPer1000,
      injuryPct: toNullableNumber(row.injury_pct),
      previousFreqPer1000,
      yoyChange,
      severity: severityForFrequency(yoyChange),
    };
  });
}

function buildFrequencyDiagnostics(rows: RawRow[], limit: number) {
  return buildFrequencyDiagnosticSeries(rows)
    .filter((item) => item.yoyChange !== null)
    .sort((a, b) => {
      const severityDiff = severityRank(a.severity) - severityRank(b.severity);
      if (severityDiff !== 0) return severityDiff;
      return (b.yoyChange ?? 0) - (a.yoyChange ?? 0);
    })
    .slice(0, limit);
}

export function diagnoseClaimsRiskRows(input: DiagnoseClaimsRiskRowsInput): ClaimsRiskDiagnosisResult {
  const { totalCases, pendingRisk } = buildPendingRisk(input.pendingOverviewRows);
  const causeDiagnostics = buildCauseDiagnostics(input.causeRows, input.limit);
  const topCauseByCases = [...input.causeRows]
    .sort((a, b) => (toNullableNumber(b.cases) ?? 0) - (toNullableNumber(a.cases) ?? 0))[0];
  const frequencySeries = buildFrequencyDiagnosticSeries(input.frequencyRows);
  const frequencyDiagnostics = buildFrequencyDiagnostics(input.frequencyRows, input.limit);
  const latestFrequencyDiagnostic = frequencySeries.at(-1) ?? null;

  return ClaimsRiskDiagnosisResultSchema.parse({
    capabilityId: 'claims_risk_diagnosis',
    status: 'supported',
    requestedTools: REQUESTED_TOOLS,
    filters: input.filters,
    summary: {
      totalCases,
      pendingCases: pendingRisk.pendingCases,
      pendingReserveWan: pendingRisk.pendingReserveWan,
      pendingCaseShare: pendingRisk.pendingCaseShare,
      topCause: topCauseByCases ? stringOf(topCauseByCases.accident_cause, '未知') : null,
      latestFrequencyPer1000: latestFrequencyDiagnostic?.freqPer1000 ?? null,
      latestFrequencyYoyChange: latestFrequencyDiagnostic?.yoyChange ?? null,
    },
    pendingRisk,
    causeDiagnostics,
    frequencyDiagnostics,
    warnings: WARNINGS,
    forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    drilldownSuggestions: ['pending-overview', 'cause-analysis', 'frequency-yoy', 'org_level_3', 'customer_category', 'coverage_combination'],
  });
}

export async function runClaimsRiskDiagnosis(input: RunClaimsRiskDiagnosisInput): Promise<ClaimsRiskDiagnosisResult> {
  const { duckdbService } = await import('../../services/duckdb.js');
  const filters = input.filters as ClaimsDetailFilters;

  const [pendingOverviewRows, causeRows, frequencyRows] = await Promise.all([
    duckdbService.query<RawRow>(generatePendingOverviewQuery(filters)),
    duckdbService.query<RawRow>(generateCauseAnalysisQuery(filters)),
    duckdbService.query<RawRow>(generateFrequencyYoyQuery(filters)),
  ]);

  return diagnoseClaimsRiskRows({
    filters: input.filters,
    limit: input.limit,
    pendingOverviewRows,
    causeRows,
    frequencyRows,
  });
}
