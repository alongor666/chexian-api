/**
 * React Query Key Factory
 *
 * 集中管理所有 query key，确保缓存命中的一致性。
 * 约定：每个 key 都是 readonly tuple，filters 对象作为末尾参数。
 */

export const queryKeys = {
  // ── 仪表盘 ──
  dashboardBundle: (params: Record<string, unknown>) =>
    ['dashboard-bundle', params] as const,

  kpi: (params: Record<string, string>) =>
    ['kpi', params] as const,

  kpiDetail: (params: Record<string, string>) =>
    ['kpi-detail', params] as const,

  trend: (granularity: string, params: Record<string, string>) =>
    ['trend', granularity, params] as const,

  qualityBusinessTrend: (granularity: string, params: Record<string, string>) =>
    ['quality-business-trend', granularity, params] as const,

  salesmanRanking: (limit: number, params: Record<string, string>) =>
    ['salesman-ranking', limit, params] as const,

  // ── 业绩分析 ──
  performanceBundle: (params: Record<string, unknown>) =>
    ['performance-bundle', params] as const,

  // ── 交叉销售 ──
  crossSellBundle: (params: Record<string, unknown>) =>
    ['cross-sell-bundle', params] as const,

  crossSellAnalysis: (params: Record<string, unknown>) =>
    ['cross-sell-analysis', params] as const,

  crossSellTimePeriod: (params: Record<string, string>) =>
    ['cross-sell-time-period', params] as const,

  crossSellTrend: (params: Record<string, string>) =>
    ['cross-sell-trend', params] as const,

  crossSellTopSalesman: (params: Record<string, string>) =>
    ['cross-sell-top-salesman', params] as const,

  crossSellOrgTrend: (params: Record<string, string>) =>
    ['cross-sell-org-trend', params] as const,

  crossSellHeatmap: (params: Record<string, string>) =>
    ['cross-sell-heatmap', params] as const,

  // ── 续保 ──
  renewalAnalysis: (params: Record<string, unknown>) =>
    ['renewal-analysis', params] as const,

  renewalDrilldown: (params: Record<string, unknown>) =>
    ['renewal-drilldown', params] as const,

  // ── 假日营销 ──
  holidayDrilldown: (params: Record<string, unknown>) =>
    ['holiday-drilldown', params] as const,

  // ── 货车 ──
  truckAnalysis: (params: Record<string, unknown>) =>
    ['truck-analysis', params] as const,

  // ── 系数监控 ──
  coefficient: (params: Record<string, unknown>) =>
    ['coefficient', params] as const,

  // ── 综合分析 ──
  comprehensiveBundle: (params: Record<string, unknown>) =>
    ['comprehensive-bundle', params] as const,

  // ── 筛选器 ──
  filterOptions: () => ['filter-options'] as const,
} as const;
