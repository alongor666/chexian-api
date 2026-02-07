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

export type KpiCardId =
  | 'total_premium'
  | 'policy_count'
  | 'per_capita_premium'
  | 'non_transfer_rate'
  | 'renewal_rate'
  | 'commercial_rate'
  | 'telesales_rate'
  | 'nev_rate'
  | 'new_car_rate';

export const KPI_CARD_META: Array<{ id: KpiCardId; label: string }> = [
  { id: 'total_premium', label: '总保费' },
  { id: 'policy_count', label: '保单件数' },
  { id: 'per_capita_premium', label: '人均保费' },
  { id: 'non_transfer_rate', label: '非过户占比' },
  { id: 'renewal_rate', label: '续保占比' },
  { id: 'commercial_rate', label: '商业险占比' },
  { id: 'telesales_rate', label: '电销占比' },
  { id: 'nev_rate', label: '新能源占比' },
  { id: 'new_car_rate', label: '新车占比' },
];

export const DEFAULT_KPI_ORDER: KpiCardId[] = KPI_CARD_META.map((item) => item.id);
