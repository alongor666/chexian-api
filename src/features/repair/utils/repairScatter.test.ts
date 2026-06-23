import { describe, it, expect } from 'vitest';
import { buildScatterAxes, scatterSymbolSize, buildTierSeriesData } from './repairScatter';
import type { ScatterShopPoint } from '../components/RepairScatter';

const pt = (overrides: Partial<ScatterShopPoint>): ScatterShopPoint => ({
  shop_code: 'c',
  shop_name: 'n',
  org_level_3: 'x',
  district: 'a',
  city: null,
  coop_tier: 'active',
  is_4s_shop: false,
  damage_amount: 0,
  net_premium: 0,
  ...overrides,
});

describe('buildScatterAxes · 去重排序轴', () => {
  it('空数据 → 空轴', () => {
    expect(buildScatterAxes([])).toEqual({ districtList: [], orgList: [] });
  });

  it('去重 + 排序', () => {
    const data = [
      pt({ district: 'b', org_level_3: 'y' }),
      pt({ district: 'a', org_level_3: 'x' }),
      pt({ district: 'b', org_level_3: 'x' }),
    ];
    expect(buildScatterAxes(data)).toEqual({ districtList: ['a', 'b'], orgList: ['x', 'y'] });
  });

  it('空值回退占位（未知区县 / 其他）', () => {
    expect(buildScatterAxes([pt({ district: null, org_level_3: null })])).toEqual({
      districtList: ['未知区县'],
      orgList: ['其他'],
    });
  });
});

describe('scatterSymbolSize · 净保费 → 尺寸（钳位 [8,40]）', () => {
  it('0 / 空值 → 下限 8', () => {
    expect(scatterSymbolSize(0)).toBe(8);
    expect(scatterSymbolSize(null)).toBe(8);
    expect(scatterSymbolSize(undefined)).toBe(8);
  });

  it('中段按 sqrt 缩放：40000→12、250000→18', () => {
    expect(scatterSymbolSize(40000)).toBe(12); // sqrt(4)*2+8
    expect(scatterSymbolSize(250000)).toBe(18); // sqrt(25)*2+8
  });

  it('恰好上限 2_560_000 → 40；超出 → 钳到 40', () => {
    expect(scatterSymbolSize(2_560_000)).toBe(40); // sqrt(256)*2+8
    expect(scatterSymbolSize(10_000_000)).toBe(40); // 超界钳位
  });
});

describe('buildTierSeriesData · 按层级过滤 + 坐标映射', () => {
  const data = [
    pt({ coop_tier: 'active', district: 'b', org_level_3: 'y', net_premium: 100 }),
    pt({ coop_tier: 'past', district: 'a', org_level_3: 'x', net_premium: 50 }),
    pt({ coop_tier: 'active', district: 'a', org_level_3: 'x', net_premium: 30 }),
  ];

  it('仅含目标层级，坐标 = 轴索引 + 净保费，并挂 shop 原对象', () => {
    const { districtList, orgList } = buildScatterAxes(data); // ['a','b'] / ['x','y']
    const out = buildTierSeriesData(data, 'active', districtList, orgList);
    expect(out).toHaveLength(2);
    expect(out[0].value).toEqual([1, 1, 100]); // b→idx1, y→idx1
    expect(out[1].value).toEqual([0, 0, 30]); // a→idx0, x→idx0
    expect(out[0].shop).toBe(data[0]);
  });

  it('无匹配层级 → 空数组', () => {
    expect(buildTierSeriesData(data, 'none_shadow', [], [])).toEqual([]);
  });

  it('空值坐标回退占位轴索引', () => {
    const out = buildTierSeriesData(
      [pt({ coop_tier: 'active', district: null, org_level_3: null, net_premium: 10 })],
      'active',
      ['未知区县'],
      ['其他']
    );
    expect(out[0].value).toEqual([0, 0, 10]);
  });
});
