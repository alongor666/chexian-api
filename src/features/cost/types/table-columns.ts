/**
 * 表格列配置类型与 6 个 *_COLUMNS 常量
 * 从 costTypes.ts 拆分而来
 */

import type {
  ClaimRatioData,
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  EarnedPremiumData,
  EarnedPremiumSummaryData,
} from './cost-data';

// ==================== 表格列配置 ====================

/**
 * VirtualTable 列配置类型
 */
export interface TableColumn<T> {
  key: keyof T & string;
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  format?: (value: T[keyof T]) => string;
}

/**
 * 赔付率表格列配置
 */
export const CLAIM_RATIO_COLUMNS: TableColumn<ClaimRatioData>[] = [
  { key: 'dim_key', header: '维度', width: 150, align: 'left' },
  { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
  { key: 'total_premium', header: '保费合计', width: 120, align: 'right' },
  { key: 'total_claim_cases', header: '赔案件数', width: 100, align: 'right' },
  {
    key: 'total_reported_claims',
    header: '已报告赔款',
    width: 120,
    align: 'right',
  },
  { key: 'avg_claim_amount', header: '案均赔款', width: 100, align: 'right' },
  { key: 'earned_premium', header: '满期保费', width: 120, align: 'right' },
  {
    key: 'avg_exposure_days',
    header: '平均满期天数',
    width: 110,
    align: 'right',
  },
  {
    key: 'earned_claim_ratio',
    header: '满期赔付率(%)',
    width: 110,
    align: 'right',
  },
  {
    key: 'earned_loss_frequency',
    header: '满期出险率(%)',
    width: 110,
    align: 'right',
  },
];

/**
 * 费用率表格列配置
 */
export const EXPENSE_RATIO_COLUMNS: TableColumn<ExpenseRatioData>[] = [
  { key: 'dim_key', header: '维度', width: 150, align: 'left' },
  { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
  { key: 'total_premium', header: '保费合计', width: 120, align: 'right' },
  { key: 'total_fee', header: '费用金额', width: 120, align: 'right' },
  { key: 'expense_ratio', header: '费用率(%)', width: 100, align: 'right' },
];

/**
 * 综合成本表格列配置
 */
export const COMPREHENSIVE_COST_COLUMNS: TableColumn<ComprehensiveCostData>[] =
  [
    { key: 'dim_key', header: '维度', width: 150, align: 'left' },
    { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
    { key: 'total_premium', header: '保费合计', width: 120, align: 'right' },
    { key: 'earned_premium', header: '满期保费', width: 120, align: 'right' },
    {
      key: 'total_reported_claims',
      header: '已报告赔款',
      width: 120,
      align: 'right',
    },
    { key: 'total_fee', header: '费用金额', width: 100, align: 'right' },
    {
      key: 'earned_claim_ratio',
      header: '赔付率(%)',
      width: 100,
      align: 'right',
    },
    { key: 'expense_ratio', header: '费用率(%)', width: 100, align: 'right' },
    {
      key: 'comprehensive_cost_ratio',
      header: '综合费用率(%)',
      width: 120,
      align: 'right',
    },
  ];

/**
 * 变动成本表格列配置
 */
export const VARIABLE_COST_COLUMNS: TableColumn<VariableCostData>[] = [
  { key: 'dim_key', header: '维度', width: 150, align: 'left' },
  { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
  { key: 'total_premium', header: '保费合计', width: 120, align: 'right' },
  { key: 'earned_premium', header: '满期保费', width: 120, align: 'right' },
  {
    key: 'total_reported_claims',
    header: '已报告赔款',
    width: 120,
    align: 'right',
  },
  { key: 'total_fee', header: '费用金额', width: 100, align: 'right' },
  {
    key: 'earned_claim_ratio',
    header: '赔付率(%)',
    width: 100,
    align: 'right',
  },
  { key: 'expense_ratio', header: '费用率(%)', width: 100, align: 'right' },
  {
    key: 'variable_cost_ratio',
    header: '变动成本率(%)',
    width: 120,
    align: 'right',
  },
];

/**
 * 已赚保费明细表格列配置
 */
export const EARNED_PREMIUM_COLUMNS: TableColumn<EarnedPremiumData>[] = [
  { key: 'org_level_3', header: '三级机构', width: 100, align: 'left' },
  { key: 'insurance_type', header: '险类', width: 80, align: 'left' },
  { key: 'policy_month', header: '保单年月', width: 100, align: 'center' },
  { key: 'policy_count', header: '保单件数', width: 90, align: 'right' },
  { key: 'total_premium', header: '保费合计', width: 120, align: 'right' },
  { key: 'total_fee', header: '费用金额', width: 100, align: 'right' },
  { key: 'fee_rate', header: '费用率(%)', width: 90, align: 'right' },
  { key: 'line_factor', header: '险类系数', width: 80, align: 'right' },
  { key: 'avg_elapsed_days', header: '平均有效天数', width: 100, align: 'right' },
  { key: 'first_day_part', header: '首日费用部分', width: 120, align: 'right' },
  { key: 'time_part', header: '时间分摊部分', width: 120, align: 'right' },
  { key: 'earned_premium_cum', header: '累计已赚保费', width: 120, align: 'right' },
];

/**
 * 已赚保费汇总表格列配置
 */
export const EARNED_PREMIUM_SUMMARY_COLUMNS: TableColumn<EarnedPremiumSummaryData>[] = [
  { key: 'org_level_3', header: '三级机构', width: 100, align: 'left' },
  { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
  { key: 'total_premium', header: '保费合计', width: 130, align: 'right' },
  { key: 'total_fee', header: '费用金额', width: 120, align: 'right' },
  { key: 'avg_fee_rate', header: '平均费用率(%)', width: 110, align: 'right' },
  { key: 'total_first_day_part', header: '首日费用部分', width: 130, align: 'right' },
  { key: 'total_time_part', header: '时间分摊部分', width: 130, align: 'right' },
  { key: 'total_earned_premium', header: '累计已赚保费', width: 130, align: 'right' },
  { key: 'earned_ratio', header: '已赚保费率(%)', width: 110, align: 'right' },
];
