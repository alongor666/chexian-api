import type { ComprehensiveMetricRow, ComprehensiveThresholds } from './types';

export const DEFAULT_COMPREHENSIVE_THRESHOLDS: ComprehensiveThresholds = {
  premiumProgressWarn: 99,
  costRateWarn: 91,
  lossRateWarn: 70,
  expenseRateWarn: 16,
  expenseBudget: 14,
};

export function mergeThresholds(
  thresholds?: Partial<ComprehensiveThresholds> | null
): ComprehensiveThresholds {
  return {
    ...DEFAULT_COMPREHENSIVE_THRESHOLDS,
    ...(thresholds || {}),
  };
}

export function buildOverviewAlerts(
  rows: ComprehensiveMetricRow[],
  thresholds: ComprehensiveThresholds
): string[] {
  const orgRows = rows.filter((row) => row.dimType === 'org');

  const premiumLag = orgRows
    .filter((row) => row.achievementRate !== null && row.achievementRate < thresholds.premiumProgressWarn)
    .slice(0, 5)
    .map((row) => row.dimKey);
  const highCost = orgRows
    .filter((row) => row.variableCostRatio !== null && row.variableCostRatio > thresholds.costRateWarn)
    .slice(0, 5)
    .map((row) => row.dimKey);
  const highLoss = orgRows
    .filter((row) => row.earnedClaimRatio !== null && row.earnedClaimRatio > thresholds.lossRateWarn)
    .slice(0, 5)
    .map((row) => row.dimKey);
  const highExpense = orgRows
    .filter((row) => row.expenseRatio !== null && row.expenseRatio > thresholds.expenseRateWarn)
    .slice(0, 5)
    .map((row) => row.dimKey);

  const alerts: string[] = [];
  if (premiumLag.length > 0) alerts.push(`${premiumLag.join('、')}保费进度落后`);
  if (highCost.length > 0) alerts.push(`${highCost.join('、')}变动成本率超标`);
  if (highLoss.length > 0) alerts.push(`${highLoss.join('、')}满期赔付率偏高`);
  if (highExpense.length > 0) alerts.push(`${highExpense.join('、')}费用率超标`);
  return alerts;
}

