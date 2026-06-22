import { describe, it, expect } from 'vitest';
import {
  buildRepairParams,
  findTierRow,
  computeToPremiumTotals,
  type CoopTierRow,
} from './repairKpi';

const tierRow = (
  coop_tier: CoopTierRow['coop_tier'],
  shop_count: number,
  damage_amount: number,
  net_premium: number
): CoopTierRow => ({ coop_tier, shop_count, damage_amount, net_premium });

describe('buildRepairParams · 筛选 → 查询参数', () => {
  it('仅 timeWindow（orgFilter/coopTier 为空 → 不带）', () => {
    expect(buildRepairParams('', 'ytd', '')).toEqual({ timeWindow: 'ytd' });
  });

  it('orgFilter 非空 → 带 orgName', () => {
    expect(buildRepairParams('天府', 'rolling12', '')).toEqual({
      timeWindow: 'rolling12',
      orgName: '天府',
    });
  });

  it('coopTier 非空 → 带 coopTier', () => {
    expect(buildRepairParams('', 'all', 'active')).toEqual({
      timeWindow: 'all',
      coopTier: 'active',
    });
  });

  it('全部非空 → 三键齐全', () => {
    expect(buildRepairParams('高新', 'ytd', 'past')).toEqual({
      timeWindow: 'ytd',
      orgName: '高新',
      coopTier: 'past',
    });
  });
});

describe('findTierRow · 合作层级查找', () => {
  const rows = [tierRow('active', 10, 100, 200), tierRow('past', 5, 50, 80)];

  it('命中 → 返回该行', () => {
    expect(findTierRow(rows, 'active')).toEqual(tierRow('active', 10, 100, 200));
  });

  it('命中 none_shadow（影子层级）', () => {
    const withShadow = [...rows, tierRow('none_shadow', 3, 30, 0)];
    expect(findTierRow(withShadow, 'none_shadow')).toEqual(tierRow('none_shadow', 3, 30, 0));
  });

  it('未命中 → 补零缺省', () => {
    expect(findTierRow(rows, 'none')).toEqual({ shop_count: 0, damage_amount: 0, net_premium: 0 });
  });

  it('空数组 → 补零缺省', () => {
    expect(findTierRow([], 'active')).toEqual({ shop_count: 0, damage_amount: 0, net_premium: 0 });
  });
});

describe('computeToPremiumTotals · 汇总 + 整体核损保费比', () => {
  it('空数组 → 全 0，比值 null（除零保护）', () => {
    expect(computeToPremiumTotals([])).toEqual({
      totalDamage: 0,
      totalPremium: 0,
      overallRatio: null,
    });
  });

  it('求和 + 比值 = 核损 / 保费', () => {
    const r = computeToPremiumTotals([
      { damage_amount: 30, net_premium: 100 },
      { damage_amount: 20, net_premium: 100 },
    ]);
    expect(r.totalDamage).toBe(50);
    expect(r.totalPremium).toBe(200);
    expect(r.overallRatio).toBe(0.25);
  });

  it('缺失字段按 0 计', () => {
    const r = computeToPremiumTotals([{ damage_amount: 10 }, { net_premium: 40 }, {}]);
    expect(r.totalDamage).toBe(10);
    expect(r.totalPremium).toBe(40);
    expect(r.overallRatio).toBe(0.25);
  });

  it('净保费为 0 但有核损 → 比值 null（不产生 Infinity）', () => {
    expect(computeToPremiumTotals([{ damage_amount: 50, net_premium: 0 }]).overallRatio).toBeNull();
  });
});
