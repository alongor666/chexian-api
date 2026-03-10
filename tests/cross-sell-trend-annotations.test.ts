import { describe, expect, it } from 'vitest';
import { buildInsightSummary } from '../src/features/dashboard/CrossSellAnalysisPanel';
import { buildCrossSellTrendMarkPointData } from '../src/features/dashboard/CrossSellTrendChart';

describe('cross-sell trend annotations', () => {
  it('builds AI summary annotations from the same overall trend extrema', () => {
    const summary = buildInsightSummary(
      [
        { time_period: '2026-03-01', coverage_combination: '整体', rate: 21.3, avg_premium: 620 },
        { time_period: '2026-03-02', coverage_combination: '整体', rate: 35.8, avg_premium: 880 },
        { time_period: '2026-03-03', coverage_combination: '整体', rate: 18.4, avg_premium: 560 },
        { time_period: '2026-03-02', coverage_combination: '主全', rate: 41.2, avg_premium: 960 },
      ],
      'daily'
    );

    expect(summary).not.toBeNull();
    expect(summary?.rateAnnotations).toEqual([
      expect.objectContaining({ name: '最高推介率', timePeriod: '2026-03-02', value: 35.8 }),
      expect.objectContaining({ name: '最低推介率', timePeriod: '2026-03-03', value: 18.4 }),
    ]);
    expect(summary?.premiumAnnotations).toEqual([
      expect.objectContaining({ name: '最高件均', timePeriod: '2026-03-02', value: 880 }),
      expect.objectContaining({ name: '最低件均', timePeriod: '2026-03-03', value: 560 }),
    ]);
    expect(summary?.bullets[1]).toContain('驾意件均最高出现在 2026-03-02');
  });

  it('prefers explicit AI annotations over fallback max/min mark points', () => {
    const markPoints = buildCrossSellTrendMarkPointData(
      ['2026-03-01', '2026-03-02', '2026-03-03'],
      [
        { name: '最高推介率', timePeriod: '2026-03-02', value: 35.8, color: '#123456' },
        { name: '最低推介率', timePeriod: '2026-03-03', value: 18.4, color: '#654321' },
      ],
      {
        max: { index: 0, value: 99 },
        min: { index: 1, value: 1 },
      }
    );

    expect(markPoints).toEqual([
      expect.objectContaining({ name: '最高推介率', coord: ['2026-03-02', 35.8], value: 35.8 }),
      expect.objectContaining({ name: '最低推介率', coord: ['2026-03-03', 18.4], value: 18.4 }),
    ]);
  });
});
