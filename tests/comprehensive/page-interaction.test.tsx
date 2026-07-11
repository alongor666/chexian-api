import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComprehensiveAnalysisPage } from '../../src/features/pages/ComprehensiveAnalysisPage';

vi.mock('@/shared/theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('@/features/filters/PageFilterPanel', () => ({
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
  it('renders slimmed tabs（02aa70-b：只留独有价值 成本象限/赔案分析/ROI，重叠明细 tab 已裁）and switches view', () => {
    render(<ComprehensiveAnalysisPage />);

    // 保留的三个独有价值 tab
    expect(screen.getByRole('tab', { name: '成本象限' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '赔案分析' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'ROI效率' })).toBeTruthy();
    // 与 /cost basic 明细重叠的 tab 已删（负向锁，防回归）
    expect(screen.queryByRole('tab', { name: '总览' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '保费进度' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '费用分析' })).toBeNull();

    // 默认落在成本象限
    expect(screen.getByText('成本指标象限')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '赔案分析' }));
    expect(screen.getByText('象限视图')).toBeTruthy();
    expect(screen.getByText('趋势视图')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'ROI效率' }));
    expect(screen.getByText('ROI 效率分析')).toBeTruthy();
  });
});
