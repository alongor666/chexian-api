/**
 * 成本分析共享类型与常量
 *
 * 所有成本分析生成器共用的维度定义、配置接口、映射表。
 */

// ==================== 类型定义 ====================

/** 分析维度类型 */
export type CostDimension =
  | 'customer_category' // 客户类别
  | 'org_level_3' // 三级机构
  | 'coverage_combination' // 险别组合
  | 'org_customer' // 三级机构 + 客户类别（预留）
  | 'org_coverage'; // 三级机构 + 险别组合（预留）

/** 成本分析配置 */
export interface CostAnalysisConfig {
  /** 分析维度 */
  dimension: CostDimension;
  /** 统计截止日期（用于计算满期天数） */
  cutoffDate: string;
  /** WHERE条件 */
  whereClause?: string;
}

/** 已赚保费计算配置 */
export interface EarnedPremiumConfig {
  /** 统计截止日期 */
  cutoffDate: string;
  /** WHERE条件 */
  whereClause?: string;
  /** 明细表筛选：保单年月（可选） */
  policyMonth?: string;
  /** 明细表筛选：三级机构（可选） */
  orgLevel3?: string;
}

/** 新口径已赚保费配置 */
export interface NewEarnedPremiumConfig {
  /** WHERE条件（可选） */
  whereClause?: string;
}

// ==================== 维度映射 ====================

/** 维度到SQL字段的映射 */
export const DIMENSION_FIELD_MAP: Record<CostDimension, string[]> = {
  customer_category: ['customer_category'],
  org_level_3: ['org_level_3'],
  coverage_combination: ['coverage_combination'],
  org_customer: ['org_level_3', 'customer_category'],
  org_coverage: ['org_level_3', 'coverage_combination'],
};

/** 维度显示名称映射 */
export const DIMENSION_LABELS: Record<CostDimension, string> = {
  customer_category: '客户类别',
  org_level_3: '三级机构',
  coverage_combination: '险别组合',
  org_customer: '机构+客户类别',
  org_coverage: '机构+险别组合',
};

// ==================== 辅助函数 ====================

/** 构建维度显示字段（多维度时用 || ' - ' || 连接） */
export function buildDimKeyExpr(groupByFields: string[]): string {
  return groupByFields.length === 1
    ? `COALESCE(${groupByFields[0]}, '未知')`
    : groupByFields.map((f) => `COALESCE(${f}, '未知')`).join(" || ' - ' || ");
}
