import type {
  ComprehensiveDimensionKey,
  ComprehensiveExpenseSurplusRow,
  ComprehensiveLossTrendRow,
  ComprehensiveMetricRow,
  ComprehensiveRoiRow,
} from '../types';

function toNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function toDimension(value: unknown): ComprehensiveDimensionKey {
  if (value === 'category' || value === 'business' || value === 'org') {
    return value;
  }
  return 'org';
}

export function normalizeMetricRow(raw: Record<string, unknown>): ComprehensiveMetricRow {
  return {
    dimType: toDimension(raw.dim_type),
    dimKey: String(raw.dim_key ?? '未知'),
    rank: Math.max(1, Math.round(toNumber(raw.rank, 1))),
    policyCount: Math.max(0, Math.round(toNumber(raw.policy_count))),
    signedPremium: toNumber(raw.signed_premium),
    reportedClaims: toNumber(raw.reported_claims),
    feeAmount: toNumber(raw.fee_amount),
    claimCases: Math.max(0, Math.round(toNumber(raw.claim_cases))),
    earnedPremium: toNumber(raw.earned_premium),
    earnedClaimRatio: toNullableNumber(raw.earned_claim_ratio),
    expenseRatio: toNullableNumber(raw.expense_ratio),
    variableCostRatio: toNullableNumber(raw.variable_cost_ratio),
    avgClaimAmount: toNullableNumber(raw.avg_claim_amount),
    claimFrequency: toNullableNumber(raw.claim_frequency),
    premiumShare: toNumber(raw.premium_share),
    claimShare: toNumber(raw.claim_share),
    expenseShare: toNumber(raw.expense_share),
    planPremium: toNullableNumber(raw.plan_premium),
    achievementRate: toNullableNumber(raw.achievement_rate),
  };
}

export function normalizeMetricRows(rows: Array<Record<string, unknown>> = []): ComprehensiveMetricRow[] {
  return rows.map(normalizeMetricRow);
}

export function normalizeLossTrendRows(
  rows: Array<Record<string, unknown>> = []
): ComprehensiveLossTrendRow[] {
  return rows.map((raw) => ({
    timePeriod: String(raw.time_period ?? ''),
    reportedClaims: toNumber(raw.reported_claims),
    earnedPremium: toNumber(raw.earned_premium),
    earnedClaimRatio: toNullableNumber(raw.earned_claim_ratio),
    claimShare: toNumber(raw.claim_share),
  }));
}

export function normalizeExpenseSurplusRows(
  rows: Array<Record<string, unknown>> = []
): ComprehensiveExpenseSurplusRow[] {
  return rows.map((raw) => ({
    dimType: toDimension(raw.dim_type),
    dimKey: String(raw.dim_key ?? '未知'),
    expenseRateDeviation: toNullableNumber(raw.expenseRateDeviation ?? raw.expense_rate_deviation),
    expenseSurplusAmount: toNullableNumber(raw.expenseSurplusAmount ?? raw.expense_surplus_amount),
  }));
}

export function normalizeRoiRows(rows: Array<Record<string, unknown>> = []): ComprehensiveRoiRow[] {
  return rows.map((raw) => ({
    dimType: toDimension(raw.dim_type),
    dimKey: String(raw.dim_key ?? '未知'),
    signedPremium: toNumber(raw.signed_premium),
    expenseAmount: toNumber(raw.expense_amount),
    marginContribution: toNullableNumber(raw.marginContribution ?? raw.margin_contribution),
    expenseOutputPremiumRatio: toNullableNumber(
      raw.expenseOutputPremiumRatio ?? raw.expense_output_premium_ratio
    ),
    expenseOutputMarginRatio: toNullableNumber(
      raw.expenseOutputMarginRatio ?? raw.expense_output_margin_ratio
    ),
    marginRate: toNullableNumber(raw.marginRate ?? raw.margin_rate),
  }));
}

export function toSummaryNumber(value: unknown): number {
  return toNumber(value);
}

export function toSummaryNullableNumber(value: unknown): number | null {
  return toNullableNumber(value);
}

