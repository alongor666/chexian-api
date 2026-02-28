import { describe, expect, it } from 'vitest';
import type { ComprehensiveBundleResponse } from '../../src/shared/api/client';
import {
  adaptCostRows,
  adaptExpenseRows,
  adaptExpenseSurplusRows,
  adaptLossQuadrantRows,
  adaptLossTrendRows,
  adaptOverviewRows,
  adaptOverviewSummary,
  adaptPremiumRows,
  adaptRoiRows,
} from '../../src/features/comprehensive-analysis/adapters';

const mockResponse: ComprehensiveBundleResponse = {
  meta: {
    cutoffDate: '2026-02-27',
    maxDataDate: '2026-02-27',
    planYear: 2026,
    orgScope: ['天府'],
    permissionFilter: "org_level_3 = '天府'",
    thresholds: {
      premiumProgressWarn: 99,
      costRateWarn: 91,
      lossRateWarn: 70,
      expenseRateWarn: 16,
      expenseBudget: 14,
    },
    timeProgress: 0.16,
  },
  overview: {
    summary: {
      signedPremium: 1200000,
      reportedClaims: 360000,
      expenseAmount: 96000,
      earnedClaimRatio: 62.3,
      expenseRatio: 8.0,
      variableCostRatio: 70.3,
      achievementRate: 96.2,
    },
    rows: [
      {
        dim_type: 'org',
        dim_key: '天府',
        rank: 1,
        policy_count: 100,
        signed_premium: 1200000,
        reported_claims: 360000,
        fee_amount: 96000,
        claim_cases: 30,
        earned_premium: 580000,
        earned_claim_ratio: 62.3,
        expense_ratio: 8.0,
        variable_cost_ratio: 70.3,
        avg_claim_amount: 12000,
        claim_frequency: 30,
        premium_share: 40,
        claim_share: 38,
        expense_share: 41,
        plan_premium: 1600000,
        achievement_rate: 96.2,
      },
    ],
    alerts: ['天府保费进度落后'],
  },
  premium: { rows: [] },
  cost: { rows: [] },
  loss: { quadrantRows: [], trendRows: [] },
  expense: { rows: [], surplusRows: [] },
  roi: { rows: [] },
};

describe('comprehensive adapters', () => {
  it('adapts overview summary and rows', () => {
    const summary = adaptOverviewSummary(mockResponse);
    const rows = adaptOverviewRows(mockResponse);

    expect(summary.signedPremium).toBe(1200000);
    expect(summary.variableCostRatio).toBe(70.3);
    expect(rows[0].dimKey).toBe('天府');
    expect(rows[0].dimType).toBe('org');
    expect(rows[0].achievementRate).toBe(96.2);
  });

  it('adapts all section rows with stable fallbacks', () => {
    expect(adaptPremiumRows(mockResponse)).toEqual([]);
    expect(adaptCostRows(mockResponse)).toEqual([]);
    expect(adaptLossQuadrantRows(mockResponse)).toEqual([]);
    expect(adaptLossTrendRows(mockResponse)).toEqual([]);
    expect(adaptExpenseRows(mockResponse)).toEqual([]);
    expect(adaptExpenseSurplusRows(mockResponse)).toEqual([]);
    expect(adaptRoiRows(mockResponse)).toEqual([]);
  });
});

