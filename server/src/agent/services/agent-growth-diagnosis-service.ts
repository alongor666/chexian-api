import {
  generateDailyGrowthWithContextQuery,
  generateGrowthQuery,
  type GrowthType,
  type TimeView,
} from '../../sql/growth.js';
import {
  GrowthDiagnosisResultSchema,
  type GrowthDiagnosisComparisonMode,
  type GrowthDiagnosisDimension,
  type GrowthDiagnosisPerspective,
  type GrowthDiagnosisResult,
  type GrowthDiagnosisTimeView,
} from '../schemas/agent-diagnosis.schema.js';

const GROWTH_WARNINGS = [
  '增长诊断只解释保费规模和件数变化，不代表利润、盈利、亏损或承保利润。',
  '本能力复用项目现有增长 SQL 生成器，不生成自由 SQL。',
];
const FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损'];

type RawGrowthRow = Record<string, unknown>;

export interface GrowthDiagnosisPeriod {
  startDate: string;
  endDate: string;
}

export interface DiagnoseGrowthRowsInput {
  currentPeriod: GrowthDiagnosisPeriod;
  baselinePeriod: GrowthDiagnosisPeriod;
  comparisonMode: GrowthDiagnosisComparisonMode;
  timeView: GrowthDiagnosisTimeView;
  perspective?: GrowthDiagnosisPerspective;
  dimension: GrowthDiagnosisDimension;
  limit: number;
  minCurrentValue: number;
  comparisonRows: RawGrowthRow[];
  dailyContextRows?: RawGrowthRow[];
}

export interface RunGrowthDiagnosisInput {
  currentPeriod: GrowthDiagnosisPeriod;
  baselinePeriod: GrowthDiagnosisPeriod;
  comparisonMode: GrowthDiagnosisComparisonMode;
  timeView: GrowthDiagnosisTimeView;
  perspective: GrowthDiagnosisPerspective;
  dimension: GrowthDiagnosisDimension;
  whereClause: string;
  includeDailyContext: boolean;
  limit: number;
  minCurrentValue: number;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dimKeyOf(row: RawGrowthRow, dimension: GrowthDiagnosisDimension): string {
  const raw = row.dim_key ?? row[dimension];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : '整体';
}

function timePeriodOf(row: RawGrowthRow): string {
  const raw = row.time_period;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return raw === null || raw === undefined ? '' : String(raw);
}

function severityOf(growthRate: number | null): 'critical_decline' | 'warning_decline' | 'observe_decline' | 'normal' | 'high_growth' {
  if (growthRate === null) return 'normal';
  if (growthRate <= -0.2) return 'critical_decline';
  if (growthRate <= -0.1) return 'warning_decline';
  if (growthRate < 0) return 'observe_decline';
  if (growthRate >= 0.2) return 'high_growth';
  return 'normal';
}

function directionOf(contributionAmount: number | null): 'increase' | 'decline' | 'flat' | 'unknown' {
  if (contributionAmount === null) return 'unknown';
  if (contributionAmount > 0) return 'increase';
  if (contributionAmount < 0) return 'decline';
  return 'flat';
}

function share(part: number | null, total: number): number | null {
  if (part === null || total === 0) return null;
  return Number((part / Math.abs(total)).toFixed(4));
}

function drilldownsFor(dimension: GrowthDiagnosisDimension): string[] {
  switch (dimension) {
    case 'org_level_3':
      return ['customer_category', 'coverage_combination', 'salesman_name'];
    case 'customer_category':
      return ['org_level_3', 'coverage_combination'];
    case 'coverage_combination':
      return ['org_level_3', 'customer_category'];
    case 'salesman_name':
      return ['org_level_3', 'customer_category'];
  }
}

function metricExpressionFor(perspective: GrowthDiagnosisPerspective): string {
  return perspective === 'policy_count' ? 'COUNT(*)' : 'SUM(premium)';
}

export function diagnoseGrowthRows(input: DiagnoseGrowthRowsInput): GrowthDiagnosisResult {
  const totalCurrentValue = input.comparisonRows.reduce((sum, row) => sum + (toNullableNumber(row.current_value) ?? 0), 0);
  const totalBaselineValue = input.comparisonRows.reduce((sum, row) => sum + (toNullableNumber(row.previous_value) ?? 0), 0);
  const totalDelta = totalCurrentValue - totalBaselineValue;

  const diagnostics = input.comparisonRows
    .map((row) => {
      const currentValue = toNullableNumber(row.current_value);
      const baselineValue = toNullableNumber(row.previous_value ?? row.baseline_value);
      const growthRate = toNullableNumber(row.growth_rate);
      const contributionAmount = currentValue === null || baselineValue === null
        ? null
        : Number((currentValue - baselineValue).toFixed(4));

      return {
        dimKey: dimKeyOf(row, input.dimension),
        severity: severityOf(growthRate),
        currentValue,
        baselineValue,
        growthRate,
        contributionAmount,
        contributionShare: share(contributionAmount, totalDelta),
        direction: directionOf(contributionAmount),
      };
    })
    .filter((item) => (item.currentValue ?? 0) >= input.minCurrentValue)
    .sort((a, b) => {
      const aRate = a.growthRate ?? Number.POSITIVE_INFINITY;
      const bRate = b.growthRate ?? Number.POSITIVE_INFINITY;
      return aRate - bRate;
    })
    .slice(0, input.limit)
    .map((item, index) => ({ rank: index + 1, ...item }));

  const positive = diagnostics
    .filter((item) => (item.contributionAmount ?? 0) > 0)
    .sort((a, b) => (b.contributionAmount ?? 0) - (a.contributionAmount ?? 0))[0];
  const negative = diagnostics
    .filter((item) => (item.contributionAmount ?? 0) < 0)
    .sort((a, b) => (a.contributionAmount ?? 0) - (b.contributionAmount ?? 0))[0];

  const dailyContext = (input.dailyContextRows ?? []).map((row) => ({
    timePeriod: timePeriodOf(row),
    currentValue: toNullableNumber(row.current_value),
    baselineValue: toNullableNumber(row.previous_value ?? row.baseline_value),
    growthRate: toNullableNumber(row.growth_rate),
    periodGrowthRate: toNullableNumber(row.period_growth_rate),
    ytdGrowthRate: toNullableNumber(row.ytd_growth_rate),
  }));

  return GrowthDiagnosisResultSchema.parse({
    capabilityId: 'growth_diagnosis',
    status: 'supported',
    comparisonMode: input.comparisonMode,
    timeView: input.timeView,
    perspective: input.perspective ?? 'premium',
    dimension: input.dimension,
    currentPeriod: input.currentPeriod,
    baselinePeriod: input.baselinePeriod,
    requestedTools: input.dailyContextRows ? ['growth.query', 'growth.daily_context'] : ['growth.query'],
    summary: {
      rowCount: input.comparisonRows.length,
      diagnosedCount: diagnostics.length,
      declineCount: diagnostics.filter((item) => item.direction === 'decline').length,
      highGrowthCount: diagnostics.filter((item) => item.severity === 'high_growth').length,
      totalCurrentValue,
      totalBaselineValue,
      overallGrowthRate: totalBaselineValue === 0 ? null : Number(((totalCurrentValue - totalBaselineValue) / totalBaselineValue).toFixed(6)),
      topPositiveContributor: positive?.dimKey ?? null,
      topNegativeContributor: negative?.dimKey ?? null,
    },
    diagnostics,
    dailyContext,
    warnings: GROWTH_WARNINGS,
    forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
    drilldownSuggestions: drilldownsFor(input.dimension),
  });
}

export async function runGrowthDiagnosis(input: RunGrowthDiagnosisInput): Promise<GrowthDiagnosisResult> {
  const { getAgentDuckdb } = await import('./agent-query-cache.js');
  const duckdbService = await getAgentDuckdb();
  const metric = metricExpressionFor(input.perspective);
  const config = {
    growthType: 'custom' as GrowthType,
    timeView: input.timeView as TimeView,
    whereClause: input.whereClause,
    currentPeriod: input.currentPeriod,
    baselinePeriod: input.baselinePeriod,
    groupBy: [input.dimension],
    metric,
  };

  const comparisonPromise = duckdbService.query<RawGrowthRow>(generateGrowthQuery(config));
  const dailyContextPromise = input.includeDailyContext
    ? duckdbService.query<RawGrowthRow>(generateDailyGrowthWithContextQuery({
      ...config,
      timeView: 'daily' as TimeView,
    }))
    : Promise.resolve(undefined);

  const [comparisonRows, dailyContextRows] = await Promise.all([comparisonPromise, dailyContextPromise]);

  return diagnoseGrowthRows({
    currentPeriod: input.currentPeriod,
    baselinePeriod: input.baselinePeriod,
    comparisonMode: input.comparisonMode,
    timeView: input.timeView,
    perspective: input.perspective,
    dimension: input.dimension,
    limit: input.limit,
    minCurrentValue: input.minCurrentValue,
    comparisonRows,
    dailyContextRows,
  });
}
