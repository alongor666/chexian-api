import type {
  ComprehensiveBundleResponse as ApiComprehensiveBundleResponse,
  ComprehensiveFilterParams as ApiComprehensiveFilterParams,
  ComprehensiveTabKey as ApiComprehensiveTabKey,
} from '@/shared/api/client';

export type ComprehensiveTabKey = ApiComprehensiveTabKey;
export type ComprehensiveFilterParams = ApiComprehensiveFilterParams;
export type ComprehensiveBundleResponse = ApiComprehensiveBundleResponse;

export type ComprehensiveDimensionKey = 'org' | 'category' | 'business';

export interface ComprehensiveThresholds {
  premiumProgressWarn: number;
  costRateWarn: number;
  lossRateWarn: number;
  expenseRateWarn: number;
  expenseBudget: number;
}

export interface ComprehensiveMetricRow {
  dimType: ComprehensiveDimensionKey;
  dimKey: string;
  rank: number;
  policyCount: number;
  signedPremium: number;
  reportedClaims: number;
  feeAmount: number;
  claimCases: number;
  earnedPremium: number;
  earnedClaimRatio: number | null;
  expenseRatio: number | null;
  variableCostRatio: number | null;
  avgClaimAmount: number | null;
  claimFrequency: number | null;
  premiumShare: number;
  claimShare: number;
  expenseShare: number;
  planPremium: number | null;
  achievementRate: number | null;
}

export interface ComprehensiveLossTrendRow {
  timePeriod: string;
  reportedClaims: number;
  earnedPremium: number;
  earnedClaimRatio: number | null;
  claimShare: number;
}

export interface ComprehensiveExpenseSurplusRow {
  dimType: ComprehensiveDimensionKey;
  dimKey: string;
  expenseRateDeviation: number | null;
  expenseSurplusAmount: number | null;
}

export interface ComprehensiveRoiRow {
  dimType: ComprehensiveDimensionKey;
  dimKey: string;
  signedPremium: number;
  expenseAmount: number;
  marginContribution: number | null;
  expenseOutputPremiumRatio: number | null;
  expenseOutputMarginRatio: number | null;
  marginRate: number | null;
}

export interface ComprehensiveOverviewSummary {
  signedPremium: number;
  reportedClaims: number;
  expenseAmount: number;
  earnedClaimRatio: number | null;
  expenseRatio: number | null;
  variableCostRatio: number | null;
  achievementRate: number | null;
  comprehensiveExpenseRatio: number | null;
  perVehiclePremium: number | null;
  claimFrequency: number | null;
}

export interface ComprehensiveViewModel {
  meta: {
    cutoffDate: string;
    maxDataDate: string | null;
    planYear: number;
    orgScope: string[];
    permissionFilter: string;
    thresholds: ComprehensiveThresholds;
    timeProgress: number | null;
  };
  overview: {
    summary: ComprehensiveOverviewSummary;
    rows: ComprehensiveMetricRow[];
    alerts: string[];
  };
  premium: {
    rows: ComprehensiveMetricRow[];
  };
  cost: {
    rows: ComprehensiveMetricRow[];
  };
  loss: {
    quadrantRows: ComprehensiveMetricRow[];
    trendRows: ComprehensiveLossTrendRow[];
  };
  expense: {
    rows: ComprehensiveMetricRow[];
    surplusRows: ComprehensiveExpenseSurplusRow[];
  };
  roi: {
    rows: ComprehensiveRoiRow[];
  };
}

