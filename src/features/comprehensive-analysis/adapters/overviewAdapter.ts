import type { ComprehensiveBundleResponse, ComprehensiveOverviewSummary } from '../types';
import { normalizeMetricRows, toSummaryNullableNumber, toSummaryNumber } from './common';

export function adaptOverviewSummary(
  response: ComprehensiveBundleResponse
): ComprehensiveOverviewSummary {
  const summary = response.overview.summary || {};
  return {
    signedPremium: toSummaryNumber(summary.signedPremium),
    reportedClaims: toSummaryNumber(summary.reportedClaims),
    expenseAmount: toSummaryNumber(summary.expenseAmount),
    earnedClaimRatio: toSummaryNullableNumber(summary.earnedClaimRatio),
    expenseRatio: toSummaryNullableNumber(summary.expenseRatio),
    variableCostRatio: toSummaryNullableNumber(summary.variableCostRatio),
    achievementRate: toSummaryNullableNumber(summary.achievementRate),
    comprehensiveExpenseRatio: toSummaryNullableNumber(summary.comprehensiveExpenseRatio),
    perVehiclePremium: toSummaryNullableNumber(summary.perVehiclePremium),
    claimFrequency: toSummaryNullableNumber(summary.claimFrequency),
  };
}

export function adaptOverviewRows(response: ComprehensiveBundleResponse) {
  return normalizeMetricRows(response.overview.rows);
}

