/**
 * 费用分析类型定义
 * Fee Analysis Types
 */

/** 单条费率分档数据（来自后端） */
export interface FeeRuleTierData {
  fee_rule_id: string;
  fee_rule_name: string;
  insurance_type_label: string;  // '交强险' | '商业险' | '其他'
  fee_rate: number | null;       // null = 规则外
  effective_start: string | null; // 'YYYY-MM-DD'
  effective_end: string | null;   // null = 当前仍生效
  policy_count: number;
  total_premium: number;          // 元
  expected_fee: number | null;    // 元，null = 规则外不计费
  performance_fee: number;        // 元，保费×1%
}

/** 汇总 KPI */
export interface FeeAnalysisSummary {
  total_policy_count: number;
  total_premium: number;          // 元（含规则外）
  matched_premium: number;        // 元（规则内）
  total_expected_fee: number;     // 元（规则内合计）
  total_performance_fee: number;  // 元（全部合计）
  weighted_avg_fee_rate: number;  // 加权平均费率（规则内）
  out_of_scope_count: number;     // 规则外件数
  out_of_scope_premium: number;   // 规则外保费
}

/** 险类 Tab 筛选 */
export type FeeInsuranceTypeTab = 'all' | 'cti' | 'com';
