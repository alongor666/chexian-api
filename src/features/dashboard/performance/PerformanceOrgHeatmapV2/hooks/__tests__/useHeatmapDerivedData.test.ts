import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PerformanceOrgHeatmapRow } from '../../../../hooks/usePerformanceOrgHeatmap';
import { BRANCH_SUMMARY_ROW_LABEL } from '../../config';
import { useHeatmapDerivedData } from '../useHeatmapDerivedData';

function row(
  orgLevel3: string,
  planPremium: number,
  achievementRate: number,
): PerformanceOrgHeatmapRow {
  return {
    orgLevel3,
    policyDate: '2026-01-15',
    premium: 1,
    planPremium,
    prevMomPremium: 0,
    prevYoyPremium: 0,
    achievementRate,
    momGrowthRate: null,
    yoyGrowthRate: null,
    policyCount: 1,
    avgPricingCoefficient: 1,
    premiumShare: 50,
    perPolicyPremium: 1,
  };
}

describe('useHeatmapDerivedData 分公司汇总', () => {
  it('计划达成率按各机构时间进度计划加权，不用当期保费除累计目标', () => {
    const { result } = renderHook(() => useHeatmapDerivedData({
      rows: [row('机构甲', 15, 80), row('机构乙', 30, 120)],
      metric: 'achievement',
      growthMode: 'mom',
      timePeriod: 'day',
    }));

    const summary = result.current.matrix
      .get(BRANCH_SUMMARY_ROW_LABEL)
      ?.get('2026-01-15');

    expect(summary).toBeDefined();
    expect(summary!.planPremium).toBe(45);
    expect(summary!.achievementRate).toBeCloseTo((80 * 15 + 120 * 30) / 45, 6);
  });
});
