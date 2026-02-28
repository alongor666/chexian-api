import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComprehensiveAnalysisPage } from '../../src/features/pages/ComprehensiveAnalysisPage';

vi.mock('@/components/layout/PageFilterPanel', () => ({
  PageFilterPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/shared/contexts/FilterContext', () => ({
  useGlobalFilters: () => ({
    filters: {},
    maxDataDate: '2026-02-27',
  }),
}));

vi.mock('@/features/comprehensive-analysis/hooks/useComprehensiveBundle', () => ({
  useComprehensiveBundle: () => ({
    loading: false,
    error: null,
    data: {
      meta: {
        cutoffDate: '2026-02-27',
        maxDataDate: '2026-02-27',
        planYear: 2026,
        orgScope: ['天府'],
        permissionFilter: '1=1',
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
          signedPremium: 1000000,
          reportedClaims: 300000,
          expenseAmount: 80000,
          earnedClaimRatio: 60,
          expenseRatio: 8,
          variableCostRatio: 68,
          achievementRate: 95,
        },
        rows: [
          {
            dimType: 'org',
            dimKey: '天府',
            rank: 1,
            policyCount: 10,
            signedPremium: 1000000,
            reportedClaims: 300000,
            feeAmount: 80000,
            claimCases: 2,
            earnedPremium: 600000,
            earnedClaimRatio: 60,
            expenseRatio: 8,
            variableCostRatio: 68,
            avgClaimAmount: 150000,
            claimFrequency: 20,
            premiumShare: 40,
            claimShare: 35,
            expenseShare: 30,
            planPremium: 1200000,
            achievementRate: 95,
          },
        ],
        alerts: [],
      },
      premium: { rows: [] },
      cost: { rows: [] },
      loss: { quadrantRows: [], trendRows: [] },
      expense: { rows: [], surplusRows: [] },
      roi: { rows: [] },
    },
    reload: vi.fn(),
  }),
}));

vi.mock('@/features/comprehensive-analysis/charts/ComprehensiveChartCard', () => ({
  ComprehensiveChartCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('ComprehensiveAnalysisPage interactions', () => {
  it('renders tabs and switches view', () => {
    render(<ComprehensiveAnalysisPage />);

    expect(screen.getByText('总览')).toBeTruthy();
    expect(screen.getByText('保费进度')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '保费进度' }));
    expect(screen.getByText('保费进度分析')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '赔案分析' }));
    expect(screen.getByText('象限视图')).toBeTruthy();
    expect(screen.getByText('趋势视图')).toBeTruthy();
  });
});
