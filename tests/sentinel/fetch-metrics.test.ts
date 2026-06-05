import { describe, it, expect } from 'vitest';
// @ts-expect-error mjs without types
import { lossTrendToSeries } from '../../scripts/sentinel/lib/fetch-metrics.mjs';

describe('sentinel/fetch-metrics lossTrendToSeries', () => {
  it('显式拒绝 earned_claim_ratio=null（未来月）：Number(null)===0 不能让 null 当成 0 进序列', () => {
    const rows = [
      { time_period: '2026-05', earned_claim_ratio: 55.88 },
      { time_period: '2026-06', earned_claim_ratio: 113.74 },
      { time_period: '2026-07', earned_claim_ratio: null },
      { time_period: '2026-08', earned_claim_ratio: null },
    ];
    const series = lossTrendToSeries(rows);
    expect(series.map((s: { time_period: string }) => s.time_period)).toEqual(['2026-05', '2026-06']);
    expect(series.every((s: { value: number }) => s.value > 0)).toBe(true);
  });

  it('保留有限数值；拒绝 undefined / NaN / 缺字段', () => {
    const rows = [
      { time_period: '2025-05', earned_claim_ratio: 67.21 },
      { time_period: '2025-06', earned_claim_ratio: undefined },
      { time_period: '2025-07', earned_claim_ratio: NaN },
      { time_period: '2025-08' }, // 缺字段
      { time_period: null, earned_claim_ratio: 99 }, // 无 time_period
    ];
    const series = lossTrendToSeries(rows);
    expect(series).toEqual([{ time_period: '2025-05', value: 67.21 }]);
  });

  it('保留 0 值（业务上的真实 0 与未来月的 null 必须区分开）', () => {
    const rows = [
      { time_period: '2020-04', earned_claim_ratio: 0 },
      { time_period: '2026-07', earned_claim_ratio: null },
    ];
    const series = lossTrendToSeries(rows);
    expect(series).toEqual([{ time_period: '2020-04', value: 0 }]);
  });
});
