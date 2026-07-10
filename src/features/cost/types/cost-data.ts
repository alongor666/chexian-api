/**
 * 成本数据接口（赔付率/费用率/综合/变动/已赚保费数据行）
 * 从 costTypes.ts 拆分而来
 *
 * ⚠️ 口径标注（B304）：本文件各行的 `earned_premium` 是【时间分摊口径】满期保费
 * （满期赔付率分母，与赔款 cohort 同步，无险类系数）。与财务口径的
 * earned_premium_cum / total_earned_premium（earned-premium-basic.ts /
 * new-earned-premium.ts，含首日费用与险类系数）公式不同，禁止混用。
 * 对照表见 server/src/sql/cost/earned-premium.ts 文件头。
 */

// ==================== 数据接口 ====================

/**
 * 赔付率分析数据行
 */
export interface ClaimRatioData {
  /** 维度值（客户类别/机构/险别组合） */
  dim_key: string;
  /** 保单件数 */
  policy_count: number;
  /** 保费合计 */
  total_premium: number;
  /** 赔案件数 */
  total_claim_cases: number;
  /** 已报告赔款 */
  total_reported_claims: number;
  /** 案均赔款 */
  avg_claim_amount: number | null;
  /** 满期保费 */
  earned_premium: number;
  /** 满期天数合计 */
  total_exposure_days: number;
  /** 平均满期天数 */
  avg_exposure_days: number;
  /** 满期赔付率(%) */
  earned_claim_ratio: number | null;
  /** 满期出险率（年化，%） */
  earned_loss_frequency: number | null;
}

/**
 * 费用率分析数据行
 */
export interface ExpenseRatioData {
  /** 维度值 */
  dim_key: string;
  /** 保单件数 */
  policy_count: number;
  /** 保费合计 */
  total_premium: number;
  /** 费用金额 */
  total_fee: number;
  /** 费用率(%) */
  expense_ratio: number | null;
}

/**
 * 综合成本数据行
 */
export interface ComprehensiveCostData {
  /** 维度值 */
  dim_key: string;
  /** 保单件数 */
  policy_count: number;
  /** 保费合计 */
  total_premium: number;
  /** 已报告赔款 */
  total_reported_claims: number;
  /** 费用金额 */
  total_fee: number;
  /** 满期保费 */
  earned_premium: number;
  /** 满期赔付率(%) */
  earned_claim_ratio: number | null;
  /** 费用率(%) */
  expense_ratio: number | null;
  /** 综合费用率(%) */
  comprehensive_expense_ratio: number | null;
}

/**
 * 变动成本数据行
 */
export interface VariableCostData {
  /** 维度值 */
  dim_key: string;
  /** 保单件数 */
  policy_count: number;
  /** 保费合计 */
  total_premium: number;
  /** 满期保费 */
  earned_premium: number;
  /** 已报告赔款 */
  total_reported_claims: number;
  /** 费用金额 */
  total_fee: number;
  /** 满期赔付率(%) */
  earned_claim_ratio: number | null;
  /** 费用率(%) */
  expense_ratio: number | null;
  /** 变动成本率(%) */
  variable_cost_ratio: number | null;
}

/**
 * 变动成本率 KPI 下钻层级
 */
export type VariableCostKpiDrillLevel = 'branch' | 'org';

/**
 * 变动成本率 KPI 聚合数据
 */
export interface VariableCostKpiData {
  key: string;
  policy_count: number;
  total_premium: number;
  earned_premium: number;
  total_reported_claims: number;
  total_fee: number;
  earned_claim_ratio: number | null;
  expense_ratio: number | null;
  variable_cost_ratio: number | null;
}

/**
 * 已赚保费明细数据行（按三级机构×险类×保单年月）
 */
export interface EarnedPremiumData {
  /** 三级机构（四川/同城/异地） */
  org_level_3: string;
  /** 险类（交强险/商业保险） */
  insurance_type: string;
  /** 保单年月（YYYY-MM） */
  policy_month: string;
  /** 保单件数 */
  policy_count: number;
  /** 保费合计 */
  total_premium: number;
  /** 费用金额 */
  total_fee: number;
  /** 费用率 */
  fee_rate: number;
  /** 险类系数（交强险0.82/商业险0.94） */
  line_factor: number;
  /** 平均有效天数 */
  avg_elapsed_days: number;
  /** 首日费用部分 = P × F × α */
  first_day_part: number;
  /** 时间分摊部分 = P × (1-F) × (E/365) */
  time_part: number;
  /** 累计已赚保费 = 首日费用部分 + 时间分摊部分 */
  earned_premium_cum: number;
}

/**
 * 已赚保费汇总数据行（按三级机构分组）
 */
export interface EarnedPremiumSummaryData {
  /** 三级机构（四川/同城/异地） */
  org_level_3: string;
  /** 保单件数 */
  policy_count: number;
  /** 保费合计 */
  total_premium: number;
  /** 费用金额 */
  total_fee: number;
  /** 平均费用率 */
  avg_fee_rate: number;
  /** 首日费用部分合计 */
  total_first_day_part: number;
  /** 时间分摊部分合计 */
  total_time_part: number;
  /** 累计已赚保费合计 */
  total_earned_premium: number;
  /** 已赚保费率（已赚/原保费） */
  earned_ratio: number;
}
