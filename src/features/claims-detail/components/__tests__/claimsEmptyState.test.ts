/**
 * claims-detail 赔付热力图空态判据单测（PR-5 · 前端空态保护）。
 * 规模锚（已赚保费/赔款/件数）全 ≤ 0 / 无数据行 → 空态（装载中），非真实零。
 */
import { describe, it, expect } from 'vitest';
import { isClaimsHeatmapEmpty, isGeoRiskEmpty } from '../claimsEmptyState';

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

// ── GeoRiskPanel 空态判据（2026-06-25-claude-6a5aad follow-up）────────────
// 数据缺失锚：geoAccident（出险地）与 geoPlate（车牌归属地）两端点均为 GROUP BY 聚合，
// 无匹配数据（SX 装载中 / 真正无地理归属记录）时恒返回 []。geoComparison 是无 GROUP BY
// 单行聚合，即便 base 为空也恒返回 1 行 total_cases=0，因此不能单独作为「数据缺失」判据
// （否则窄筛选下真实零赔案会被误判为「装载中」）。
describe('isGeoRiskEmpty（数据缺失锚：出险地/车牌归属地两端点同时无规模行）', () => {
  it('两端点均为空数组 → 空态（装载中）', () => {
    expect(isGeoRiskEmpty([], [])).toBe(true);
  });
  it('两端点均 undefined → 空态', () => {
    expect(isGeoRiskEmpty(undefined, undefined)).toBe(true);
  });
  it('出险地有行（cases>0）、车牌归属地为空 → 非空（任一端点有数据即非空）', () => {
    expect(isGeoRiskEmpty([{ cases: 3 }], [])).toBe(false);
  });
  it('车牌归属地有行（cases>0）、出险地为空 → 非空', () => {
    expect(isGeoRiskEmpty([], [{ cases: 2 }])).toBe(false);
  });
  it('两端点都有行且 cases>0 → 非空（正常经营态）', () => {
    expect(isGeoRiskEmpty([{ cases: 5 }], [{ cases: 5 }])).toBe(false);
  });
  it('两端点行存在但 cases 全为 0 → 空态（有行无业务量，视同缺失）', () => {
    expect(isGeoRiskEmpty([{ cases: 0 }], [{ cases: 0 }])).toBe(true);
  });
  it('cases 为 null/undefined 经 toNum 归零 → 空态', () => {
    expect(isGeoRiskEmpty([{ cases: null }], [{ cases: undefined }])).toBe(true);
  });
  it('真实零赔案场景：窄筛选下仅本地案件、无异地案件时 accident 行仍非空 → 非空（不误伤真实零）', () => {
    // 模拟"仅 1 笔本地案件、无异地案件"的真实业务态：geoAccident 有 1 行 cases=1，
    // geoComparison 会算出 cross_region_cases=0（无异地），但 accident 明细行本身非空，
    // 说明这是「真实有数据、只是异地占比为 0」而非「数据缺失」。
    expect(isGeoRiskEmpty([{ cases: 1 }], [])).toBe(false);
  });
});
