import type { CustomerCategoryType, RegionType, ThresholdRule } from '../../../shared/config/coefficient-thresholds';
import {
  calculateGapPremium,
  calculateThresholdRatio,
  formatThreshold,
  isCompliant,
} from '../../../shared/config/coefficient-thresholds';
import { getOrgRegion } from '../../../shared/config/coefficient-thresholds';
import type { CoefficientRow, RegionGroup } from '../types';

/**
 * 根据截止日期计算“当前应展示的月内周期名称”（例如 1-7日 / 8-14日 / 15-21日 / 22-月末）。
 */
export function getTargetPeriodName(cutoffDate: Date): string {
  const day = cutoffDate.getDate();
  const month = cutoffDate.getMonth();
  const year = cutoffDate.getFullYear();
  const lastDay = new Date(year, month + 1, 0).getDate();

  if (day <= 7) return '1-7日';
  if (day <= 14) return '8-14日';
  if (day <= 21) return '15-21日';
  return `22-${lastDay}日`;
}

/**
 * 将展示层的机构/地域信息归一为阈值匹配所需的 RegionType。
 */
export function resolveThresholdRegion(orgLevel3: string, regionGroup: RegionGroup): RegionType {
  if (orgLevel3 === '成都' || regionGroup === 'chengdu') return 'chengdu';
  if (orgLevel3 === '全省' || regionGroup === 'province_aggregate') return 'province';
  return getOrgRegion(orgLevel3);
}

/**
 * 计算机构在表格排序中的优先级（成都 -> 全省 -> 其它）。
 */
export function getOrgSortKey(orgLevel3: string): number {
  if (orgLevel3 === '成都') return 1;
  if (orgLevel3 === '全省') return 2;
  return 3;
}

/**
 * 统一系数表的排序逻辑，保证主表与周期分表一致。
 */
export function compareCoefficientRows(a: CoefficientRow, b: CoefficientRow): number {
  if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
  if (a.orgLevel3 !== b.orgLevel3) return a.orgLevel3.localeCompare(b.orgLevel3);
  if (a.isNev !== b.isNev) return a.isNev ? -1 : 1;
  if (a.customerCategoryGroup !== b.customerCategoryGroup) {
    return a.customerCategoryGroup === 'non_commercial_personal' ? -1 : 1;
  }
  return a.isNewCar ? -1 : 1;
}

/**
 * 基于阈值规则与“当周系数/保费”，计算合规、占比与缺口保费等展示字段。
 */
export function buildThresholdFields(
  thresholdRule: ThresholdRule | null,
  weekFactor: number | null | undefined,
  weekPremium: number | null | undefined
): Pick<
  CoefficientRow,
  | 'threshold'
  | 'thresholdDirection'
  | 'thresholdDisplay'
  | 'weekThresholdRatio'
  | 'gapPremium'
  | 'isCompliant'
> {
  if (!thresholdRule) {
    return {
      threshold: null,
      thresholdDirection: null,
      thresholdDisplay: '待定',
      weekThresholdRatio: null,
      gapPremium: null,
      isCompliant: null,
    };
  }

  if (weekFactor === null || weekFactor === undefined) {
    return {
      threshold: thresholdRule.threshold,
      thresholdDirection: thresholdRule.direction,
      thresholdDisplay: formatThreshold(thresholdRule),
      weekThresholdRatio: null,
      gapPremium: null,
      isCompliant: null,
    };
  }

  return {
    threshold: thresholdRule.threshold,
    thresholdDirection: thresholdRule.direction,
    thresholdDisplay: formatThreshold(thresholdRule),
    weekThresholdRatio: calculateThresholdRatio(weekFactor, thresholdRule),
    gapPremium: calculateGapPremium(weekFactor, Number(weekPremium ?? 0), thresholdRule),
    isCompliant: isCompliant(weekFactor, thresholdRule),
  };
}

/**
 * 组装一行 CoefficientRow（适用于主表与周期分表）。
 */
export function buildCoefficientRow(params: {
  orgLevel3: string;
  regionGroup: RegionGroup;
  isNev: boolean;
  customerCategoryGroup: CustomerCategoryType;
  isNewCar: boolean | null;
  scenario: 'normal' | 'transfer';
  dayFactor: number | null;
  weekFactor: number | null;
  monthFactor: number | null;
  yearFactor: number | null;
  periodType: CoefficientRow['periodType'];
  periodName: string;
  dayPremium: number;
  weekPremium: number;
  monthPremium: number;
  yearPremium: number;
  dayCount: number;
  weekCount: number;
  monthCount: number;
  yearCount: number;
  thresholdRule: ThresholdRule | null;
}): CoefficientRow {
  const thresholdFields = buildThresholdFields(params.thresholdRule, params.weekFactor, params.weekPremium);
  return {
    orgLevel3: params.orgLevel3,
    regionGroup: params.regionGroup,
    isNev: params.isNev,
    customerCategoryGroup: params.customerCategoryGroup,
    isNewCar: params.isNewCar,
    scenario: params.scenario,
    dayFactor: params.dayFactor,
    weekFactor: params.weekFactor,
    monthFactor: params.monthFactor,
    yearFactor: params.yearFactor,
    ...thresholdFields,
    periodType: params.periodType,
    periodName: params.periodName,
    dayPremium: params.dayPremium,
    weekPremium: params.weekPremium,
    monthPremium: params.monthPremium,
    yearPremium: params.yearPremium,
    dayCount: params.dayCount,
    weekCount: params.weekCount,
    monthCount: params.monthCount,
    yearCount: params.yearCount,
    sortKey: getOrgSortKey(params.orgLevel3),
  };
}

