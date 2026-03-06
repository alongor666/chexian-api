import { describe, expect, it } from 'vitest';
import {
  getPerformanceDrilldownTitle,
  getPerformanceHeatmapTitle,
  PERFORMANCE_HEATMAP_PERIOD_COUNT,
  resolvePerformanceDrilldownPrefetched,
  type PerformanceDrilldownPrefetchedData,
} from '../src/features/dashboard/PerformanceAnalysisPanel';

describe('performance drilldown prefetch gating', () => {
  const prefetched: PerformanceDrilldownPrefetchedData = {
    summary: { premium: 12.3 },
    rows: [{ group_name: '资阳', premium: 12.3 }],
  };

  it('keeps bundle prefetched drilldown only for the non-interactive first paint', () => {
    expect(resolvePerformanceDrilldownPrefetched(prefetched, false)).toEqual(prefetched);
  });

  it('disables bundle prefetched drilldown after the user starts drilling', () => {
    expect(resolvePerformanceDrilldownPrefetched(prefetched, true)).toBeUndefined();
  });

  it('uses 15 periods in the heatmap title', () => {
    expect(PERFORMANCE_HEATMAP_PERIOD_COUNT).toBe(15);
    expect(getPerformanceHeatmapTitle('day')).toBe('三级机构连续15天热力图');
    expect(getPerformanceHeatmapTitle('week')).toBe('三级机构连续15周热力图');
  });

  it('shows the selected drilldown dimension in the section title', () => {
    expect(getPerformanceDrilldownTitle('salesman', '业务员', { org: '资阳', date: '2026-03-06' }))
      .toBe('下钻分析（已选维度：业务员 · 热力图机构：资阳）');
    expect(getPerformanceDrilldownTitle(null, '维度', null)).toBe('下钻分析');
  });
});
