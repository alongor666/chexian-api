/**
 * Hook 结果与控制面板 Props 类型
 * 从 costTypes.ts 拆分而来
 */

import type { CostDimension, CostSubTab } from './dimensions';

// ==================== Hook结果类型 ====================

/**
 * 成本分析Hook结果
 */
export interface CostAnalysisResult<T> {
  /** 数据列表 */
  data: T[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 汇总统计 */
  summary: CostSummary;
}

/**
 * 成本分析汇总
 */
export interface CostSummary {
  /** 总保费 */
  totalPremium: number;
  /** 总赔款 */
  totalClaims: number;
  /** 总费用 */
  totalFee: number;
  /** 保单件数 */
  policyCount: number;
  /** 平均赔付率 */
  avgClaimRatio: number | null;
  /** 平均费用率 */
  avgExpenseRatio: number | null;
}

// ==================== 控制面板Props ====================

/**
 * 控制面板Props
 */
export interface CostAnalysisControlPanelProps {
  /** 当前子标签页 */
  activeSubTab: CostSubTab;
  /** 子Tab切换回调 */
  onSubTabChange: (tab: CostSubTab) => void;
  /** 当前分析维度 */
  dimension: CostDimension;
  /** 维度切换回调 */
  onDimensionChange: (dim: CostDimension) => void;
  /** 统计截止日期 */
  cutoffDate: string;
  /** 截止日期变更回调 */
  onCutoffDateChange: (date: string) => void;
  /** 已赚保费：月末下拉选项（可选，默认使用内置选项） */
  monthEndOptions?: { value: string; label: string }[];
}
