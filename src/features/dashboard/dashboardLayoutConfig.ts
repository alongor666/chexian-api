export type DashboardSectionId = 'kpi' | 'rose' | 'trend' | 'table';

export const DASHBOARD_SECTION_META: Array<{ id: DashboardSectionId; label: string }> = [
  { id: 'kpi', label: 'KPI指标' },
  { id: 'rose', label: '占比分析' },
  { id: 'trend', label: '趋势分析' },
  { id: 'table', label: '业务员明细' },
];

export const DEFAULT_SECTION_ORDER: DashboardSectionId[] = DASHBOARD_SECTION_META.map(
  (item) => item.id
);

export type KpiGroup = 'core' | 'focus';

export type KpiCardId =
  | 'vehicle_premium'
  | 'vehicle_achievement_rate'
  | 'vehicle_growth_rate'
  | 'variable_cost_rate'
  | 'bundle_renewal_rate'
  | 'driver_premium'
  | 'driver_achievement_rate'
  | 'driver_growth_rate'
  | 'total_premium'
  | 'policy_count'
  | 'per_capita_premium'
  | 'non_transfer_rate'
  | 'renewal_rate'
  | 'commercial_rate'
  | 'telesales_rate'
  | 'nev_rate'
  | 'new_car_rate';

export const KPI_CARD_META: Array<{ id: KpiCardId; label: string; group: KpiGroup }> = [
  { id: 'vehicle_premium', label: '车险保费', group: 'core' },
  { id: 'vehicle_achievement_rate', label: '车险达成率', group: 'core' },
  { id: 'vehicle_growth_rate', label: '车险增长率', group: 'core' },
  { id: 'variable_cost_rate', label: '变动成本率', group: 'core' },
  { id: 'bundle_renewal_rate', label: '套单续保率', group: 'core' },
  { id: 'driver_premium', label: '车驾意保费', group: 'core' },
  { id: 'driver_achievement_rate', label: '车驾意达成率', group: 'core' },
  { id: 'driver_growth_rate', label: '车驾意增长率', group: 'core' },
  { id: 'total_premium', label: '总保费', group: 'focus' },
  { id: 'policy_count', label: '保单件数', group: 'focus' },
  { id: 'per_capita_premium', label: '人均保费', group: 'focus' },
  { id: 'non_transfer_rate', label: '非过户占比', group: 'focus' },
  { id: 'renewal_rate', label: '续保占比', group: 'focus' },
  { id: 'commercial_rate', label: '商业险占比', group: 'focus' },
  { id: 'telesales_rate', label: '电销占比', group: 'focus' },
  { id: 'nev_rate', label: '新能源占比', group: 'focus' },
  { id: 'new_car_rate', label: '新车占比', group: 'focus' },
];

export const DEFAULT_KPI_ORDER: Record<KpiGroup, KpiCardId[]> = {
  core: KPI_CARD_META.filter((item) => item.group === 'core').map((item) => item.id),
  focus: KPI_CARD_META.filter((item) => item.group === 'focus').map((item) => item.id),
};
