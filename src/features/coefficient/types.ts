import type { CustomerCategoryType, RegionType } from '../../shared/config/coefficient-thresholds';
import type { PeriodType } from '../../shared/utils/coefficient-period';

export type RegionGroup = RegionType | 'province_aggregate';
export type CoefficientScenario = 'normal' | 'transfer';

export interface CoefficientRow {
  orgLevel3: string;
  regionGroup: RegionGroup;
  isNev: boolean;
  customerCategoryGroup: CustomerCategoryType;
  isNewCar: boolean | null;
  scenario: CoefficientScenario;
  dayFactor: number | null;
  weekFactor: number | null;
  monthFactor: number | null;
  yearFactor: number | null;
  threshold: number | null;
  thresholdDirection: 'gte' | 'lte' | null;
  thresholdDisplay: string;
  weekThresholdRatio: number | null;
  gapPremium: number | null;
  isCompliant: boolean | null;
  periodType: PeriodType;
  periodName: string;
  dayPremium: number;
  weekPremium: number;
  monthPremium: number;
  yearPremium: number;
  dayCount: number;
  weekCount: number;
  monthCount: number;
  yearCount: number;
  sortKey: number;
}

export interface PeriodGroupData {
  periodName: string;
  startDate: string;
  endDate: string;
  hasData: boolean;
  rows: CoefficientRow[];
}

export interface UseCoefficientMonitorOptions {
  dateField: string;
  cutoffDate: Date;
  analysisYear: number;
  enabled?: boolean;
  additionalFilterParams?: Record<string, string>;
}

export interface UseCoefficientMonitorResult {
  data: CoefficientRow[];
  periodGroups: PeriodGroupData[];
  provinceTop: CoefficientRow[];
  chengduTop: CoefficientRow[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}
