import { describe, it, expect } from 'vitest';
// 哨兵统计纯函数（.mjs，被 Node 脚本与本测试共用）
import {
  mean,
  stdDev,
  zScore,
  pctChange,
  splitByMaturity,
  evaluateMetricSeries,
  lastYearCutoff,
  // @ts-expect-error mjs without types
} from '../../scripts/sentinel/lib/stats.mjs';

describe('sentinel/stats 基础统计', () => {
  it('mean 忽略非有限值', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([1, NaN, 3])).toBe(2);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it('stdDev 样本标准差，n<2 返回 NaN', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(Number.isNaN(stdDev([5]))).toBe(true);
  });

  it('zScore：标准差为 0 返回 NaN', () => {
    expect(zScore(10, [2, 4, 6, 8])).toBeGreaterThan(0);
    expect(Number.isNaN(zScore(5, [3, 3, 3]))).toBe(true);
  });

  it('pctChange：上期为 0 返回 NaN', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10, 6);
    expect(pctChange(90, 100)).toBeCloseTo(-10, 6);
    expect(Number.isNaN(pctChange(1, 0))).toBe(true);
  });
});

describe('sentinel/stats 成熟度过滤（IBNR 防线）', () => {
  const series = [
    { time_period: '2026-01', value: 50 },
    { time_period: '2026-02', value: 52 },
    { time_period: '2026-03', value: 51 },
    { time_period: '2026-04', value: 20 }, // 未成熟近期（赔款未报全）
  ];

  it('排除最近 1 期', () => {
    const { mature, excluded } = splitByMaturity(series, 1);
    expect(mature.map((m) => m.time_period)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(excluded.map((m) => m.time_period)).toEqual(['2026-04']);
  });

  it('excludeRecent=0 不排除', () => {
    const { mature, excluded } = splitByMaturity(series, 0);
    expect(mature).toHaveLength(4);
    expect(excluded).toHaveLength(0);
  });

  it('序列过短则全部视为成熟', () => {
    const { mature, excluded } = splitByMaturity(series.slice(0, 1), 1);
    expect(mature).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });
});

describe('sentinel/stats 指标异常判定', () => {
  it('赔付率向上突变触发（direction=up），且未成熟近期被排除而非误判', () => {
    const series = [
      { time_period: '2026-01', value: 50 },
      { time_period: '2026-02', value: 51 },
      { time_period: '2026-03', value: 49 },
      { time_period: '2026-04', value: 52 },
      { time_period: '2026-05', value: 80 }, // 已成熟期的真实飙升
      { time_period: '2026-06', value: 15 }, // 未成熟近期（应被排除，不能因它偏低而漏判 05 的飙升）
    ];
    const v = evaluateMetricSeries('earned_claim_ratio', series, {
      zThreshold: 2,
      momThreshold: 8,
      direction: 'up',
      excludeRecent: 1,
    });
    expect(v.excludedPeriods).toEqual(['2026-06']);
    expect(v.latestMaturePeriod).toBe('2026-05');
    expect(v.triggered).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it('direction=up 时向下波动不触发', () => {
    const series = [
      { time_period: '2026-01', value: 50 },
      { time_period: '2026-02', value: 51 },
      { time_period: '2026-03', value: 49 },
      { time_period: '2026-04', value: 50 },
      { time_period: '2026-05', value: 20 }, // 大幅下降
      { time_period: '2026-06', value: 49 },
    ];
    const v = evaluateMetricSeries('earned_claim_ratio', series, {
      zThreshold: 2,
      momThreshold: 8,
      direction: 'up',
      excludeRecent: 1,
    });
    expect(v.triggered).toBe(false);
  });

  it('样本不足标记 insufficientData', () => {
    const v = evaluateMetricSeries('x', [{ time_period: '1', value: 1 }, { time_period: '2', value: 2 }], {
      excludeRecent: 1,
    });
    expect(v.insufficientData).toBe(true);
    expect(v.triggered).toBe(false);
  });

  it('断崖检测 direction=both 双向触发', () => {
    const series = [
      { time_period: '2026-01', value: 1000 },
      { time_period: '2026-02', value: 1020 },
      { time_period: '2026-03', value: 980 },
      { time_period: '2026-04', value: 1010 },
      { time_period: '2026-05', value: 300 }, // 暴跌
      { time_period: '2026-06', value: 1000 },
    ];
    const v = evaluateMetricSeries('total_premium', series, {
      zThreshold: 2,
      momThreshold: 30,
      direction: 'both',
      excludeRecent: 1,
    });
    expect(v.triggered).toBe(true);
  });
});

describe('sentinel/stats lastYearCutoff', () => {
  it('年份 -1，保留月日', () => {
    expect(lastYearCutoff('2026-05-16')).toBe('2025-05-16');
  });
  it('非法输入返回 null', () => {
    expect(lastYearCutoff('not-a-date')).toBeNull();
    expect(lastYearCutoff('')).toBeNull();
  });
});
