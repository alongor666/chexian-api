/**
 * 维修网点 KPI 纯逻辑（从 RepairPage 提取）
 *
 * - buildRepairParams：筛选条件 → API 查询参数（条件包含）
 * - findTierRow：按合作层级查找行（未命中补零缺省）
 * - computeToPremiumTotals：核损/保费汇总 + 整体核损保费比（除零回退 null）
 *
 * 行为与原组件内联实现逐字符一致。
 */

export type TimeWindow = 'ytd' | 'rolling12' | 'all';
export type CoopTierFilter = '' | 'active' | 'past' | 'none';

export interface CoopTierRow {
  coop_tier: 'active' | 'past' | 'none' | 'none_shadow';
  shop_count: number;
  damage_amount: number;
  net_premium: number;
}

/** findTierRow 返回值形状：合作层级汇总三字段 */
export type TierTotals = Pick<CoopTierRow, 'shop_count' | 'damage_amount' | 'net_premium'>;

/** 筛选条件 → API 查询参数：timeWindow 必带，orgFilter / coopTier 非空才带 */
export function buildRepairParams(
  orgFilter: string,
  timeWindow: TimeWindow,
  coopTier: CoopTierFilter
): Record<string, string> {
  const p: Record<string, string> = { timeWindow };
  if (orgFilter) p.orgName = orgFilter;
  if (coopTier) p.coopTier = coopTier;
  return p;
}

/** 按合作层级查找行；未命中返回补零缺省 */
export function findTierRow(rows: CoopTierRow[], tier: string): TierTotals {
  return (
    rows.find((r) => r.coop_tier === tier) ?? {
      shop_count: 0,
      damage_amount: 0,
      net_premium: 0,
    }
  );
}

/** 核损金额 / 净保费汇总 + 整体核损保费比（净保费为 0 时回退 null，避免除零） */
export function computeToPremiumTotals(
  rows: Array<{ damage_amount?: number; net_premium?: number }>
): { totalDamage: number; totalPremium: number; overallRatio: number | null } {
  const totalDamage = rows.reduce((s, r) => s + (r.damage_amount ?? 0), 0);
  const totalPremium = rows.reduce((s, r) => s + (r.net_premium ?? 0), 0);
  const overallRatio = totalPremium > 0 ? totalDamage / totalPremium : null;
  return { totalDamage, totalPremium, overallRatio };
}
