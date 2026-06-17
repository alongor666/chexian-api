/**
 * 维度类型定义
 * 从 costTypes.ts 拆分而来
 */

import { pickDimensionLabels } from '@/shared/config/drilldown-dimensions';

// ==================== 维度类型（原 shared/sql/cost 导出） ====================

/** 分析维度类型 */
export type CostDimension =
  | 'customer_category'    // 客户类别
  | 'org_level_3'          // 三级机构
  | 'coverage_combination' // 险别组合
  | 'org_customer'         // 三级机构 + 客户类别（预留）
  | 'org_coverage';        // 三级机构 + 险别组合（预留）

/** 维度显示名称映射 — 原子维度派生自 SSOT（shared/config/drilldown-dimensions），组合维度为本板块专属、保留本地定义 */
export const DIMENSION_LABELS: Record<CostDimension, string> = {
  ...pickDimensionLabels(['customer_category', 'org_level_3', 'coverage_combination'] as const),
  org_customer: '机构+客户类别',
  org_coverage: '机构+险别组合',
};

// ==================== 子Tab类型 ====================

/** 成本分析子标签页 */
export type CostSubTab = 'variable' | 'claim' | 'expense' | 'comprehensive' | 'earned' | 'earned-new' | 'expense-forecast';

/** 子Tab配置 */
export const COST_SUB_TAB_CONFIG: Record<
  CostSubTab,
  { label: string; enabled: boolean }
> = {
  variable: { label: '变动成本率', enabled: true },
  claim: { label: '赔付率', enabled: true },
  expense: { label: '费用率', enabled: true },
  comprehensive: { label: '综合费用率', enabled: true },
  earned: { label: '已赚保费', enabled: true },
  'earned-new': { label: '新口径已赚保费', enabled: true },
  'expense-forecast': { label: '综合费用率预测', enabled: true },
};
