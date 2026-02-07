/**
 * 预警检测引擎
 *
 * @module alertChecker
 * @author @claude
 * @since 2026-01-14
 */

import type {
  AlertLevel,
  AlertRule,
  AlertMessage,
  AlertSummary,
  TargetProgress,
} from '../types/alert';
import { DEFAULT_ALERT_RULES } from '../types/alert';

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 根据阈值判断预警级别
 */
function determineLevel(
  value: number,
  threshold: { warning?: number; critical?: number },
  isNegativeAlert: boolean = true
): AlertLevel | null {
  if (isNegativeAlert) {
    // 负向预警（下降类）：值越小越严重
    if (threshold.critical !== undefined && value <= threshold.critical) {
      return 'critical';
    }
    if (threshold.warning !== undefined && value <= threshold.warning) {
      return 'warning';
    }
  } else {
    // 正向预警（波动类）：值越大越严重
    if (threshold.critical !== undefined && Math.abs(value) >= threshold.critical) {
      return 'critical';
    }
    if (threshold.warning !== undefined && Math.abs(value) >= threshold.warning) {
      return 'warning';
    }
  }
  return null;
}

/**
 * 检测增长率下降预警
 */
export function checkGrowthDecline(
  currentValue: number,
  previousValue: number,
  dimension?: string,
  rules: AlertRule[] = DEFAULT_ALERT_RULES
): AlertMessage | null {
  const rule = rules.find(r => r.type === 'growth_decline' && r.enabled);
  if (!rule || previousValue === 0) return null;

  const growthRate = (currentValue - previousValue) / previousValue;
  const level = determineLevel(growthRate, rule.threshold, true);

  if (level) {
    return {
      id: generateId(),
      type: 'growth_decline',
      level,
      title: `${dimension || '整体'}增长率显著下降`,
      description: `同比增长率为 ${(growthRate * 100).toFixed(1)}%，${
        level === 'critical' ? '严重低于' : '低于'
      }预警阈值`,
      dimension,
      currentValue,
      referenceValue: previousValue,
      changeRate: growthRate,
      timestamp: new Date(),
      read: false,
      resolved: false,
    };
  }
  return null;
}

/**
 * 检测目标进度预警
 */
export function checkTargetProgress(
  progress: TargetProgress,
  rules: AlertRule[] = DEFAULT_ALERT_RULES
): AlertMessage | null {
  const rule = rules.find(r => r.type === 'target_behind' && r.enabled);
  if (!rule) return null;

  const level = determineLevel(progress.progressGap, rule.threshold, true);

  if (level) {
    return {
      id: generateId(),
      type: 'target_behind',
      level,
      title: `${progress.dimension || '整体'}目标进度落后`,
      description: `当前完成率 ${(progress.achievementRate * 100).toFixed(1)}%，时间进度 ${(progress.timeProgress * 100).toFixed(1)}%，落后 ${(Math.abs(progress.progressGap) * 100).toFixed(1)} 个百分点`,
      dimension: progress.dimension,
      currentValue: progress.current,
      referenceValue: progress.target,
      changeRate: progress.progressGap,
      timestamp: new Date(),
      read: false,
      resolved: false,
    };
  }

  // 检查目标达成
  if (progress.achievementRate >= 1.0) {
    return {
      id: generateId(),
      type: 'target_achievement',
      level: 'info',
      title: `${progress.dimension || '整体'}已完成目标`,
      description: `当前完成率 ${(progress.achievementRate * 100).toFixed(1)}%，${
        progress.achievementRate > 1 ? '超额完成' : '刚好完成'
      }目标`,
      dimension: progress.dimension,
      currentValue: progress.current,
      referenceValue: progress.target,
      changeRate: progress.achievementRate - 1,
      timestamp: new Date(),
      read: false,
      resolved: false,
    };
  }

  return null;
}

/**
 * 检测续保率下降预警
 */
export function checkRenewalRateDrop(
  currentRate: number,
  previousRate: number,
  dimension?: string,
  rules: AlertRule[] = DEFAULT_ALERT_RULES
): AlertMessage | null {
  const rule = rules.find(r => r.type === 'renewal_rate_drop' && r.enabled);
  if (!rule) return null;

  const changeRate = currentRate - previousRate;
  const level = determineLevel(changeRate, rule.threshold, true);

  if (level) {
    return {
      id: generateId(),
      type: 'renewal_rate_drop',
      level,
      title: `${dimension || '整体'}续保率下降`,
      description: `续保率从 ${(previousRate * 100).toFixed(1)}% 下降至 ${(currentRate * 100).toFixed(1)}%，下降 ${(Math.abs(changeRate) * 100).toFixed(1)} 个百分点`,
      dimension,
      currentValue: currentRate,
      referenceValue: previousRate,
      changeRate,
      timestamp: new Date(),
      read: false,
      resolved: false,
    };
  }
  return null;
}

/**
 * 检测保费异常波动预警
 */
export function checkPremiumSpike(
  currentValue: number,
  averageValue: number,
  dimension?: string,
  rules: AlertRule[] = DEFAULT_ALERT_RULES
): AlertMessage | null {
  const rule = rules.find(r => r.type === 'premium_spike' && r.enabled);
  if (!rule || averageValue === 0) return null;

  const changeRate = (currentValue - averageValue) / averageValue;
  const level = determineLevel(changeRate, rule.threshold, false); // 正向预警

  if (level) {
    return {
      id: generateId(),
      type: 'premium_spike',
      level,
      title: `${dimension || '整体'}保费异常波动`,
      description: `当前保费 ${currentValue.toLocaleString()} 元，${
        changeRate > 0 ? '高于' : '低于'
      }平均值 ${(Math.abs(changeRate) * 100).toFixed(1)}%`,
      dimension,
      currentValue,
      referenceValue: averageValue,
      changeRate,
      timestamp: new Date(),
      read: false,
      resolved: false,
    };
  }
  return null;
}

/**
 * 检测件数下降预警
 */
export function checkPolicyCountDrop(
  currentCount: number,
  previousCount: number,
  dimension?: string,
  rules: AlertRule[] = DEFAULT_ALERT_RULES
): AlertMessage | null {
  // 使用 growth_decline 规则，但类型标记为 policy_count_drop
  const rule = rules.find(r => r.type === 'growth_decline' && r.enabled);
  if (!rule || previousCount === 0) return null;

  const changeRate = (currentCount - previousCount) / previousCount;
  const level = determineLevel(changeRate, rule.threshold, true);

  if (level) {
    return {
      id: generateId(),
      type: 'policy_count_drop',
      level,
      title: `${dimension || '整体'}保单件数下降`,
      description: `保单件数从 ${previousCount} 件下降至 ${currentCount} 件，同比下降 ${(Math.abs(changeRate) * 100).toFixed(1)}%`,
      dimension,
      currentValue: currentCount,
      referenceValue: previousCount,
      changeRate,
      timestamp: new Date(),
      read: false,
      resolved: false,
    };
  }
  return null;
}

/**
 * 批量检测数据预警
 */
export interface AlertCheckData {
  /** 维度名称 */
  dimension?: string;
  /** 当期保费 */
  currentPremium?: number;
  /** 基期保费 */
  previousPremium?: number;
  /** 当期件数 */
  currentCount?: number;
  /** 基期件数 */
  previousCount?: number;
  /** 当期续保率 */
  currentRenewalRate?: number;
  /** 基期续保率 */
  previousRenewalRate?: number;
  /** 目标进度 */
  targetProgress?: TargetProgress;
  /** 保费均值（用于波动检测） */
  averagePremium?: number;
}

/**
 * 批量执行预警检测
 */
export function runAlertChecks(
  data: AlertCheckData[],
  rules: AlertRule[] = DEFAULT_ALERT_RULES
): AlertMessage[] {
  const alerts: AlertMessage[] = [];

  for (const item of data) {
    // 检测保费增长率下降
    if (item.currentPremium !== undefined && item.previousPremium !== undefined) {
      const alert = checkGrowthDecline(
        item.currentPremium,
        item.previousPremium,
        item.dimension,
        rules
      );
      if (alert) alerts.push(alert);
    }

    // 检测件数下降
    if (item.currentCount !== undefined && item.previousCount !== undefined) {
      const alert = checkPolicyCountDrop(
        item.currentCount,
        item.previousCount,
        item.dimension,
        rules
      );
      if (alert) alerts.push(alert);
    }

    // 检测续保率下降
    if (item.currentRenewalRate !== undefined && item.previousRenewalRate !== undefined) {
      const alert = checkRenewalRateDrop(
        item.currentRenewalRate,
        item.previousRenewalRate,
        item.dimension,
        rules
      );
      if (alert) alerts.push(alert);
    }

    // 检测目标进度
    if (item.targetProgress) {
      const alert = checkTargetProgress(item.targetProgress, rules);
      if (alert) alerts.push(alert);
    }

    // 检测保费异常波动
    if (item.currentPremium !== undefined && item.averagePremium !== undefined) {
      const alert = checkPremiumSpike(
        item.currentPremium,
        item.averagePremium,
        item.dimension,
        rules
      );
      if (alert) alerts.push(alert);
    }
  }

  // 按严重程度排序
  const levelOrder: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  return alerts;
}

/**
 * 计算预警摘要
 */
export function calculateAlertSummary(alerts: AlertMessage[]): AlertSummary {
  const byLevel: AlertSummary['byLevel'] = { info: 0, warning: 0, critical: 0 };
  const byType: AlertSummary['byType'] = {
    growth_decline: 0,
    target_behind: 0,
    target_achievement: 0,
    abnormal_data: 0,
    renewal_rate_drop: 0,
    premium_spike: 0,
    policy_count_drop: 0,
  };

  for (const alert of alerts) {
    byLevel[alert.level]++;
    byType[alert.type]++;
  }

  return {
    total: alerts.length,
    byLevel,
    byType,
    unread: alerts.filter(a => !a.read).length,
    lastUpdated: new Date(),
  };
}

/**
 * 计算时间进度
 * @param type 目标类型
 * @param referenceDate 参考日期（默认当前日期）
 */
export function calculateTimeProgress(
  type: 'annual' | 'monthly' | 'quarterly',
  referenceDate: Date = new Date()
): number {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();

  switch (type) {
    case 'annual': {
      // 年度进度：当前是今年的第几天 / 全年天数
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year + 1, 0, 1);
      const totalDays = (endOfYear.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24);
      const dayOfYear = Math.floor((referenceDate.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return dayOfYear / totalDays;
    }
    case 'monthly': {
      // 月度进度：当前是本月的第几天 / 本月总天数
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      return day / daysInMonth;
    }
    case 'quarterly': {
      // 季度进度：当前是本季度的第几天 / 本季度总天数
      const quarterStart = new Date(year, Math.floor(month / 3) * 3, 1);
      const quarterEnd = new Date(year, Math.floor(month / 3) * 3 + 3, 1);
      const totalDays = (quarterEnd.getTime() - quarterStart.getTime()) / (1000 * 60 * 60 * 24);
      const dayOfQuarter = Math.floor((referenceDate.getTime() - quarterStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return dayOfQuarter / totalDays;
    }
  }
}

/**
 * 创建目标进度对象
 */
export function createTargetProgress(
  type: 'annual' | 'monthly' | 'quarterly',
  target: number,
  current: number,
  dimension?: string,
  referenceDate?: Date
): TargetProgress {
  const timeProgress = calculateTimeProgress(type, referenceDate);
  const achievementRate = target > 0 ? current / target : 0;
  const progressGap = achievementRate - timeProgress;

  // 预测年底完成值（线性外推）
  let projectedValue: number | undefined;
  if (type === 'annual' && timeProgress > 0) {
    projectedValue = current / timeProgress;
  }

  return {
    type,
    target,
    current,
    achievementRate,
    timeProgress,
    progressGap,
    projectedValue,
    dimension,
  };
}
