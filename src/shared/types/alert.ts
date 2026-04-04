/**
 * 预警系统类型定义
 *
 * @module alert
 * @author @claude
 * @since 2026-01-14
 */

/** 预警级别 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/** 预警类型 */
export type AlertType =
  | 'growth_decline'        // 增长率下降
  | 'target_behind'         // 目标落后
  | 'target_achievement'    // 目标达成
  | 'abnormal_data'         // 数据异常
  | 'renewal_rate_drop'     // 续保率下降
  | 'premium_spike'         // 保费异常波动
  | 'policy_count_drop';    // 件数下降

/** 预警规则配置 */
export interface AlertRule {
  /** 规则ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 规则类型 */
  type: AlertType;
  /** 是否启用 */
  enabled: boolean;
  /** 阈值配置 */
  threshold: {
    /** 警告阈值 */
    warning?: number;
    /** 严重阈值 */
    critical?: number;
  };
  /** 适用范围 */
  scope?: {
    /** 机构筛选 */
    orgLevel3?: string[];
    /** 业务员筛选 */
    salesmanName?: string[];
  };
}

/** 预警消息 */
export interface AlertMessage {
  /** 消息ID */
  id: string;
  /** 预警类型 */
  type: AlertType;
  /** 预警级别 */
  level: AlertLevel;
  /** 标题 */
  title: string;
  /** 详细描述 */
  description: string;
  /** 关联维度（机构/业务员） */
  dimension?: string;
  /** 当前值 */
  currentValue?: number;
  /** 参考值（阈值/目标/同期） */
  referenceValue?: number;
  /** 变化幅度 */
  changeRate?: number;
  /** 生成时间 */
  timestamp: Date;
  /** 是否已读 */
  read: boolean;
  /** 是否已处理 */
  resolved: boolean;
}

/** 预警统计摘要 */
export interface AlertSummary {
  /** 总预警数 */
  total: number;
  /** 按级别分组 */
  byLevel: {
    info: number;
    warning: number;
    critical: number;
  };
  /** 按类型分组 */
  byType: Record<AlertType, number>;
  /** 未读数量 */
  unread: number;
  /** 最后更新时间 */
  lastUpdated: Date;
}

/** 目标完成度 */
export interface TargetProgress {
  /** 目标类型 */
  type: 'annual' | 'monthly' | 'quarterly';
  /** 目标值 */
  target: number;
  /** 当前值 */
  current: number;
  /** 完成率 */
  achievementRate: number;
  /** 时间进度（年/月/季度已过去的百分比） */
  timeProgress: number;
  /** 进度差异（完成率 - 时间进度） */
  progressGap: number;
  /** 预测年底完成值 */
  projectedValue?: number;
  /** 维度（机构/业务员） */
  dimension?: string;
}

/** 预警规则预设 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'growth_decline_yoy',
    name: '同比增长率下降',
    type: 'growth_decline',
    enabled: true,
    threshold: {
      warning: -0.1,   // 下降10%警告
      critical: -0.2,  // 下降20%严重
    },
  },
  {
    id: 'target_behind_monthly',
    name: '月度目标进度落后',
    type: 'target_behind',
    enabled: true,
    threshold: {
      warning: -0.1,   // 落后时间进度10%警告
      critical: -0.2,  // 落后时间进度20%严重
    },
  },
  {
    id: 'renewal_rate_drop',
    name: '续保率下降',
    type: 'renewal_rate_drop',
    enabled: true,
    threshold: {
      warning: -0.05,  // 下降5%警告
      critical: -0.1,  // 下降10%严重
    },
  },
  {
    id: 'premium_spike',
    name: '保费异常波动',
    type: 'premium_spike',
    enabled: true,
    threshold: {
      warning: 0.5,    // 波动50%警告
      critical: 1.0,   // 波动100%严重
    },
  },
];

/** 预警级别配置 */
export const ALERT_LEVEL_CONFIG: Record<AlertLevel, {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}> = {
  info: {
    label: '提示',
    color: 'text-primary',
    bgColor: 'bg-primary-bg',
    icon: '💡',
  },
  warning: {
    label: '警告',
    color: 'text-warning',
    bgColor: 'bg-warning-bg',
    icon: '⚠️',
  },
  critical: {
    label: '严重',
    color: 'text-danger',
    bgColor: 'bg-danger-bg',
    icon: '🚨',
  },
};

/** 预警类型配置 */
export const ALERT_TYPE_CONFIG: Record<AlertType, {
  label: string;
  description: string;
}> = {
  growth_decline: {
    label: '增长率下降',
    description: '与同期相比增长率出现显著下降',
  },
  target_behind: {
    label: '目标落后',
    description: '当前进度落后于时间进度',
  },
  target_achievement: {
    label: '目标达成',
    description: '已完成或超额完成目标',
  },
  abnormal_data: {
    label: '数据异常',
    description: '检测到异常数据波动',
  },
  renewal_rate_drop: {
    label: '续保率下降',
    description: '续保率出现显著下降',
  },
  premium_spike: {
    label: '保费波动',
    description: '保费出现异常大幅波动',
  },
  policy_count_drop: {
    label: '件数下降',
    description: '保单件数出现显著下降',
  },
};
