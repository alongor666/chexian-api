import {
  generateClaimRatioQuery,
  generateExpenseRatioQuery,
  generateVariableCostQuery,
  type CostDimension,
} from '../../sql/cost.js';
import {
  CostIndicatorDiagnosisResultSchema,
  type CostIndicatorDiagnosisResult,
  type CostIndicatorDimension,
} from '../schemas/agent-diagnosis.schema.js';

const REQUESTED_TOOLS = ['cost.variable_cost', 'cost.claim_ratio', 'cost.expense_ratio'] as const;
const COST_WARNINGS = [
  '本诊断分析的是项目内经营成本指标，不是完整财务承保利润分析。',
  '变动成本率为项目内经营分析口径，不代表完整财务综合成本率。',
  '不得据此输出承保利润、利润率、财务盈利或财务亏损结论。',
];
const FORBIDDEN_INTERPRETATIONS = ['承保利润', '利润率', '财务盈利', '财务亏损', '财务综合成本率'];

type RawCostRow = Record<string, unknown>;

export interface DiagnoseCostIndicatorRowsInput {
  cutoffDate: string;
  dimension: CostIndicatorDimension;
  limit: number;
  minPremium: number;
  variableCostRows: RawCostRow[];
  claimRatioRows: RawCostRow[];
  expenseRatioRows: RawCostRow[];
}

export interface RunCostIndicatorDiagnosisInput {
  cutoffDate: string;
  dimension: CostIndicatorDimension;
  whereClause: string;
  limit: number;
  minPremium: number;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dimKeyOf(row: RawCostRow): string {
  const raw = row.dim_key;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : '未知';
}

function indexByDimKey(rows: RawCostRow[]): Map<string, RawCostRow> {
  return new Map(rows.map((row) => [dimKeyOf(row), row]));
}

function severityOf(variableCostRatio: number | null): 'normal' | 'observe' | 'warning' | 'critical' {
  if (variableCostRatio === null) return 'normal';
  if (variableCostRatio >= 100) return 'critical';
  if (variableCostRatio >= 94) return 'warning';
  if (variableCostRatio >= 91) return 'observe';
  return 'normal';
}

function primaryDriverOf(claimRatio: number | null, expenseRatio: number | null): 'claim' | 'expense' | 'balanced' | 'unknown' {
  if (claimRatio === null && expenseRatio === null) return 'unknown';
  if (claimRatio === null) return 'expense';
  if (expenseRatio === null) return 'claim';
  if (Math.abs(claimRatio - expenseRatio) < 5) return 'balanced';
  return claimRatio > expenseRatio ? 'claim' : 'expense';
}

function share(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total <= 0) return null;
  return Number((part / total).toFixed(4));
}

function drilldownsFor(dimension: CostIndicatorDimension): string[] {
  switch (dimension) {
    case 'org_level_3':
      return ['customer_category', 'coverage_combination'];
    case 'customer_category':
      return ['org_level_3', 'coverage_combination'];
    case 'coverage_combination':
      return ['org_level_3', 'customer_category'];
    case 'org_customer':
      return ['coverage_combination', 'org_coverage'];
    case 'org_coverage':
      return ['customer_category', 'org_customer'];
  }
}

function topDriverOf(drivers: Array<'claim' | 'expense' | 'balanced' | 'unknown'>): 'claim' | 'expense' | 'balanced' | 'unknown' {
  const counts = drivers.reduce<Record<string, number>>((acc, driver) => {
    acc[driver] = (acc[driver] ?? 0) + 1;
    return acc;
  }, {});
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (sorted[0]?.[0] as 'claim' | 'expense' | 'balanced' | 'unknown' | undefined) ?? 'unknown';
}

export function diagnoseCostIndicatorRows(input: DiagnoseCostIndicatorRowsInput): CostIndicatorDiagnosisResult {
  const claimByDim = indexByDimKey(input.claimRatioRows);
  const expenseByDim = indexByDimKey(input.expenseRatioRows);
  const candidates = input.variableCostRows
    .map((row) => {
      const dimKey = dimKeyOf(row);
      const claimRow = claimByDim.get(dimKey) ?? {};
      const expenseRow = expenseByDim.get(dimKey) ?? {};
      const totalPremium = toNullableNumber(row.total_premium);
      const variableCostRatio = toNullableNumber(row.variable_cost_ratio);
      const earnedClaimRatio = toNullableNumber(row.earned_claim_ratio);
      const expenseRatio = toNullableNumber(row.expense_ratio ?? expenseRow.expense_ratio);
      const primaryDriver = primaryDriverOf(earnedClaimRatio, expenseRatio);

      return {
        dimKey,
        primaryDriver,
        variableCostRatio,
        totalPremium,
        row,
        claimRow,
        expenseRow,
      };
    })
    .filter((item) => item.variableCostRatio !== null)
    .filter((item) => (item.totalPremium ?? 0) >= input.minPremium)
    .sort((a, b) => (b.variableCostRatio ?? -Infinity) - (a.variableCostRatio ?? -Infinity))
    .slice(0, input.limit);

  const anomalies = candidates.map((item, index) => {
    const claimCases = toNullableNumber(item.claimRow.total_claim_cases ?? item.row.total_claim_cases);
    const totalFee = toNullableNumber(item.row.total_fee ?? item.expenseRow.total_fee);
    const earnedClaimRatio = toNullableNumber(item.row.earned_claim_ratio);
    const expenseRatio = toNullableNumber(item.row.expense_ratio ?? item.expenseRow.expense_ratio);

    return {
      rank: index + 1,
      dimKey: item.dimKey,
      severity: severityOf(item.variableCostRatio),
      primaryDriver: item.primaryDriver,
      metrics: {
        policyCount: toNullableNumber(item.row.policy_count),
        totalPremium: item.totalPremium,
        earnedPremium: toNullableNumber(item.row.earned_premium),
        reportedClaims: toNullableNumber(item.row.total_reported_claims),
        claimCases,
        totalFee,
        variableCostRatio: item.variableCostRatio,
        earnedClaimRatio,
        expenseRatio,
        avgClaimAmount: toNullableNumber(item.claimRow.avg_claim_amount ?? item.row.avg_claim_amount),
        earnedLossFrequency: toNullableNumber(item.claimRow.earned_loss_frequency ?? item.row.earned_loss_frequency),
      },
      contribution: {
        claimRatio: earnedClaimRatio,
        expenseRatio,
        claimShareOfVariableCost: share(earnedClaimRatio, item.variableCostRatio),
        expenseShareOfVariableCost: share(expenseRatio, item.variableCostRatio),
      },
      drilldownSuggestions: drilldownsFor(input.dimension),
    };
  });

  return CostIndicatorDiagnosisResultSchema.parse({
    capabilityId: 'cost_indicator_diagnosis',
    status: 'supported',
    cutoffDate: input.cutoffDate,
    dimension: input.dimension,
    requestedTools: REQUESTED_TOOLS,
    summary: {
      rowCount: input.variableCostRows.length,
      diagnosedCount: anomalies.length,
      highRiskCount: anomalies.filter((item) => item.severity === 'critical').length,
      warningCount: anomalies.filter((item) => item.severity === 'warning' || item.severity === 'observe').length,
      topDriver: topDriverOf(anomalies.map((item) => item.primaryDriver)),
    },
    anomalies,
    warnings: COST_WARNINGS,
    forbiddenInterpretations: FORBIDDEN_INTERPRETATIONS,
  });
}

export async function runCostIndicatorDiagnosis(input: RunCostIndicatorDiagnosisInput): Promise<CostIndicatorDiagnosisResult> {
  const { getAgentDuckdb } = await import('./agent-query-cache.js');
  const duckdbService = await getAgentDuckdb();
  const config = {
    dimension: input.dimension as CostDimension,
    cutoffDate: input.cutoffDate,
    whereClause: input.whereClause,
  };

  const [variableCostRows, claimRatioRows, expenseRatioRows] = await Promise.all([
    duckdbService.query<RawCostRow>(generateVariableCostQuery(config)),
    duckdbService.query<RawCostRow>(generateClaimRatioQuery(config)),
    duckdbService.query<RawCostRow>(generateExpenseRatioQuery(config)),
  ]);

  return diagnoseCostIndicatorRows({
    cutoffDate: input.cutoffDate,
    dimension: input.dimension,
    limit: input.limit,
    minPremium: input.minPremium,
    variableCostRows,
    claimRatioRows,
    expenseRatioRows,
  });
}
