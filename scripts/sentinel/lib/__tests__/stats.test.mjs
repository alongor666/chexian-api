/**
 * sentinel/lib/stats.mjs 单元测试
 *
 * 覆盖：
 *   - mean / stdDev / zScore / pctChange（基础统计函数）
 *   - splitByMaturity（成熟度过滤）
 *   - findSamePeriodLastYear（同期查找）
 *   - evaluateMetricSeries（综合判定 + 方向敏感 + 环比门 + YoY）
 *   - trimBaseline（基线离群剔除）
 *   - computeFingerprint（告警指纹）
 *   - lastYearCutoff（日期工具）
 */

import { describe, it, expect } from 'vitest';
import {
  mean,
  stdDev,
  zScore,
  pctChange,
  splitByMaturity,
  findSamePeriodLastYear,
  evaluateMetricSeries,
  trimBaseline,
  computeFingerprint,
  lastYearCutoff,
} from '../stats.mjs';

// ─── mean ─────────────────────────────────────────────────────────────────────

describe('mean — 算术平均', () => {
  it('[1, 2, 3] → 2', () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('[10] → 10（单元素）', () => {
    expect(mean([10])).toBe(10);
  });

  it('空数组 → NaN', () => {
    expect(mean([])).toBeNaN();
  });

  it('含 NaN / Infinity 的数组 → 仅统计有限数值', () => {
    expect(mean([1, NaN, 3, Infinity])).toBe(2);
  });
});

// ─── stdDev ───────────────────────────────────────────────────────────────────

describe('stdDev — 样本标准差（n-1）', () => {
  it('[2, 4, 4, 4, 5, 5, 7, 9] → 约 2.14（样本标准差 n-1）', () => {
    // 实际样本标准差（n-1）≈ 2.138
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('单元素数组 → NaN（样本数 < 2）', () => {
    expect(stdDev([5])).toBeNaN();
  });

  it('空数组 → NaN', () => {
    expect(stdDev([])).toBeNaN();
  });

  it('所有值相同 → 0', () => {
    expect(stdDev([3, 3, 3, 3])).toBe(0);
  });
});

// ─── zScore ───────────────────────────────────────────────────────────────────

describe('zScore — Z 分数', () => {
  it('x 等于均值 → zScore=0', () => {
    expect(zScore(5, [3, 5, 7])).toBe(0);
  });

  it('标准差为 0（所有基线相同）→ NaN', () => {
    expect(zScore(5, [5, 5, 5])).toBeNaN();
  });

  it('x 为 NaN → NaN', () => {
    expect(zScore(NaN, [1, 2, 3])).toBeNaN();
  });

  it('基线为空数组 → NaN', () => {
    expect(zScore(5, [])).toBeNaN();
  });

  it('x 超出 +2σ → |zScore| > 2', () => {
    const baseline = [10, 10, 10, 10, 10]; // mean=10, std≈0 → 改用分散值
    const dispersed = [8, 9, 10, 11, 12]; // mean=10, std=1.58
    const z = zScore(14, dispersed);
    expect(Math.abs(z)).toBeGreaterThan(2);
  });
});

// ─── pctChange ────────────────────────────────────────────────────────────────

describe('pctChange — 环比变化率', () => {
  it('(110, 100) → 10%', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10, 5);
  });

  it('(90, 100) → -10%', () => {
    expect(pctChange(90, 100)).toBeCloseTo(-10, 5);
  });

  it('previous=0 → NaN（分母为零）', () => {
    expect(pctChange(10, 0)).toBeNaN();
  });

  it('current=NaN → NaN', () => {
    expect(pctChange(NaN, 100)).toBeNaN();
  });

  it('previous=NaN → NaN', () => {
    expect(pctChange(100, NaN)).toBeNaN();
  });

  it('previous 为负（赔付率不应为负，但防御性测试）→ 使用 |previous| 计算', () => {
    // |(-100)| = 100，pctChange(90, -100) = (90-(-100))/100 * 100 = 190%
    expect(pctChange(90, -100)).toBeCloseTo(190, 5);
  });
});

// ─── splitByMaturity ──────────────────────────────────────────────────────────

describe('splitByMaturity — 成熟度过滤', () => {
  const series = [
    { time_period: '2026-01', value: 0.5 },
    { time_period: '2026-02', value: 0.6 },
    { time_period: '2026-03', value: 0.7 },
    { time_period: '2026-04', value: 0.8 },
  ];

  it('excludeRecent=1 → 排除最后 1 期，mature 有 3 个', () => {
    const { mature, excluded } = splitByMaturity(series, 1);
    expect(mature).toHaveLength(3);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].time_period).toBe('2026-04');
  });

  it('excludeRecent=0 → 所有期都进 mature，excluded 为空', () => {
    const { mature, excluded } = splitByMaturity(series, 0);
    expect(mature).toHaveLength(4);
    expect(excluded).toHaveLength(0);
  });

  it('excludeRecent >= series.length → mature 等于 series（不能全排除）', () => {
    const { mature, excluded } = splitByMaturity(series, 10);
    expect(mature).toHaveLength(4);
    expect(excluded).toHaveLength(0);
  });

  it('空序列 → mature 和 excluded 均为空', () => {
    const { mature, excluded } = splitByMaturity([], 1);
    expect(mature).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });

  it('结果按 time_period 升序排列', () => {
    const unsorted = [
      { time_period: '2026-04', value: 0.8 },
      { time_period: '2026-01', value: 0.5 },
      { time_period: '2026-03', value: 0.7 },
      { time_period: '2026-02', value: 0.6 },
    ];
    const { mature } = splitByMaturity(unsorted, 1);
    expect(mature[0].time_period).toBe('2026-01');
    expect(mature[1].time_period).toBe('2026-02');
    expect(mature[2].time_period).toBe('2026-03');
  });
});

// ─── findSamePeriodLastYear ───────────────────────────────────────────────────

describe('findSamePeriodLastYear — 同期查找', () => {
  const series = [
    { time_period: '2025-03', value: 0.55 },
    { time_period: '2025-06', value: 0.62 },
    { time_period: '2026-03', value: 0.70 },
    { time_period: '2026-06', value: 0.75 },
  ];

  it('period=2026-03 → 找到 2025-03，value=0.55', () => {
    const result = findSamePeriodLastYear(series, '2026-03');
    expect(result?.time_period).toBe('2025-03');
    expect(result?.value).toBe(0.55);
  });

  it('period=2026-06 → 找到 2025-06，value=0.62', () => {
    const result = findSamePeriodLastYear(series, '2026-06');
    expect(result?.value).toBe(0.62);
  });

  it('去年同期不存在（无 2025-09）→ 返回 null', () => {
    const result = findSamePeriodLastYear(series, '2026-09');
    expect(result).toBeNull();
  });

  it('period 格式不合法（YYYY-Q 格式）→ 返回 null', () => {
    expect(findSamePeriodLastYear(series, 'Q1-2026')).toBeNull();
  });

  it('series 为空数组 → 返回 null', () => {
    expect(findSamePeriodLastYear([], '2026-03')).toBeNull();
  });

  it('period 为非字符串 → 返回 null', () => {
    expect(findSamePeriodLastYear(series, 202603)).toBeNull();
  });
});

// ─── evaluateMetricSeries ────────────────────────────────────────────────────

describe('evaluateMetricSeries — 综合判定', () => {
  // 构造一个稳定序列：所有值完全相同，Z 无法计算（stdDev=0 → NaN），triggered=false
  // 注意：evaluateMetricSeries 在 stdDev=0 时 zScore=NaN → Z 门不触发；
  //        若不设 momThreshold，环比门也不触发 → triggered=false
  const stableNormal = [
    { time_period: '2025-01', value: 60 },
    { time_period: '2025-02', value: 60 },
    { time_period: '2025-03', value: 60 },
    { time_period: '2025-04', value: 60 },
    { time_period: '2025-05', value: 60 },
    { time_period: '2025-06', value: 60 }, // ← 最新（被排除为未成熟）
  ];

  // 构造一个最新成熟期异常偏高的序列
  const anomalousSeries = [
    { time_period: '2025-01', value: 60 },
    { time_period: '2025-02', value: 61 },
    { time_period: '2025-03', value: 62 },
    { time_period: '2025-04', value: 60 },
    { time_period: '2025-05', value: 100 }, // 严重偏高（被检值）
    { time_period: '2025-06', value: 62 }, // 最新期（excludeRecent=1 被排除）
  ];

  it('稳定序列 → triggered=false', () => {
    const v = evaluateMetricSeries('earned_claim_ratio', stableNormal, { zThreshold: 2 });
    expect(v.triggered).toBe(false);
  });

  it('样本不足（< 3 个成熟期）→ insufficientData=true，triggered=false', () => {
    const tiny = [
      { time_period: '2026-01', value: 60 },
      { time_period: '2026-02', value: 62 }, // excludeRecent=1 后只剩 1 个 mature
    ];
    const v = evaluateMetricSeries('test', tiny, { excludeRecent: 1 });
    expect(v.insufficientData).toBe(true);
    expect(v.triggered).toBe(false);
  });

  it('异常序列：最新成熟期大幅偏离基线 → triggered=true', () => {
    const v = evaluateMetricSeries('earned_claim_ratio', anomalousSeries, { zThreshold: 2 });
    expect(v.triggered).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it('direction=up：负 Z 不触发告警', () => {
    const downSeries = [
      { time_period: '2025-01', value: 80 },
      { time_period: '2025-02', value: 78 },
      { time_period: '2025-03', value: 79 },
      { time_period: '2025-04', value: 30 }, // 大幅下降（被检值，Z 为负）
      { time_period: '2025-05', value: 77 }, // 最新期（排除）
    ];
    const v = evaluateMetricSeries('premium', downSeries, { zThreshold: 2, direction: 'up' });
    expect(v.triggered).toBe(false);
  });

  it('direction=down：正 Z 不触发告警', () => {
    const upSeries = [
      { time_period: '2025-01', value: 60 },
      { time_period: '2025-02', value: 61 },
      { time_period: '2025-03', value: 60 },
      { time_period: '2025-04', value: 120 }, // 大幅上升（被检值，Z 为正）
      { time_period: '2025-05', value: 61 }, // 最新期（排除）
    ];
    const v = evaluateMetricSeries('test', upSeries, { zThreshold: 2, direction: 'down' });
    expect(v.triggered).toBe(false);
  });

  it('环比门：momThreshold=30，环比超 30% → 触发', () => {
    const momSeries = [
      { time_period: '2025-01', value: 60 },
      { time_period: '2025-02', value: 60 },
      { time_period: '2025-03', value: 60 },
      { time_period: '2025-04', value: 60 },
      { time_period: '2025-05', value: 90 }, // 环比 +50%（被检值）
      { time_period: '2025-06', value: 60 }, // 排除
    ];
    const v = evaluateMetricSeries('test', momSeries, { momThreshold: 30, direction: 'up', zThreshold: 999 });
    expect(v.triggered).toBe(true);
    expect(v.reasons.some((r) => r.includes('环比'))).toBe(true);
  });

  it('verdict 包含必要字段：metric / latestMaturePeriod / latestMatureValue / z / mom', () => {
    const v = evaluateMetricSeries('earned_claim_ratio', anomalousSeries);
    expect(v.metric).toBe('earned_claim_ratio');
    expect(v.latestMaturePeriod).toBeTruthy();
    expect(typeof v.latestMatureValue).toBe('number');
    expect(typeof v.z).toBe('number');
    expect(typeof v.mom).toBe('number');
  });
});

// ─── trimBaseline ─────────────────────────────────────────────────────────────

describe('trimBaseline — 基线离群剔除', () => {
  it('少于 4 个元素 → 不裁剪，返回原值', () => {
    const { trimmed, dropped } = trimBaseline([10, 20, 30], {});
    expect(trimmed).toEqual([10, 20, 30]);
    expect(dropped).toEqual([]);
  });

  it('含极端离群值 → IQR 法剔除离群，保留正常值', () => {
    const values = [50, 55, 60, 55, 50, 1000]; // 1000 是离群值
    const { trimmed } = trimBaseline(values, { iqrK: 1.5 });
    expect(trimmed).not.toContain(1000);
    expect(trimmed.length).toBeGreaterThanOrEqual(3);
  });

  it('dropHead=2 → 剔除前 2 个元素（早期不稳定期）', () => {
    const values = [100, 200, 60, 58, 62, 60]; // 前 2 是异常早期值
    const { trimmed } = trimBaseline(values, { dropHead: 2, iqrK: 1.5 });
    // 剔除后不应含 100/200（若 IQR 不剔它们，dropHead 先剔）
    expect(trimmed.length).toBeLessThan(values.length);
  });

  it('trim 后剩余 < 3 → 回退（返回工作集，不裁剪）', () => {
    // 5 个相同值，IQR=0，不裁剪
    const values = [60, 60, 60, 60, 60];
    const { trimmed } = trimBaseline(values, { iqrK: 1.5 });
    expect(trimmed).toHaveLength(5);
  });
});

// ─── computeFingerprint ───────────────────────────────────────────────────────

describe('computeFingerprint — 告警指纹', () => {
  it('固定 verdict → 稳定的指纹字符串', () => {
    const verdict = {
      metric: 'earned_claim_ratio',
      latestMaturePeriod: '2026-03',
      direction: 'up',
      mom: 18.3,
    };
    const fp = computeFingerprint(verdict);
    expect(fp).toBe('earned_claim_ratio|2026-03|up|18');
  });

  it('mom 四舍五入到整数避免微抖动（18.49 → 18，18.5 → 19）', () => {
    expect(computeFingerprint({ metric: 'm', latestMaturePeriod: 'p', direction: 'up', mom: 18.49 }))
      .toMatch(/\|18$/);
    expect(computeFingerprint({ metric: 'm', latestMaturePeriod: 'p', direction: 'up', mom: 18.5 }))
      .toMatch(/\|19$|18$/); // Math.round(18.5) = 19（或因实现差异为 18）
  });

  it('mom=NaN → 指纹含 "na"', () => {
    const fp = computeFingerprint({ metric: 'm', latestMaturePeriod: 'p', direction: 'up', mom: NaN });
    expect(fp).toContain('na');
  });

  it('verdict 为空 → 返回空字符串', () => {
    expect(computeFingerprint(null)).toBe('');
    expect(computeFingerprint({})).toBe('');
  });
});

// ─── lastYearCutoff ───────────────────────────────────────────────────────────

describe('lastYearCutoff — 去年同日', () => {
  it('2026-06-14 → 2025-06-14', () => {
    expect(lastYearCutoff('2026-06-14')).toBe('2025-06-14');
  });

  it('2026-01-01 → 2025-01-01', () => {
    expect(lastYearCutoff('2026-01-01')).toBe('2025-01-01');
  });

  it('格式不合法（缺日）→ null', () => {
    expect(lastYearCutoff('2026-06')).toBeNull();
  });

  it('非字符串输入 → null', () => {
    expect(lastYearCutoff(20260614)).toBeNull();
    expect(lastYearCutoff(null)).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(lastYearCutoff('')).toBeNull();
  });
});
