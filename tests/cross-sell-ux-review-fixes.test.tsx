import { describe, expect, it } from 'vitest';
import { countActiveFilters } from '../src/features/filters/PageFilterPanel';
import {
  CROSS_SELL_HEATMAP_PERIOD_COUNT,
  getAvailableHeatmapDrillDimensions,
  getCrossSellHeatmapTitle,
  resolveCrossSellHeatmapPeriod,
} from '../src/features/dashboard/CrossSellAnalysisPanel';
import {
  buildCrossSellTrendDigestText,
  formatCrossSellTrendDeclineLabel,
  getCrossSellTrendDigestHeading,
} from '../src/features/dashboard/CrossSellOrgTrendChart';

describe('cross-sell UX review fixes', () => {
  it('excludes already-used heatmap drill dimensions', () => {
    const dimensions = [
      { key: 'org_level_3', label: '三级机构' },
      { key: 'team', label: '团队' },
      { key: 'salesman', label: '业务员' },
      { key: 'coverage_combination', label: '险别组合' },
    ] as const;

    const available = getAvailableHeatmapDrillDimensions(
      'team',
      [{ dimension: 'org_level_3', value: '资阳' }],
      [...dimensions]
    );

    expect(available.map((item) => item.key)).toEqual(['salesman', 'coverage_combination']);
  });

  it('disables heatmap queries for yearly mode and labels the section explicitly', () => {
    expect(resolveCrossSellHeatmapPeriod('year')).toBeNull();
    expect(getCrossSellHeatmapTitle('三级机构', 'year')).toBe('三级机构年度热力图');
    expect(getCrossSellHeatmapTitle('三级机构', 'quarter')).toBe(`三级机构驾意险${CROSS_SELL_HEATMAP_PERIOD_COUNT}季度热力图`);
  });

  it('uses the reset baseline year when counting active advanced filters', () => {
    const count = countActiveFilters(
      {
        analysis_year: 2024,
        policy_date_start: '2024-01-01',
        policy_date_end: '2024-12-31',
      },
      '2024-12-31',
      [2024]
    );

    expect(count).toBe(0);
  });

  it('builds org-trend digest copy with dynamic period labels and neutral decline text', () => {
    const digestText = buildCrossSellTrendDigestText(
      '推介率',
      {
        avg30: 23.4,
        avg7: 25.1,
        consecutiveDownPeriods: 0,
        maxPoint: { date: '2026-03-01', value: 30.2 },
        minPoint: { date: '2026-02-01', value: 18.6 },
      },
      'monthly',
      12,
      (value) => `${value.toFixed(1)}%`
    );

    expect(getCrossSellTrendDigestHeading('monthly', 12)).toBe('程序解读（近12月口径）');
    expect(formatCrossSellTrendDeclineLabel('monthly', 0)).toBe('最近未出现连续回落');
    expect(digestText).toContain('近12月均值 23.4%');
    expect(digestText).toContain('近7月均值 25.1%');
    expect(digestText).toContain('最近未出现连续回落');
    expect(digestText).toContain('最高 30.2%（03-01）');
  });
});
