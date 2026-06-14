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
  findSamePeriodLastYear,
  trimBaseline,
  computeFingerprint,
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

describe('sentinel/stats findSamePeriodLastYear', () => {
  it('YYYY-MM 月度键：年份 -1 + 月份不变', () => {
    const series = [
      { time_period: '2025-03', value: 70.85 },
      { time_period: '2025-04', value: 72.6 },
      { time_period: '2026-03', value: 68.82 },
    ];
    expect(findSamePeriodLastYear(series, '2026-03')).toEqual({ time_period: '2025-03', value: 70.85 });
  });
  it('YYYY-MM-DD 日度键也支持', () => {
    const series = [{ time_period: '2025-06-04', value: 86.13 }];
    expect(findSamePeriodLastYear(series, '2026-06-04')).toEqual({ time_period: '2025-06-04', value: 86.13 });
  });
  it('series 缺该期返回 null', () => {
    expect(findSamePeriodLastYear([{ time_period: '2024-03', value: 1 }], '2026-03')).toBeNull();
  });
  it('非法输入返回 null', () => {
    expect(findSamePeriodLastYear(null, '2026-03')).toBeNull();
    expect(findSamePeriodLastYear([], '')).toBeNull();
    expect(findSamePeriodLastYear([{ time_period: '2025-03', value: 1 }], 'not-a-period')).toBeNull();
  });
});

describe('sentinel/stats evaluateMetricSeries YoY 同期对齐（codex P2）', () => {
  it('opts.yoy 缺省时，自动用 latestMature 期 -1 年从 series 内查', () => {
    // 关键场景：latestMature=2026-03（excludeRecent=3 排掉 04/05/06），
    // series 尾月仍是 2026-06。yoy 必须对齐 2025-03（不是 2025-06）。
    const series = [
      { time_period: '2025-01', value: 71.82 },
      { time_period: '2025-02', value: 65.17 },
      { time_period: '2025-03', value: 70.85 }, // 去年同期对齐目标
      { time_period: '2025-04', value: 72.6 },
      { time_period: '2025-05', value: 67.21 },
      { time_period: '2025-06', value: 62.4 },  // 不应被当 yoy.previous
      { time_period: '2026-01', value: 60.82 },
      { time_period: '2026-02', value: 66.94 },
      { time_period: '2026-03', value: 68.82 }, // latestMature
      { time_period: '2026-04', value: 68.61 }, // excluded
      { time_period: '2026-05', value: 55.88 }, // excluded
      { time_period: '2026-06', value: 113.74 }, // excluded（series 尾月，未成熟，禁止用作 yoy.current）
    ];
    const v = evaluateMetricSeries('earned_claim_ratio', series, {
      zThreshold: 2.5,
      momThreshold: 8,
      direction: 'up',
      excludeRecent: 3,
    });
    expect(v.latestMaturePeriod).toBe('2026-03');
    expect(v.latestMatureValue).toBe(68.82);
    // yoy.current 必须是 latestMature(2026-03)，previous 必须是 2025-03
    expect(v.yoy).toEqual({ current: 68.82, previous: 70.85, previousPeriod: '2025-03' });
  });

  it('series 缺去年同期 → yoy=null，不阻断主流程', () => {
    const series = [
      { time_period: '2026-01', value: 50 },
      { time_period: '2026-02', value: 51 },
      { time_period: '2026-03', value: 52 },
      { time_period: '2026-04', value: 53 },
    ];
    const v = evaluateMetricSeries('earned_claim_ratio', series, {
      zThreshold: 2,
      direction: 'up',
      excludeRecent: 1,
    });
    expect(v.yoy).toBeNull();
    expect(Number.isNaN(v.yoyDeviation)).toBe(true);
  });

  it('opts.yoy 显式传入时，跳过自动查找（保留对外注入入口）', () => {
    const series = [
      { time_period: '2025-03', value: 70.85 },
      { time_period: '2026-01', value: 60 },
      { time_period: '2026-02', value: 62 },
      { time_period: '2026-03', value: 99 },
    ];
    const v = evaluateMetricSeries('x', series, {
      excludeRecent: 0,
      yoy: { current: 99, previous: 50, previousPeriod: 'manual' },
    });
    expect(v.yoy).toEqual({ current: 99, previous: 50, previousPeriod: 'manual' });
  });
});

describe('sentinel/stats trimBaseline（issue #550 治本）', () => {
  it('短样本（<4）直接返回不 trim', () => {
    const r = trimBaseline([10, 20, 30]);
    expect(r.trimmed).toEqual([10, 20, 30]);
    expect(r.dropped).toEqual([]);
  });

  it('IQR 默认 k=1.5 剔除极端离群，保留主体', () => {
    // 主体 50-80 集中，极端 500 应被 IQR 剔除
    const r = trimBaseline([55, 60, 62, 65, 68, 70, 72, 75, 500]);
    expect(r.dropped).toContain(500);
    expect(r.trimmed.every((v) => v < 100)).toBe(true);
  });

  it('dropHead 剔除头部 N 期', () => {
    const r = trimBaseline([1000, 800, 50, 55, 60, 65, 70], { dropHead: 2 });
    expect(r.dropped).toContain(1000);
    expect(r.dropped).toContain(800);
  });

  it('dropHead 剔过狠则回退（剩余 <3 不剔）', () => {
    const r = trimBaseline([100, 50, 60, 70], { dropHead: 3 });
    // 4-3=1 < 3 → 回退保留全部
    expect(r.trimmed).toEqual([100, 50, 60, 70]);
    expect(r.dropped).toEqual([]);
  });

  it('IQR 剔过狠回退（保证剩余 ≥3）', () => {
    // 全部值都极近 → IQR=0 → 直接返回
    const r = trimBaseline([50, 50, 50, 50, 50]);
    expect(r.trimmed.length).toBe(5);
  });

  it('issue #550 真实病灶：mean/std 在 trim 后回归业务范围', () => {
    // 模拟 lossTrend 实际形态：头部早期 6 期极端，主体 40 期赔付率 50-80%
    const earlyChaos = [800, 500, 300, 200, 150, 100]; // 早期保单赔款未爬完
    const mainBody: number[] = [];
    for (let i = 0; i < 40; i++) {
      mainBody.push(60 + (i % 5) * 4); // 60, 64, 68, 72, 76 循环
    }
    const raw = [...earlyChaos, ...mainBody];
    const rawMean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const rawStd = Math.sqrt(raw.reduce((a, b) => a + (b - rawMean) ** 2, 0) / (raw.length - 1));
    expect(rawMean).toBeGreaterThan(100); // 被污染
    expect(rawStd).toBeGreaterThan(100);   // std 巨大

    const { trimmed, dropped } = trimBaseline(raw, { iqrK: 1.5, dropHead: 6 });
    const trimmedMean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    const trimmedStd = Math.sqrt(trimmed.reduce((a, b) => a + (b - trimmedMean) ** 2, 0) / (trimmed.length - 1));
    // 期望：trim 后均值回归 50~80 区间，std 回到个位数
    expect(trimmedMean).toBeGreaterThan(50);
    expect(trimmedMean).toBeLessThan(80);
    expect(trimmedStd).toBeLessThan(20);
    expect(dropped.length).toBeGreaterThanOrEqual(6); // 至少剔了头部 6 期
  });
});

describe('sentinel/stats evaluateMetricSeries baselineTrim 集成（向后兼容）', () => {
  // 构造与 issue #550 同型病灶：被污染基线 + 当期环比 +18%
  const sicklySeries = [
    ...Array.from({ length: 6 }, (_, i) => ({ time_period: `2022-${String(i + 1).padStart(2, '0')}`, value: 800 - i * 100 })), // 早期极端
    ...Array.from({ length: 36 }, (_, i) => ({
      time_period: `2023-${String(i + 1).padStart(2, '0')}`.replace(/-(\d\d)$/, (_, m) => `-${String(((+m - 1) % 12) + 1).padStart(2, '0')}`),
      value: 65 + (i % 4) * 3,
    })),
    { time_period: '2026-01', value: 66 },
    { time_period: '2026-02', value: 66 },
    { time_period: '2026-03', value: 78 }, // 被检值：环比 +18%
  ];

  it('baselineTrim=null 时保持旧行为（向后兼容 prepublish-gate）', () => {
    const v = evaluateMetricSeries('earned_claim_ratio', sicklySeries, {
      zThreshold: 2.5,
      momThreshold: 8,
      direction: 'up',
      excludeRecent: 0,
      // 未传 baselineTrim
    });
    expect(v.triggered).toBe(true);
    // 旧行为：std 被早期值污染巨大 → Z 失效（必由环比兜底）
    expect(v.baselineStd).toBeGreaterThan(50);
    // 触发原因里只有环比，没有 Z
    expect(v.reasons.some((r: string) => r.startsWith('Z='))).toBe(false);
    expect(v.reasons.some((r: string) => r.includes('环比'))).toBe(true);
    expect(v.baselineTrimmedCount).toBe(0);
  });

  it('启用 baselineTrim 后 std 回归业务范围，Z 路径恢复有效', () => {
    const v = evaluateMetricSeries('earned_claim_ratio', sicklySeries, {
      zThreshold: 2.5,
      momThreshold: 8,
      direction: 'up',
      excludeRecent: 0,
      baselineTrim: { iqrK: 1.5, dropHead: 6 },
    });
    expect(v.baselineStd).toBeLessThan(20); // trim 后标准差回归业务范围
    expect(v.baselineTrimmedCount).toBeGreaterThan(0);
    expect(v.baselineSize).toBeGreaterThan(0);
  });
});

describe('sentinel/stats computeFingerprint（silence 用）', () => {
  it('相同 metric+期+方向+环比规模 → 相同 fp', () => {
    const v1 = { metric: 'earned_claim_ratio', latestMaturePeriod: '2026-03', direction: 'up', mom: 18.3 };
    const v2 = { metric: 'earned_claim_ratio', latestMaturePeriod: '2026-03', direction: 'up', mom: 18.45 }; // 微抖动
    expect(computeFingerprint(v1)).toBe(computeFingerprint(v2));
  });

  it('期数推进 → 新 fp（让告警重新发声）', () => {
    const v1 = { metric: 'earned_claim_ratio', latestMaturePeriod: '2026-03', direction: 'up', mom: 18 };
    const v2 = { metric: 'earned_claim_ratio', latestMaturePeriod: '2026-04', direction: 'up', mom: 18 };
    expect(computeFingerprint(v1)).not.toBe(computeFingerprint(v2));
  });

  it('环比量级跳跃（>1% 整数变化）→ 新 fp', () => {
    const v1 = { metric: 'earned_claim_ratio', latestMaturePeriod: '2026-03', direction: 'up', mom: 18 };
    const v2 = { metric: 'earned_claim_ratio', latestMaturePeriod: '2026-03', direction: 'up', mom: 25 };
    expect(computeFingerprint(v1)).not.toBe(computeFingerprint(v2));
  });

  it('方向反转 → 新 fp', () => {
    const v1 = { metric: 'total_premium', latestMaturePeriod: '2026-05', direction: 'up', mom: 30 };
    const v2 = { metric: 'total_premium', latestMaturePeriod: '2026-05', direction: 'down', mom: 30 };
    expect(computeFingerprint(v1)).not.toBe(computeFingerprint(v2));
  });

  it('mom 为 NaN/缺失时 fp 仍稳定（用 na 占位）', () => {
    const v1 = { metric: 'x', latestMaturePeriod: '2026-03', direction: 'up', mom: NaN };
    const v2 = { metric: 'x', latestMaturePeriod: '2026-03', direction: 'up' };
    expect(computeFingerprint(v1)).toBe(computeFingerprint(v2));
    expect(computeFingerprint(v1)).toContain('|na');
  });

  it('缺 metric 返回空串（防把空 fp 误进 silence）', () => {
    expect(computeFingerprint(null)).toBe('');
    expect(computeFingerprint({})).toBe('');
  });
});
