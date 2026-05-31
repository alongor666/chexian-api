import { describe, it, expect } from 'vitest';
import { gradeRate, renewRate, quoteRate, rowGrade, isBadRow, compareRows } from './grading';
import { getRenewalStatus, DEFAULT_RENEWAL_THRESHOLDS } from '@/shared/ui/RenewalStatusBadge';
import type { RenewalRow, SortField, SortDir } from '../types';

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

describe('gradeRate · 续保率复用全局口径（单一事实源）', () => {
  it('续保率分级 = 全局 getRenewalStatus（healthy 0.60 / warning 0.56）', () => {
    expect(DEFAULT_RENEWAL_THRESHOLDS).toEqual({ healthy: 0.6, warning: 0.56 });
    expect(gradeRate('renew', 0.55)).toBe('d'); // < 0.56 → danger
    expect(gradeRate('renew', 0.56)).toBe('w'); // 恰好 warning 线
    expect(gradeRate('renew', 0.59)).toBe('w');
    expect(gradeRate('renew', 0.6)).toBe('g'); // 恰好 healthy 线
    expect(gradeRate('renew', 0.9)).toBe('g');
  });
  it('续保率分级与全局 getRenewalStatus 完全一致', () => {
    const map = { success: 'g', warning: 'w', danger: 'd' } as const;
    for (const r of [0.3, 0.55, 0.56, 0.59, 0.6, 0.8]) {
      expect(gradeRate('renew', r)).toBe(map[getRenewalStatus(r)]);
    }
  });
  it('报价率分级边界（本页专属 0.74 / 0.70）', () => {
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
  it('续保率低于 56% → 坏行', () => {
    const bad = mkRow({ A: 1000, B: 700, C: 500 }); // 50%
    expect(rowGrade(bad)).toBe('d');
    expect(isBadRow(bad)).toBe(true);
  });
  it('续保率健康 → 非坏行', () => {
    const ok = mkRow({ A: 1000, B: 800, C: 650 }); // 65%
    expect(rowGrade(ok)).toBe('g');
    expect(isBadRow(ok)).toBe(false);
  });
  it('零应续（A=0）不算坏行——无数据 ≠ 续保崩了', () => {
    const empty = mkRow({ A: 0, B: 0, C: 0 });
    expect(isBadRow(empty)).toBe(false);
  });
});

describe('compareRows · 零应续恒垫底', () => {
  const real = mkRow({ org_level_3: '真实', A: 1000, B: 700, C: 300 }); // 续保率 30%（很差）
  const empty = mkRow({ org_level_3: '空口径', A: 0, B: 0, C: 0 });

  it('续保率升序（最差置顶）时，零应续仍排在真实差行之后', () => {
    const sorted = [empty, real].sort((a, b) => compareRows(a, b, 'E' as SortField, 'asc' as SortDir));
    expect(sorted.map(r => r.org_level_3)).toEqual(['真实', '空口径']);
  });
  it('降序时零应续也排末尾（不冒充最大）', () => {
    const sorted = [empty, real].sort((a, b) => compareRows(a, b, 'A' as SortField, 'desc' as SortDir));
    expect(sorted.map(r => r.org_level_3)).toEqual(['真实', '空口径']);
  });
});
