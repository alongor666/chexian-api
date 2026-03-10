import { describe, expect, it } from 'vitest';
import { buildInsightSummary } from '../src/features/dashboard/CrossSellAnalysisPanel';
import { buildCrossSellTrendMarkPointData } from '../src/features/dashboard/CrossSellTrendChart';

describe('cross-sell AI insight and chart annotations', () => {
  const trendRows = [
    { time_period: '2026-03-01', coverage_combination: '整体', rate: 24.1, avg_premium: 1100 },
    { time_period: '2026-03-02', coverage_combination: '整体', rate: 31.8, avg_premium: 980 },
    { time_period: '2026-03-03', coverage_combination: '整体', rate: 18.6, avg_premium: 1260 },
    { time_period: '2026-03-04', coverage_combination: '整体', rate: 26.4, avg_premium: 1010 },
  ];

  it('builds rate and premium annotations from the same AI summary data', () => {
    const summary = buildInsightSummary(trendRows, 'daily');

    expect(summary).not.toBeNull();
    expect(summary?.rateAnnotations).toEqual([
      expect.objectContaining({ kind: 'max', timePeriod: '2026-03-02', value: 31.8, label: '最高推介率' }),
      expect.objectContaining({ kind: 'min', timePeriod: '2026-03-03', value: 18.6, label: '最低推介率' }),
    ]);
    expect(summary?.premiumAnnotations).toEqual([
      expect.objectContaining({ kind: 'max', timePeriod: '2026-03-03', value: 1260, label: '最高件均' }),
      expect.objectContaining({ kind: 'min', timePeriod: '2026-03-02', value: 980, label: '最低件均' }),
    ]);
  });

  it('prefers explicit AI annotations when building chart mark points', () => {
    const markPoints = buildCrossSellTrendMarkPointData(
      [
        { kind: 'max', timePeriod: '2026-03-02', value: 31.8, label: '最高推介率' },
        { kind: 'min', timePeriod: '2026-03-03', value: 18.6, label: '最低推介率' },
      ],
      {
        max: { index: 0, value: 99 },
        min: { index: 1, value: 1 },
      },
      ['2026-03-01', '2026-03-02', '2026-03-03']
    );

    expect(markPoints).toEqual([
      expect.objectContaining({ name: '最高推介率', coord: ['2026-03-02', 31.8], value: 31.8 }),
      expect.objectContaining({ name: '最低推介率', coord: ['2026-03-03', 18.6], value: 18.6 }),
    ]);
  });
});
