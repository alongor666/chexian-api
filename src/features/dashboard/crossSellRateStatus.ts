/**
 * 驾意险推介率状态规则（统一单一来源）
 *
 * 说明：
 * - 主全阈值：80/75/70
 * - 交三阈值：70/65/60
 * - 四象限阈值：主全 75，交三 60
 */

import { colorClasses, colors } from '../../shared/styles';

export type RateStatus = 'excellent' | 'healthy' | 'abnormal' | 'danger';
export type CrossSellRateField = 'zhuquan_rate' | 'jiaosan_rate';
export type QuadrantId =
  | 'dual_excellent'
  | 'dual_weak'
  | 'main_excellent_jiaosan_weak'
  | 'main_weak_jiaosan_excellent';

export const MAIN_FULL_THRESHOLD = 75;
export const JIAOSAN_THRESHOLD = 60;

export function getZhuquanStatus(rate: number): RateStatus {
  if (rate >= 80) return 'excellent';
  if (rate >= 75) return 'healthy';
  if (rate >= 70) return 'abnormal';
  return 'danger';
}

export function getJiaosanStatus(rate: number): RateStatus {
  if (rate >= 70) return 'excellent';
  if (rate >= 65) return 'healthy';
  if (rate >= 60) return 'abnormal';
  return 'danger';
}

export function getRateStatusLabel(status: RateStatus): string {
  const labels: Record<RateStatus, string> = {
    excellent: '优秀',
    healthy: '健康',
    abnormal: '异常',
    danger: '危险',
  };
  return labels[status];
}

export function getRateStatusClass(status: RateStatus): string {
  const classes: Record<RateStatus, string> = {
    excellent: colorClasses.text.success,
    healthy: colorClasses.text.primary,
    abnormal: colorClasses.text.warning,
    danger: colorClasses.text.danger,
  };
  return classes[status];
}

export function getRateClassByField(field: CrossSellRateField, rate: number): string {
  return field === 'zhuquan_rate'
    ? getRateStatusClass(getZhuquanStatus(rate))
    : getRateStatusClass(getJiaosanStatus(rate));
}

export function getAvgPremiumZhuquanStatus(premium: number): RateStatus {
  if (premium >= 333) return 'excellent';
  if (premium >= 300) return 'healthy';
  if (premium >= 260) return 'abnormal';
  return 'danger';
}

export function getAvgPremiumJiaosanStatus(premium: number): RateStatus {
  if (premium >= 288) return 'excellent';
  if (premium >= 200) return 'healthy';
  if (premium >= 150) return 'abnormal';
  return 'danger';
}

export function getAvgPremiumClassByCoverage(coverageKey: string, premium: number): string {
  if (coverageKey === '主全') {
    return getRateStatusClass(getAvgPremiumZhuquanStatus(premium));
  }
  if (coverageKey === '交三') {
    return getRateStatusClass(getAvgPremiumJiaosanStatus(premium));
  }
  return '';
}

export function classifyQuadrant(zhuquanRate: number, jiaosanRate: number): QuadrantId {
  if (zhuquanRate >= MAIN_FULL_THRESHOLD && jiaosanRate >= JIAOSAN_THRESHOLD) {
    return 'dual_excellent';
  }
  if (zhuquanRate < MAIN_FULL_THRESHOLD && jiaosanRate < JIAOSAN_THRESHOLD) {
    return 'dual_weak';
  }
  if (zhuquanRate >= MAIN_FULL_THRESHOLD && jiaosanRate < JIAOSAN_THRESHOLD) {
    return 'main_excellent_jiaosan_weak';
  }
  return 'main_weak_jiaosan_excellent';
}

export const QUADRANT_META: Record<QuadrantId, { label: string; color: string }> = {
  dual_excellent: {
    label: '主全优 × 交三优（双优）',
    color: colors.success.DEFAULT,
  },
  dual_weak: {
    label: '主全差 × 交三差（双差）',
    color: colors.danger.DEFAULT,
  },
  main_excellent_jiaosan_weak: {
    label: '主全优 × 交三差',
    color: colors.warning.DEFAULT,
  },
  main_weak_jiaosan_excellent: {
    label: '主全差 × 交三优',
    color: colors.warning.dark,
  },
};
