/**
 * claims-detail 赔付热力图空态判据单测（PR-5 · 前端空态保护）。
 * 规模锚（已赚保费/赔款/件数）全 ≤ 0 / 无数据行 → 空态（装载中），非真实零。
 */
import { describe, it, expect } from 'vitest';
import { isClaimsHeatmapEmpty } from '../claimsEmptyState';

describe('isClaimsHeatmapEmpty（规模锚：已赚保费/赔款/件数）', () => {
  it('空数组 / undefined → 空态', () => {
    expect(isClaimsHeatmapEmpty([])).toBe(true);
    expect(isClaimsHeatmapEmpty(undefined)).toBe(true);
  });
  it('所有行规模锚全 0 → 空态（有时间桶但零值，挡住静默零矩阵）', () => {
    expect(isClaimsHeatmapEmpty([
      { earned_premium_wan: 0, claim_count: 0, total_claims_wan: 0 },
      { earned_premium_wan: 0, claim_count: 0, total_claims_wan: 0 },
    ])).toBe(true);
  });
  it('任一行有已赚保费 → 非空', () => {
    expect(isClaimsHeatmapEmpty([
      { earned_premium_wan: 0, claim_count: 0, total_claims_wan: 0 },
      { earned_premium_wan: 1200, claim_count: 0, total_claims_wan: 0 },
    ])).toBe(false);
  });
  it('有件数但保费/赔款为 0 → 非空（有业务量）', () => {
    expect(isClaimsHeatmapEmpty([{ earned_premium_wan: 0, claim_count: 5, total_claims_wan: 0 }])).toBe(false);
  });
  it('有赔款但件数/保费为 0 → 非空', () => {
    expect(isClaimsHeatmapEmpty([{ earned_premium_wan: 0, claim_count: 0, total_claims_wan: 8.5 }])).toBe(false);
  });
  it('规模锚为 null/undefined 经 toNum 归零 → 空态', () => {
    expect(isClaimsHeatmapEmpty([{ earned_premium_wan: null, claim_count: undefined, total_claims_wan: null }])).toBe(true);
  });
  it('规模锚为负数 / NaN → 「不 > 0」按空态（保守，冲销类负值宁显装载中）', () => {
    expect(isClaimsHeatmapEmpty([{ earned_premium_wan: -10, claim_count: Number.NaN, total_claims_wan: -2 }])).toBe(true);
  });
});
