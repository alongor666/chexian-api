import { describe, expect, it } from 'vitest';
import {
  applyPerformanceHeatmapSelectionToParams,
  resolvePerformanceDrillSource,
  resolvePerformanceHeatmapPeriodRange,
} from '../src/features/dashboard/utils/performanceHeatmapSelection';

describe('performanceHeatmapSelection', () => {
  it('maps a daily cell to a single signed-date range', () => {
    expect(resolvePerformanceHeatmapPeriodRange('2026-03-06', 'day')).toEqual({
      startDate: '2026-03-06',
      endDate: '2026-03-06',
    });
  });

  it('maps a weekly cell to the full natural week window', () => {
    expect(resolvePerformanceHeatmapPeriodRange('2026-03-02', 'week')).toEqual({
      startDate: '2026-03-02',
      endDate: '2026-03-08',
    });
  });

  it('maps a monthly cell to the full natural month window', () => {
    expect(resolvePerformanceHeatmapPeriodRange('2026-03-01', 'month')).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
  });

  it('overrides drilldown params with policy_date and the selected heatmap bucket', () => {
    expect(
      applyPerformanceHeatmapSelectionToParams(
        {
          dateField: 'insurance_start_date',
          startDate: '2026-01-01',
          endDate: '2026-03-31',
          orgNames: '天府',
        },
        { org: '乐山', date: '2026-03-01' },
        'month'
      )
    ).toEqual({
      dateField: 'policy_date',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      orgNames: '天府',
    });
  });

  it('lets row-drill continuation win over the heatmap root selection', () => {
    expect(resolvePerformanceDrillSource('业务员A', { org: '乐山', date: '2026-03-06' })).toBe('row');
    expect(resolvePerformanceDrillSource(null, { org: '乐山', date: '2026-03-06' })).toBe('heatmap');
    expect(resolvePerformanceDrillSource(null, null)).toBe('root');
  });
});
