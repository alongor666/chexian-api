import { describe, expect, it } from 'vitest';
import {
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
});
