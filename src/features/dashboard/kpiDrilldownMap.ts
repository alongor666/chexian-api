/**
 * KPI 卡片跨板块跳转映射（Phase 2c）
 *
 * 每个 KPI → 对应详情板块路由 + 板块内 anchor（供目标页读取 query param）。
 * 返回 null 表示该 KPI 无跳转目标（保持静态卡片）。
 */

import type { KpiCardId } from './dashboardLayoutConfig';

export interface KpiDrilldownTarget {
  path: string;
  hint: string;
}

const KPI_DRILLDOWN_MAP: Partial<Record<KpiCardId, KpiDrilldownTarget>> = {
  // 车险业绩 → 业绩分析
  vehicle_premium: { path: '/performance-analysis?from=kpi&metric=vehicle_premium', hint: '查看车险业绩详情' },
  vehicle_achievement_rate: { path: '/performance-analysis?from=kpi&metric=achievement_rate', hint: '查看达成率详情' },
  vehicle_growth_rate: { path: '/performance-analysis?from=kpi&metric=growth_rate', hint: '查看增长率详情' },
  variable_cost_ratio: { path: '/performance-analysis?from=kpi&metric=cost_ratio', hint: '查看成本率详情' },
  quality_business_rate: { path: '/performance-analysis?from=kpi&metric=quality_business', hint: '查看优质业务详情' },
  total_premium: { path: '/performance-analysis?from=kpi&metric=total_premium', hint: '查看总保费详情' },
  policy_count: { path: '/performance-analysis?from=kpi&metric=policy_count', hint: '查看保单件数详情' },
  per_capita_premium: { path: '/performance-analysis?from=kpi&metric=per_capita_premium', hint: '查看人均保费' },
  per_vehicle_premium: { path: '/performance-analysis?from=kpi&metric=per_vehicle_premium', hint: '查看车均保费' },

  // 车驾意 → 驾意险（specialty 页 cross-sell tab）
  driver_premium: { path: '/specialty?tab=cross-sell&from=kpi&metric=driver_premium', hint: '查看车驾意详情' },
  driver_achievement_rate: { path: '/specialty?tab=cross-sell&from=kpi&metric=achievement_rate', hint: '查看达成率详情' },
  driver_growth_rate: { path: '/specialty?tab=cross-sell&from=kpi&metric=growth_rate', hint: '查看增长率详情' },

  // 续保相关 → 续保分析（specialty 页 renewal tab）
  bundle_renewal_rate: { path: '/specialty?tab=renewal&from=kpi&metric=bundle_renewal', hint: '查看套单续保详情' },
  renewal_rate: { path: '/specialty?tab=renewal&from=kpi&metric=renewal_rate', hint: '查看续保占比详情' },
};

/**
 * 获取 KPI 的跳转目标；无映射返回 null（卡片保持静态）。
 */
export function getKpiDrilldownTarget(id: KpiCardId): KpiDrilldownTarget | null {
  return KPI_DRILLDOWN_MAP[id] ?? null;
}
