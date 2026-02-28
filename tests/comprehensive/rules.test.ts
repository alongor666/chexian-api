import { describe, expect, it } from 'vitest';
import { buildOverviewAlerts, mergeThresholds } from '../../src/features/comprehensive-analysis/rules';
import type { ComprehensiveMetricRow } from '../../src/features/comprehensive-analysis/types';

function createRow(partial: Partial<ComprehensiveMetricRow>): ComprehensiveMetricRow {
  return {
    dimType: 'org',
    dimKey: '天府',
    rank: 1,
    policyCount: 100,
    signedPremium: 1000000,
    reportedClaims: 300000,
    feeAmount: 90000,
    claimCases: 30,
    earnedPremium: 500000,
    earnedClaimRatio: 60,
    expenseRatio: 9,
    variableCostRatio: 69,
    avgClaimAmount: 10000,
    claimFrequency: 30,
    premiumShare: 35,
    claimShare: 33,
    expenseShare: 30,
    planPremium: 1200000,
    achievementRate: 90,
    ...partial,
  };
}

describe('comprehensive rules', () => {
  it('merges threshold with defaults', () => {
    const thresholds = mergeThresholds({ lossRateWarn: 72 });
    expect(thresholds.lossRateWarn).toBe(72);
    expect(thresholds.expenseBudget).toBe(14);
  });

  it('builds alert messages by threshold', () => {
    const thresholds = mergeThresholds(null);
    const alerts = buildOverviewAlerts(
      [
        createRow({ dimKey: '天府', achievementRate: 88 }),
        createRow({ dimKey: '高新', variableCostRatio: 95 }),
        createRow({ dimKey: '宜宾', earnedClaimRatio: 75 }),
        createRow({ dimKey: '青羊', expenseRatio: 18 }),
      ],
      thresholds
    );

    expect(alerts.join('|')).toContain('保费进度落后');
    expect(alerts.join('|')).toContain('变动成本率超标');
    expect(alerts.join('|')).toContain('满期赔付率偏高');
    expect(alerts.join('|')).toContain('费用率超标');
  });
});

