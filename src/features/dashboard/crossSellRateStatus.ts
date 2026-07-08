/**
 * 驾意险推介率状态规则（统一单一来源）
 *
 * 阈值事实源：指标注册表 server/src/config/metric-registry/categories/cross-sell.ts
 *   - cross_sell_zhuquan_rate.thresholds（80/75/70，lower_worse）
 *   - cross_sell_jiaosan_rate.thresholds（70/65/60，lower_worse）
 *
 * 前端因分层边界（.claude/rules/architecture.md 规则(c)：禁 import server/src）
 * 持有下方镜像常量，由 tests/cross-sell-rate-status.test.ts 的「注册表同步」用例
 * 锁定一致性——改阈值必须先改注册表（bump version + changelog），再同步此处镜像。
 *
 * 四象限分界：主全取 warn(75)，交三取 danger(60)。
 */

import { colorClasses, colors } from '../../shared/styles';

export type RateStatus = 'excellent' | 'healthy' | 'abnormal' | 'danger';
export type CrossSellRateField = 'zhuquan_rate' | 'jiaosan_rate';
export type QuadrantId =
  | 'dual_excellent'
  | 'dual_weak'
  | 'main_excellent_jiaosan_weak'
  | 'main_weak_jiaosan_excellent';

/** 镜像：注册表 cross_sell_zhuquan_rate.thresholds（lower_worse） */
export const ZHUQUAN_RATE_THRESHOLDS = { notice: 80, warn: 75, danger: 70 } as const;
/** 镜像：注册表 cross_sell_jiaosan_rate.thresholds（lower_worse） */
export const JIAOSAN_RATE_THRESHOLDS = { notice: 70, warn: 65, danger: 60 } as const;

export const MAIN_FULL_THRESHOLD = ZHUQUAN_RATE_THRESHOLDS.warn;
export const JIAOSAN_THRESHOLD = JIAOSAN_RATE_THRESHOLDS.danger;

/** lower_worse 四级分档（与注册表 MetricThresholds 语义一致） */
function classifyLowerWorse(
  value: number,
  thresholds: { notice: number; warn: number; danger: number }
): RateStatus {
  if (value >= thresholds.notice) return 'excellent';
  if (value >= thresholds.warn) return 'healthy';
  if (value >= thresholds.danger) return 'abnormal';
  return 'danger';
}

export function getZhuquanStatus(rate: number): RateStatus {
  return classifyLowerWorse(rate, ZHUQUAN_RATE_THRESHOLDS);
}

export function getJiaosanStatus(rate: number): RateStatus {
  return classifyLowerWorse(rate, JIAOSAN_RATE_THRESHOLDS);
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

/**
 * 驾意险单均保费阈值（元）——注册表暂无「按险别组合的驾意险单均保费」原子指标，
 * 无法挂靠 thresholds；先集中在此单一来源并显式命名，注册表化缺口已登记 BACKLOG
 * 2026-07-08-claude-fd244c。改值须同步 tests/cross-sell-rate-status.test.ts。
 */
export const ZHUQUAN_AVG_PREMIUM_THRESHOLDS = { notice: 333, warn: 300, danger: 260 } as const;
export const JIAOSAN_AVG_PREMIUM_THRESHOLDS = { notice: 288, warn: 200, danger: 150 } as const;

export function getAvgPremiumZhuquanStatus(premium: number): RateStatus {
  return classifyLowerWorse(premium, ZHUQUAN_AVG_PREMIUM_THRESHOLDS);
}

export function getAvgPremiumJiaosanStatus(premium: number): RateStatus {
  return classifyLowerWorse(premium, JIAOSAN_AVG_PREMIUM_THRESHOLDS);
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
