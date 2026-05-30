import { describe, it, expect } from 'vitest';
import { THRESHOLDS, gradeRate, renewRate, quoteRate, rowGrade, isBadRow } from './grading';
import type { RenewalRow } from '../types';

function mkRow(partial: Partial<RenewalRow>): RenewalRow {
  return {
    row_level: 'org',
    org_level_3: null,
    team_name: null,
    salesman_name: null,
    customer_category: null,
    coverage_combination: null,
    fuel_category: null,
    used_transfer_type: null,
    renewal_type: null,
    A: 0,
    B: 0,
    C: 0,
    ...partial,
  };
}

describe('grading thresholds（重设计简报口径）', () => {
  it('续保率 warn<62% danger<58%', () => {
    expect(THRESHOLDS.renew).toEqual({ warn: 0.62, danger: 0.58 });
  });
  it('报价率 warn<74% danger<70%', () => {
    expect(THRESHOLDS.quote).toEqual({ warn: 0.74, danger: 0.7 });
  });
});

describe('gradeRate', () => {
  it('续保率分级边界', () => {
    expect(gradeRate('renew', 0.57)).toBe('d');
    expect(gradeRate('renew', 0.58)).toBe('w'); // 恰好达到 warn 线（不再 danger）
    expect(gradeRate('renew', 0.61)).toBe('w');
    expect(gradeRate('renew', 0.62)).toBe('g'); // 恰好达到健康线
    expect(gradeRate('renew', 0.9)).toBe('g');
  });
  it('报价率分级边界', () => {
    expect(gradeRate('quote', 0.69)).toBe('d');
    expect(gradeRate('quote', 0.7)).toBe('w');
    expect(gradeRate('quote', 0.74)).toBe('g');
  });
  it('null（分母为 0）视为最差 d', () => {
    expect(gradeRate('renew', null)).toBe('d');
  });
});

describe('rate helpers', () => {
  it('分母为 0 返回 null', () => {
    expect(renewRate(mkRow({ A: 0, C: 0 }))).toBeNull();
    expect(quoteRate(mkRow({ A: 0, B: 0 }))).toBeNull();
  });
  it('正常计算率', () => {
    expect(renewRate(mkRow({ A: 100, C: 60 }))).toBeCloseTo(0.6);
    expect(quoteRate(mkRow({ A: 100, B: 75 }))).toBeCloseTo(0.75);
  });
});

describe('rowGrade / isBadRow', () => {
  it('续保率低于 58% → 坏行', () => {
    const bad = mkRow({ A: 1000, B: 700, C: 500 }); // 50%
    expect(rowGrade(bad)).toBe('d');
    expect(isBadRow(bad)).toBe(true);
  });
  it('续保率健康 → 非坏行', () => {
    const ok = mkRow({ A: 1000, B: 800, C: 650 }); // 65%
    expect(rowGrade(ok)).toBe('g');
    expect(isBadRow(ok)).toBe(false);
  });
});
