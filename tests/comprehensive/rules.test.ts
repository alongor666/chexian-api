import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPREHENSIVE_THRESHOLDS,
  buildOverviewAlerts,
  mergeThresholds,
} from '../../src/features/comprehensive-analysis/rules';
import type { ComprehensiveMetricRow } from '../../src/features/comprehensive-analysis/types';

function createRow(partial: Partial<ComprehensiveMetricRow>): ComprehensiveMetricRow {
  return {
    dimType: 'org',
    dimKey: '天府',
    rank: 1,
    policyCount: 100,
    signedPremium: 1000000,
    reportedClaims: 300000,
    feeAmount: 90000,
    claimCases: 30,
    earnedPremium: 500000,
    earnedClaimRatio: 60,
    expenseRatio: 9,
    variableCostRatio: 69,
    avgClaimAmount: 10000,
    claimFrequency: 30,
    premiumShare: 35,
    claimShare: 33,
    expenseShare: 30,
    planPremium: 1200000,
    achievementRate: 90,
    ...partial,
  };
}

// 默认全部指标“健康”（不触发任何告警），用于隔离单一边界
function healthyRow(partial: Partial<ComprehensiveMetricRow> = {}): ComprehensiveMetricRow {
  return createRow({
    achievementRate: 100, // ≥ premiumProgressWarn(99) → 不触发“保费进度落后”
    variableCostRatio: 0,
    earnedClaimRatio: 0,
    expenseRatio: 0,
    ...partial,
  });
}

describe('comprehensive rules', () => {
  it('merges threshold with defaults', () => {
    const thresholds = mergeThresholds({ lossRateWarn: 72 });
    expect(thresholds.lossRateWarn).toBe(72);
    expect(thresholds.expenseBudget).toBe(14);
  });

  it('builds alert messages by threshold', () => {
    const thresholds = mergeThresholds(null);
    const alerts = buildOverviewAlerts(
      [
        createRow({ dimKey: '天府', achievementRate: 88 }),
        createRow({ dimKey: '高新', variableCostRatio: 95 }),
        createRow({ dimKey: '宜宾', earnedClaimRatio: 75 }),
        createRow({ dimKey: '青羊', expenseRatio: 18 }),
      ],
      thresholds
    );

    expect(alerts.join('|')).toContain('保费进度落后');
    expect(alerts.join('|')).toContain('变动成本率超标');
    expect(alerts.join('|')).toContain('满期赔付率偏高');
    expect(alerts.join('|')).toContain('费用率超标');
  });
});

describe('mergeThresholds · 边界与不可变', () => {
  it('入参 undefined → 全默认', () => {
    expect(mergeThresholds(undefined)).toEqual(DEFAULT_COMPREHENSIVE_THRESHOLDS);
  });

  it('入参 null → 全默认（走 || {}）', () => {
    expect(mergeThresholds(null)).toEqual(DEFAULT_COMPREHENSIVE_THRESHOLDS);
  });

  it('部分覆盖只改对应字段，其余保持默认', () => {
    expect(mergeThresholds({ costRateWarn: 95 })).toEqual({
      ...DEFAULT_COMPREHENSIVE_THRESHOLDS,
      costRateWarn: 95,
    });
  });

  it('属性值显式 undefined 会把默认覆盖成 undefined（spread 真实语义，非回退默认）', () => {
    // 锁住 JS spread 真实行为：{ ...default, costRateWarn: undefined } → undefined
    expect(mergeThresholds({ costRateWarn: undefined }).costRateWarn).toBeUndefined();
  });

  it('不可变：不修改入参、返回的不是默认常量本身', () => {
    const input = { lossRateWarn: 80 };
    const result = mergeThresholds(input);
    expect(input).toEqual({ lossRateWarn: 80 });
    expect(result).not.toBe(DEFAULT_COMPREHENSIVE_THRESHOLDS);
  });

  it('undefined / null 输入也返回新对象（防未来引入“快路径直接返回常量”导致外部可变）', () => {
    expect(mergeThresholds(undefined)).not.toBe(DEFAULT_COMPREHENSIVE_THRESHOLDS);
    expect(mergeThresholds(null)).not.toBe(DEFAULT_COMPREHENSIVE_THRESHOLDS);
  });
});

describe('buildOverviewAlerts · 阈值边界三件套（恰好线/线下/线上）', () => {
  it('仅统计 dimType===org 行（非 org 行即便全部超标也不告警）', () => {
    const rows = [
      healthyRow({
        dimType: 'category',
        achievementRate: 1,
        variableCostRatio: 100,
        earnedClaimRatio: 100,
        expenseRatio: 100,
      }),
    ];
    expect(buildOverviewAlerts(rows, DEFAULT_COMPREHENSIVE_THRESHOLDS)).toEqual([]);
  });

  it('空 rows → []', () => {
    expect(buildOverviewAlerts([], DEFAULT_COMPREHENSIVE_THRESHOLDS)).toEqual([]);
  });

  // premiumLag: achievementRate < premiumProgressWarn(99)，严格小于
  it('保费进度落后边界（< 99）：98 报 / 99 不报 / 100 不报 / null 不报', () => {
    const alert = (ar: number | null) =>
      buildOverviewAlerts([healthyRow({ dimKey: '甲', achievementRate: ar })], DEFAULT_COMPREHENSIVE_THRESHOLDS);
    expect(alert(98)).toEqual(['甲保费进度落后']);
    expect(alert(99)).toEqual([]);
    expect(alert(100)).toEqual([]);
    expect(alert(null)).toEqual([]);
  });

  // highCost: variableCostRatio > costRateWarn(91)，严格大于
  it('变动成本率超标边界（> 91）：92 报 / 91 不报 / 90 不报 / null 不报', () => {
    const alert = (v: number | null) =>
      buildOverviewAlerts([healthyRow({ dimKey: '甲', variableCostRatio: v })], DEFAULT_COMPREHENSIVE_THRESHOLDS);
    expect(alert(92)).toEqual(['甲变动成本率超标']);
    expect(alert(91)).toEqual([]);
    expect(alert(90)).toEqual([]);
    expect(alert(null)).toEqual([]);
  });

  // highLoss: earnedClaimRatio > lossRateWarn(70)
  it('满期赔付率偏高边界（> 70）：71 报 / 70 不报 / null 不报', () => {
    const alert = (v: number | null) =>
      buildOverviewAlerts([healthyRow({ dimKey: '甲', earnedClaimRatio: v })], DEFAULT_COMPREHENSIVE_THRESHOLDS);
    expect(alert(71)).toEqual(['甲满期赔付率偏高']);
    expect(alert(70)).toEqual([]);
    expect(alert(null)).toEqual([]);
  });

  // highExpense: expenseRatio > expenseRateWarn(16)
  it('费用率超标边界（> 16）：17 报 / 16 不报 / null 不报', () => {
    const alert = (v: number | null) =>
      buildOverviewAlerts([healthyRow({ dimKey: '甲', expenseRatio: v })], DEFAULT_COMPREHENSIVE_THRESHOLDS);
    expect(alert(17)).toEqual(['甲费用率超标']);
    expect(alert(16)).toEqual([]);
    expect(alert(null)).toEqual([]);
  });

  it('自定义阈值改变边界判定（costRateWarn=80 时 85 触发）', () => {
    const custom = mergeThresholds({ costRateWarn: 80 });
    expect(buildOverviewAlerts([healthyRow({ dimKey: '甲', variableCostRatio: 85 })], custom)).toEqual([
      '甲变动成本率超标',
    ]);
  });

  it('每类各自 slice(0,5)：6 个落后机构只列前 5', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((k) => healthyRow({ dimKey: k, achievementRate: 1 }));
    const alerts = buildOverviewAlerts(rows, DEFAULT_COMPREHENSIVE_THRESHOLDS);
    expect(alerts).toEqual(['A、B、C、D、E保费进度落后']);
    expect(alerts[0]).not.toContain('F');
  });

  it('成本 / 赔付 / 费用三类也各自独立 slice(0,5)', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(
      buildOverviewAlerts(six.map((k) => healthyRow({ dimKey: k, variableCostRatio: 99 })), DEFAULT_COMPREHENSIVE_THRESHOLDS)
    ).toEqual(['A、B、C、D、E变动成本率超标']);
    expect(
      buildOverviewAlerts(six.map((k) => healthyRow({ dimKey: k, earnedClaimRatio: 99 })), DEFAULT_COMPREHENSIVE_THRESHOLDS)
    ).toEqual(['A、B、C、D、E满期赔付率偏高']);
    expect(
      buildOverviewAlerts(six.map((k) => healthyRow({ dimKey: k, expenseRatio: 99 })), DEFAULT_COMPREHENSIVE_THRESHOLDS)
    ).toEqual(['A、B、C、D、E费用率超标']);
  });

  it('告警顺序固定：保费 → 成本 → 赔付 → 费用（与输入行顺序无关）', () => {
    const rows = [
      healthyRow({ dimKey: '丁', expenseRatio: 99 }),
      healthyRow({ dimKey: '丙', earnedClaimRatio: 99 }),
      healthyRow({ dimKey: '乙', variableCostRatio: 99 }),
      healthyRow({ dimKey: '甲', achievementRate: 1 }),
    ];
    expect(buildOverviewAlerts(rows, DEFAULT_COMPREHENSIVE_THRESHOLDS)).toEqual([
      '甲保费进度落后',
      '乙变动成本率超标',
      '丙满期赔付率偏高',
      '丁费用率超标',
    ]);
  });
});
