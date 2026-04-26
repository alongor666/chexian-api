import {
  generateQuoteDrilldownQuery,
  generateQuoteFunnelQuery,
  generateQuoteKpiQuery,
  generateQuoteTrendQuery,
  type QuoteConversionFilters,
} from '../../sql/quote-conversion.js';
import {
  QuoteConversionDiagnosisResultSchema,
  type QuoteConversionDiagnosisFilters,
  type QuoteConversionDiagnosisResult,
  type QuoteConversionDrilldownLevel,
  type QuoteConversionTrendGranularity,
} from '../schemas/agent-diagnosis.schema.js';

const REQUESTED_TOOLS = [
  'quote_conversion.kpi',
  'quote_conversion.funnel',
  'quote_conversion.drilldown',
  'quote_conversion.trend',
] as const;

const QUOTE_WARNINGS = [
  '报价转化诊断不代表利润、盈利、亏损或承保利润。',
  '本能力仅复用 kpi、funnel、drilldown、trend 四个报价转化工具，不纳入 heatmap、price、ranking。',
];
const FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损', '边际贡献'];

type RawQuoteRow = Record<string, unknown>;
type Severity = 'normal' | 'observe' | 'warning' | 'critical';

export interface DiagnoseQuoteConversionRowsInput {
  filters: QuoteConversionDiagnosisFilters;
  drilldownLevel: QuoteConversionDrilldownLevel;
  trendGranularity: QuoteConversionTrendGranularity;
  limit: number;
  kpiRow: RawQuoteRow;
  funnelRows: RawQuoteRow[];
  drilldownRows: RawQuoteRow[];
  trendRows: RawQuoteRow[];
}

export interface RunQuoteConversionDiagnosisInput {
  filters: QuoteConversionDiagnosisFilters;
  drilldownLevel: QuoteConversionDrilldownLevel;
  trendGranularity: QuoteConversionTrendGranularity;
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

function severityForRate(rateValue: number | null): Severity {
  if (rateValue === null) return 'normal';
  if (rateValue < 30) return 'critical';
  if (rateValue < 40) return 'warning';
  if (rateValue < 50) return 'observe';
  return 'normal';
}

function severityForDrop(dropRate: number | null): Severity {
  if (dropRate === null) return 'normal';
  if (dropRate < 0) return 'critical';
  if (dropRate >= 45) return 'critical';
  if (dropRate >= 30) return 'warning';
  if (dropRate >= 15) return 'observe';
  return 'normal';
}

function severityForTrendChange(rateChange: number | null): Severity {
  if (rateChange === null) return 'normal';
  if (rateChange <= -20) return 'critical';
  if (rateChange <= -10) return 'warning';
  if (rateChange < 0) return 'observe';
  return 'normal';
}

function stringOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function buildFunnelBottlenecks(rows: RawQuoteRow[], limit: number) {
  const stagePriority: Record<string, number> = {
    valid_to_quality: 0,
    quality_to_insured: 1,
    total_to_valid: 2,
  };
  return rows.flatMap((row) => {
    const renewalType = stringOf(row.renewal_type, '未知');
    const l1 = toNullableNumber(row.l1_total);
    const l2 = toNullableNumber(row.l2_valid);
    const l3 = toNullableNumber(row.l3_quality);
    const l4 = toNullableNumber(row.l4_insured);
    const candidates = [
      { renewalType, stage: 'total_to_valid' as const, fromCount: l1, toCount: l2, dropRate: l1 === null || l2 === null ? null : rate(l1 - l2, l1) },
      { renewalType, stage: 'valid_to_quality' as const, fromCount: l2, toCount: l3, dropRate: l2 === null || l3 === null ? null : rate(l2 - l3, l2) },
      { renewalType, stage: 'quality_to_insured' as const, fromCount: l3, toCount: l4, dropRate: l3 === null || l4 === null ? null : rate(l3 - l4, l3) },
    ];
    return candidates.map((item) => ({ ...item, severity: severityForDrop(item.dropRate) }));
  })
    .filter((item) => item.dropRate !== null && item.dropRate !== 0)
    .sort((a, b) => {
      const stageDiff = stagePriority[a.stage] - stagePriority[b.stage];
      if (stageDiff !== 0) return stageDiff;
      return (b.dropRate ?? 0) - (a.dropRate ?? 0);
    })
    .slice(0, limit);
}

function hasNegativeFunnelDrop(rows: RawQuoteRow[]): boolean {
  for (const row of rows) {
    const l1 = toNullableNumber(row.l1_total);
    const l2 = toNullableNumber(row.l2_valid);
    const l3 = toNullableNumber(row.l3_quality);
    const l4 = toNullableNumber(row.l4_insured);
    if (l1 !== null && l2 !== null && l2 > l1) return true;
    if (l2 !== null && l3 !== null && l3 > l2) return true;
    if (l3 !== null && l4 !== null && l4 > l3) return true;
  }
  return false;
}

function buildSegmentDifferences(rows: RawQuoteRow[], overallRate: number | null, limit: number) {
  return rows.map((row) => {
    const underwritingRate = toNullableNumber(row.underwriting_rate ?? row.conversion_rate);
    return {
      dimKey: stringOf(row.group_key, '未知'),
      dimName: stringOf(row.group_name, stringOf(row.group_key, '未知')),
      totalQuotes: toNullableNumber(row.total_quotes),
      totalInsured: toNullableNumber(row.total_insured),
      underwritingRate,
      renewalRate: toNullableNumber(row.renewal_rate),
      switchRate: toNullableNumber(row.switch_rate),
      gapFromOverall: underwritingRate === null || overallRate === null ? null : round4(underwritingRate - overallRate),
      severity: severityForRate(underwritingRate),
    };
  })
    .sort((a, b) => (a.underwritingRate ?? Number.POSITIVE_INFINITY) - (b.underwritingRate ?? Number.POSITIVE_INFINITY))
    .slice(0, limit);
}

function buildTrendAnomalies(rows: RawQuoteRow[], limit: number) {
  const byRenewalType = new Map<string, RawQuoteRow[]>();
  for (const row of rows) {
    const key = stringOf(row.renewal_type, '未知');
    byRenewalType.set(key, [...(byRenewalType.get(key) ?? []), row]);
  }

  const anomalies = Array.from(byRenewalType.entries()).flatMap(([renewalType, groupedRows]) => {
    const sortedRows = [...groupedRows].sort((a, b) => stringOf(a.time_bucket, '').localeCompare(stringOf(b.time_bucket, '')));
    return sortedRows.slice(1).map((row, index) => {
      const previous = sortedRows[index];
      const underwritingRate = toNullableNumber(row.underwriting_rate ?? row.conversion_rate);
      const previousRate = toNullableNumber(previous?.underwriting_rate ?? previous?.conversion_rate);
      const rateChange = underwritingRate === null || previousRate === null ? null : round4(underwritingRate - previousRate);
      return {
        timeBucket: stringOf(row.time_bucket, '未知'),
        renewalType,
        underwritingRate,
        previousRate,
        rateChange,
        severity: severityForTrendChange(rateChange),
      };
    });
  });

  return anomalies
    .filter((item) => item.rateChange !== null && item.rateChange < 0)
    .sort((a, b) => (a.rateChange ?? 0) - (b.rateChange ?? 0))
    .slice(0, limit);
}

export function diagnoseQuoteConversionRows(input: DiagnoseQuoteConversionRowsInput): QuoteConversionDiagnosisResult {
  const totalQuotes = toNullableNumber(input.kpiRow.total_quotes);
  const totalInsured = toNullableNumber(input.kpiRow.total_insured);
  const underwritingRate = toNullableNumber(input.kpiRow.underwriting_rate ?? input.kpiRow.conversion_rate);
  const renewalUnderwritingRate = rate(
    toNullableNumber(input.kpiRow.renewal_insured),
    toNullableNumber(input.kpiRow.renewal_quotes)
  );
  const switchUnderwritingRate = rate(
    toNullableNumber(input.kpiRow.switch_insured),
    toNullableNumber(input.kpiRow.switch_quotes)
  );
  const segmentDifferences = buildSegmentDifferences(input.drilldownRows, underwritingRate, input.limit);
  const trendAnomalies = buildTrendAnomalies(input.trendRows, input.limit);
  const warnings = [...QUOTE_WARNINGS];
  if (hasNegativeFunnelDrop(input.funnelRows)) {
    warnings.push('漏斗下游环节计数大于上游，疑似数据异常或口径错位，请优先核对源数据。');
  }

  return QuoteConversionDiagnosisResultSchema.parse({
    capabilityId: 'quote_conversion_diagnosis',
    status: 'supported',
    requestedTools: REQUESTED_TOOLS,
    filters: input.filters,
    drilldownLevel: input.drilldownLevel,
    trendGranularity: input.trendGranularity,
    summary: {
      totalQuotes,
      totalInsured,
      underwritingRate,
      avgDiscountRate: toNullableNumber(input.kpiRow.avg_discount_rate),
      renewalUnderwritingRate,
      switchUnderwritingRate,
      worstSegment: segmentDifferences[0]?.dimName ?? null,
      trendDropCount: trendAnomalies.length,
    },
    funnelBottlenecks: buildFunnelBottlenecks(input.funnelRows, input.limit),
    segmentDifferences,
    trendAnomalies,
    warnings,
    forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    drilldownSuggestions: ['team', 'salesman', 'customerCategory', 'insuranceCombo', 'riskGrade'],
  });
}

export async function runQuoteConversionDiagnosis(input: RunQuoteConversionDiagnosisInput): Promise<QuoteConversionDiagnosisResult> {
  const { duckdbService } = await import('../../services/duckdb.js');
  const filters = input.filters as QuoteConversionFilters;

  const [kpiRows, funnelRows, drilldownRows, trendRows] = await Promise.all([
    duckdbService.query<RawQuoteRow>(generateQuoteKpiQuery(filters)),
    duckdbService.query<RawQuoteRow>(generateQuoteFunnelQuery(filters)),
    duckdbService.query<RawQuoteRow>(generateQuoteDrilldownQuery(filters, input.drilldownLevel)),
    duckdbService.query<RawQuoteRow>(generateQuoteTrendQuery(filters, input.trendGranularity)),
  ]);

  return diagnoseQuoteConversionRows({
    filters: input.filters,
    drilldownLevel: input.drilldownLevel,
    trendGranularity: input.trendGranularity,
    limit: input.limit,
    kpiRow: kpiRows[0] ?? {},
    funnelRows,
    drilldownRows,
    trendRows,
  });
}
