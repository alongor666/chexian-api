/**
 * 维修网点散点图纯逻辑（从 RepairScatter 提取）
 *
 * - buildScatterAxes：去重排序的区县轴 / 机构轴（空值回退占位）
 * - scatterSymbolSize：按净保费计算散点尺寸（sqrt 缩放后钳位 [8, 40]）
 * - buildTierSeriesData：按合作层级过滤 + 映射为散点坐标
 *
 * 行为与原组件 useMemo 内联实现逐字符一致。
 */

import type { ScatterShopPoint } from '../components/RepairScatter';

/** 从数据集提取去重排序的区县轴与机构轴；空值回退占位（未知区县 / 其他） */
export function buildScatterAxes(
  data: ScatterShopPoint[]
): { districtList: string[]; orgList: string[] } {
  const districtSet = new Set<string>();
  const orgSet = new Set<string>();
  data.forEach((p) => {
    districtSet.add(p.district ?? '未知区县');
    orgSet.add(p.org_level_3 ?? '其他');
  });
  return {
    districtList: Array.from(districtSet).sort(),
    orgList: Array.from(orgSet).sort(),
  };
}

/** 净保费 → 散点尺寸：sqrt 缩放后钳位到 [8, 40]，空值按 0 处理 */
export function scatterSymbolSize(premium: number | null | undefined): number {
  const v = premium ?? 0;
  return Math.max(8, Math.min(40, Math.sqrt(v / 10000) * 2 + 8));
}

/** 按合作层级过滤并映射为散点（坐标 = 区县/机构在轴上的索引 + 净保费） */
export function buildTierSeriesData(
  data: ScatterShopPoint[],
  tier: ScatterShopPoint['coop_tier'],
  districtList: string[],
  orgList: string[]
): Array<{ value: [number, number, number]; shop: ScatterShopPoint }> {
  return data
    .filter((p) => p.coop_tier === tier)
    .map((p) => ({
      value: [
        districtList.indexOf(p.district ?? '未知区县'),
        orgList.indexOf(p.org_level_3 ?? '其他'),
        p.net_premium,
      ],
      shop: p,
    }));
}
