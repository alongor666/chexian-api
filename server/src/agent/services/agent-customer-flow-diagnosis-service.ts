import {
  generateFlowMetadataQuery,
  generateFlowSummaryQuery,
  generateFlowTrendQuery,
  generateOutflowQuery,
  type CustomerFlowFilters,
} from '../../sql/customer-flow.js';
import {
  CustomerFlowDiagnosisResultSchema,
  type CustomerFlowDiagnosisResult,
} from '../schemas/agent-diagnosis.schema.js';

const REQUESTED_TOOLS = [
  'customer_flow.summary',
  'customer_flow.outflow',
  'customer_flow.trend',
  'customer_flow.metadata',
] as const;

const WARNINGS = [
  '客户流向诊断基于 CustomerFlow 当前视图，用于经营流向观察。',
  '当前 customer_flow 源不再提供转入字段；转入口径不可用，不输出净流入/净流出判断。',
  'metadata 仅用于数据新鲜度和 readiness 判断，不作为诊断指标主输出。',
  '客户流向诊断不输出承保利润、利润率、财务盈利或财务亏损。',
];

const FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损'];

type RawRow = Record<string, unknown>;
type Severity = 'normal' | 'observe' | 'warning' | 'critical';

export interface DiagnoseCustomerFlowRowsInput {
  filters: CustomerFlowFilters;
  limit: number;
  summaryRow: RawRow;
  inflowRows: RawRow[];
  outflowRows: RawRow[];
  trendRows: RawRow[];
  metadataRow: RawRow;
}

export interface RunCustomerFlowDiagnosisInput {
  filters: CustomerFlowFilters;
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

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value === 'string') {
    return value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
  }
  return [];
}

function severityForOutflow(outflowRate: number | null): Severity {
  if ((outflowRate ?? 0) >= 30) return 'critical';
  if ((outflowRate ?? 0) >= 20) return 'warning';
  if ((outflowRate ?? 0) > 0) return 'observe';
  return 'normal';
}

function mapInsurerRows(rows: RawRow[], limit: number) {
  return rows.slice(0, limit).map((row) => ({
    insurer: stringOf(row.insurer, '未知'),
    policyCount: toNullableNumber(row.policy_count),
    sharePct: toNullableNumber(row.share_pct),
  }));
}

function mapTrendRows(rows: RawRow[]) {
  return rows.map((row) => {
    const inflowCount = toNullableNumber(row.inflow_count);
    const outflowCount = toNullableNumber(row.outflow_count);
    const netFlow = inflowCount === null || outflowCount === null ? null : inflowCount - outflowCount;
    return {
      month: stringOf(row.month, '未知'),
      totalPolicies: toNullableNumber(row.total_policies),
      inflowCount,
      outflowCount,
      netFlow,
      direction: netFlow === null ? 'outflow_only' as const : netFlow > 0 ? 'net_inflow' as const : netFlow < 0 ? 'net_outflow' as const : 'balanced' as const,
    };
  });
}

function buildDataReadiness(filters: CustomerFlowFilters, metadataRow: RawRow) {
  const years = toNumberArray(metadataRow.years);
  const metadataRows = toNullableNumber(metadataRow.total_rows);
  const yearIsAvailable = filters.year === undefined || years.includes(filters.year);
  const totalRows = yearIsAvailable ? metadataRows : 0;

  return {
    minDate: stringOf(metadataRow.min_date, ''),
    maxDate: stringOf(metadataRow.max_date, ''),
    years,
    totalRows,
    status: totalRows && totalRows > 0 ? 'ready' as const : 'empty' as const,
  };
}

export function diagnoseCustomerFlowRows(input: DiagnoseCustomerFlowRowsInput): CustomerFlowDiagnosisResult {
  const totalPolicies = toNullableNumber(input.summaryRow.total_policies);
  const inflowCount = toNullableNumber(input.summaryRow.inflow_count);
  const outflowCount = toNullableNumber(input.summaryRow.outflow_count);
  const netFlow = inflowCount === null || outflowCount === null ? null : inflowCount - outflowCount;
  const inflowRate = rate(inflowCount, totalPolicies);
  const outflowRate = rate(outflowCount, totalPolicies);
  const outflowDiagnostics = mapInsurerRows(input.outflowRows, input.limit);
  const trendDiagnostics = mapTrendRows(input.trendRows);
  const latestTrend = trendDiagnostics.at(-1) ?? null;
  const dataReadiness = buildDataReadiness(input.filters, input.metadataRow);

  return CustomerFlowDiagnosisResultSchema.parse({
    capabilityId: 'customer_flow_diagnosis',
    status: 'supported',
    requestedTools: REQUESTED_TOOLS,
    filters: input.filters,
    summary: {
      totalPolicies,
      hasPrevious: toNullableNumber(input.summaryRow.has_previous),
      hasNext: toNullableNumber(input.summaryRow.has_next),
      inflowCount,
      outflowCount,
      netFlow,
      inflowRate,
      outflowRate,
      selfRenewalCount: toNullableNumber(input.summaryRow.self_renewal_count),
      topInflowInsurer: null,
      topOutflowInsurer: outflowDiagnostics[0]?.insurer ?? null,
      latestMonth: latestTrend?.month ?? null,
      latestNetFlow: latestTrend?.netFlow ?? null,
    },
    diagnostics: [
      {
        kind: 'outflow_only',
        severity: severityForOutflow(outflowRate),
        message: `转入口径不可用；客户流失到竞品 ${outflowCount ?? 0} 件`,
        value: outflowCount,
      },
    ],
    inflowDiagnostics: [],
    outflowDiagnostics,
    trendDiagnostics,
    dataReadiness,
    warnings: WARNINGS,
    forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    drilldownSuggestions: ['customer_flow.summary', 'customer_flow.outflow', 'customer_flow.trend'],
  });
}

export async function runCustomerFlowDiagnosis(input: RunCustomerFlowDiagnosisInput): Promise<CustomerFlowDiagnosisResult> {
  const { duckdbService } = await import('../../services/duckdb.js');

  const [summaryRows, outflowRows, trendRows, metadataRows] = await Promise.all([
    duckdbService.query<RawRow>(generateFlowSummaryQuery(input.filters)),
    duckdbService.query<RawRow>(generateOutflowQuery(input.filters)),
    duckdbService.query<RawRow>(generateFlowTrendQuery(input.filters)),
    duckdbService.query<RawRow>(generateFlowMetadataQuery()),
  ]);

  return diagnoseCustomerFlowRows({
    filters: input.filters,
    limit: input.limit,
    summaryRow: summaryRows[0] ?? {},
    inflowRows: [],
    outflowRows,
    trendRows,
    metadataRow: metadataRows[0] ?? {},
  });
}
