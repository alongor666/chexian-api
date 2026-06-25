/**
 * 续保追踪空态判据单测（PR-5 · 前端空态保护）。
 * 规模锚 = 应续件数 A；overall.A 与所有 org.A 全 ≤ 0 → 空态（装载中），非真实零。
 */
import { describe, it, expect } from 'vitest';
import { isRenewalEmpty } from '../renewalEmptyState';
import type { RenewalRow } from '../../types';

const row = (over: Partial<RenewalRow>): RenewalRow =>
  ({ row_level: 'overall', A: 0, B: 0, C: 0, ...over } as RenewalRow);

describe('isRenewalEmpty', () => {
  it('overall 为 null → 空态', () => {
    expect(isRenewalEmpty(null, [])).toBe(true);
    expect(isRenewalEmpty(undefined, undefined)).toBe(true);
  });

  it('overall.A=0 且无机构行 → 空态', () => {
    expect(isRenewalEmpty(row({ A: 0 }), [])).toBe(true);
  });

  it('overall.A=0 且所有机构 A=0 → 空态（装载中）', () => {
    expect(isRenewalEmpty(row({ A: 0 }), [row({ row_level: 'org', A: 0 }), row({ row_level: 'org', A: 0 })])).toBe(true);
  });

  it('overall.A>0 → 有业务量（非空）', () => {
    expect(isRenewalEmpty(row({ A: 1200 }), [])).toBe(false);
  });

  it('overall.A=0 但某机构 A>0 → 有业务量（非空）', () => {
    expect(isRenewalEmpty(row({ A: 0 }), [row({ row_level: 'org', A: 0 }), row({ row_level: 'org', A: 50 })])).toBe(false);
  });

  it('已续 C=0 但应续 A>0 → 非空（真实零续保≠装载中）', () => {
    expect(isRenewalEmpty(row({ A: 800, B: 600, C: 0 }), [])).toBe(false);
  });

  it('A 为 null/undefined 经 toNum 归零 → 空态', () => {
    expect(isRenewalEmpty(row({ A: null as unknown as number }), [row({ row_level: 'org', A: undefined as unknown as number })])).toBe(true);
  });

  it('A 为负数 / NaN → 「不 > 0」按空态（保守，宁显装载中不显误导零）', () => {
    expect(isRenewalEmpty(row({ A: -3 }), [])).toBe(true);
    expect(isRenewalEmpty(row({ A: Number.NaN }), [row({ row_level: 'org', A: -1 })])).toBe(true);
  });
});
