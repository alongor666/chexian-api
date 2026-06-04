/**
 * performancePlanDenominator 单元测试
 *
 * 目的：锁定与后端 server/src/sql/performance-analysis/shared.ts:29 的口径一致性，
 * 防止年度计划与当期保费做减法导致的口径错乱（PR #477 codex review line 110）。
 */
import { describe, it, expect } from 'vitest';
import {
  getPlanDenominator,
  getPeriodPlan,
  getPeriodGap,
} from '../performancePlanDenominator';

describe('getPlanDenominator', () => {
  it('返回后端 shared.ts 同表的分母', () => {
    expect(getPlanDenominator('day')).toBe(365);
    expect(getPlanDenominator('week')).toBe(52);
    expect(getPlanDenominator('month')).toBe(12);
    expect(getPlanDenominator('quarter')).toBe(4);
    expect(getPlanDenominator('year')).toBe(1);
  });
});

describe('getPeriodPlan', () => {
  it('年度计划 1000 万、按月口径 → 当期目标 ≈ 83.33 万', () => {
    expect(getPeriodPlan(1000, 'month')).toBeCloseTo(83.333, 2);
  });

  it('年度计划 365 万、按日口径 → 当期目标 = 1 万（整除）', () => {
    expect(getPeriodPlan(365, 'day')).toBe(1);
  });

  it('年度口径直接返回原值', () => {
    expect(getPeriodPlan(1000, 'year')).toBe(1000);
  });

  it('null / undefined / NaN 返回 null', () => {
    expect(getPeriodPlan(null, 'day')).toBeNull();
    expect(getPeriodPlan(undefined, 'day')).toBeNull();
    expect(getPeriodPlan(NaN, 'day')).toBeNull();
  });
});

describe('getPeriodGap', () => {
  it('当期保费高于当期目标 → 缺口 = 0（达成）', () => {
    // 年度计划 1000 万、按日 → 当期目标 ≈ 2.74 万；当期保费 4 万 → 达成
    expect(getPeriodGap(1000, 4, 'day')).toBe(0);
  });

  it('当期保费低于当期目标 → 返回正缺口', () => {
    // 年度计划 1200 万、按月 → 当期目标 100 万；当期保费 70 万 → 缺口 30 万
    expect(getPeriodGap(1200, 70, 'month')).toBeCloseTo(30, 5);
  });

  it('年度计划为 null → 缺口 = 0（无法判断）', () => {
    expect(getPeriodGap(null, 50, 'day')).toBe(0);
  });

  it('保费恰好等于目标 → 缺口 = 0', () => {
    expect(getPeriodGap(120, 10, 'month')).toBe(0);
  });

  it('PR #477 codex 场景：149.7% 达成不应再显示缺口', () => {
    // 假设年度计划 1000 万、按日 → 当期目标 ≈ 2.74 万；当期保费 4.1 万 → ach ≈ 150%
    // 用之前的"年度 plan - 当期 premium"会得到 ~996 万巨大缺口（错）
    // 正确应该返回 0
    expect(getPeriodGap(1000, 4.1, 'day')).toBe(0);
  });
});
