/**
 * 成本分析类型定义
 * Cost Analysis Type Definitions
 */

// ==================== 维度类型（原 shared/sql/cost 导出） ====================

/** 分析维度类型 */
export type CostDimension =
  | 'customer_category'    // 客户类别
  | 'org_level_3'          // 三级机构
  | 'coverage_combination' // 险别组合
  | 'org_customer'         // 三级机构 + 客户类别（预留）
  | 'org_coverage';        // 三级机构 + 险别组合（预留）

/** 维度显示名称映射 */
export const DIMENSION_LABELS: Record<CostDimension, string> = {
  customer_category: '客户类别',
  org_level_3: '三级机构',
  coverage_combination: '险别组合',
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

// ==================== 已赚保费相关 ====================

/** 2026年12个月末选项 */
export const MONTH_END_OPTIONS: { value: string; label: string }[] = [
  { value: '2026-01-31', label: '2026年1月末' },
  { value: '2026-02-28', label: '2026年2月末' },
  { value: '2026-03-31', label: '2026年3月末' },
  { value: '2026-04-30', label: '2026年4月末' },
  { value: '2026-05-31', label: '2026年5月末' },
  { value: '2026-06-30', label: '2026年6月末' },
  { value: '2026-07-31', label: '2026年7月末' },
  { value: '2026-08-31', label: '2026年8月末' },
  { value: '2026-09-30', label: '2026年9月末' },
  { value: '2026-10-31', label: '2026年10月末' },
  { value: '2026-11-30', label: '2026年11月末' },
  { value: '2026-12-31', label: '2026年12月末' },
];

/** 保单年月选项（用于明细表筛选） */
export const POLICY_MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部月份' },
  { value: '2025-01', label: '2025年1月' },
  { value: '2025-02', label: '2025年2月' },
  { value: '2025-03', label: '2025年3月' },
  { value: '2025-04', label: '2025年4月' },
  { value: '2025-05', label: '2025年5月' },
  { value: '2025-06', label: '2025年6月' },
  { value: '2025-07', label: '2025年7月' },
  { value: '2025-08', label: '2025年8月' },
  { value: '2025-09', label: '2025年9月' },
  { value: '2025-10', label: '2025年10月' },
  { value: '2025-11', label: '2025年11月' },
  { value: '2025-12', label: '2025年12月' },
  { value: '2026-01', label: '2026年1月' },
];

/** 地区分类（用于汇总表合计） */
export type RegionType = '四川' | '同城' | '异地' | '合计';

/** 排序字段类型 */
export type SortField = 'total_earned_premium' | 'earned_ratio';

/** 排序方向 */
export type SortDirection = 'asc' | 'desc';

/** 已赚保费明细表筛选参数 */
export interface EarnedPremiumDetailFilter {
  /** 保单年月（'all' 表示全部） */
  policyMonth: string;
  /** 三级机构（'all' 表示全部合计） */
  orgLevel3: string;
}

/** 已赚保费汇总表排序状态 */
export interface EarnedPremiumSortState {
  /** 排序字段 */
  sortField: SortField;
  /** 排序方向 */
  sortDirection: SortDirection;
}

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
  comprehensive_cost_ratio: number | null;
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

// ==================== 新口径已赚保费相关类型 ====================

// ========== V3 版本 - 拆分表格（4个子表） ==========

/**
 * 2025年保单在2025年的已赚保费数据行（V3版本）
 * 按起保月统计，每月一行，共12行
 */
export interface Policy2025In2025Data {
  /** 起保月（1-12） */
  policy_month: number;
  /** 保费（起保日期口径） */
  premium: number;
  /** 首日费用（P × F × α，在起保年度计入） */
  first_day_fee: number;
  /** 25年各月当月已赚（时间分摊增量） */
  earned_2025_01: number;
  earned_2025_02: number;
  earned_2025_03: number;
  earned_2025_04: number;
  earned_2025_05: number;
  earned_2025_06: number;
  earned_2025_07: number;
  earned_2025_08: number;
  earned_2025_09: number;
  earned_2025_10: number;
  earned_2025_11: number;
  earned_2025_12: number;
  /** 25年已赚合计 = 首日费用 + 25年各月时间分摊合计 */
  earned_2025_total: number;
}

/**
 * 2025年保单在2026年的已赚保费数据行（V3版本）
 * 按起保月统计，每月一行，共12行
 */
export interface Policy2025In2026Data {
  /** 起保月（1-12） */
  policy_month: number;
  /** 26年各月当月已赚（时间分摊增量，不含首日费用） */
  earned_2026_01: number;
  earned_2026_02: number;
  earned_2026_03: number;
  earned_2026_04: number;
  earned_2026_05: number;
  earned_2026_06: number;
  earned_2026_07: number;
  earned_2026_08: number;
  earned_2026_09: number;
  earned_2026_10: number;
  earned_2026_11: number;
  earned_2026_12: number;
  /** 26年已赚合计 = 26年各月时间分摊合计 */
  earned_2026_total: number;
}

/**
 * 2026年保单在2026年的已赚保费数据行（V3版本）
 * 按起保月统计，每月一行，共12行
 */
export interface Policy2026In2026Data {
  /** 起保月（1-12） */
  policy_month: number;
  /** 保费（起保日期口径） */
  premium: number;
  /** 首日费用（P × F × α，在起保年度计入） */
  first_day_fee: number;
  /** 26年各月当月已赚（时间分摊增量） */
  earned_2026_01: number;
  earned_2026_02: number;
  earned_2026_03: number;
  earned_2026_04: number;
  earned_2026_05: number;
  earned_2026_06: number;
  earned_2026_07: number;
  earned_2026_08: number;
  earned_2026_09: number;
  earned_2026_10: number;
  earned_2026_11: number;
  earned_2026_12: number;
  /** 26年已赚合计 = 首日费用 + 26年各月时间分摊合计 */
  earned_2026_total: number;
}

/**
 * 2026年保单在2027年的已赚保费数据行（V3版本）
 * 按起保月统计，每月一行，共12行
 */
export interface Policy2026In2027Data {
  /** 起保月（1-12） */
  policy_month: number;
  /** 27年各月当月已赚（时间分摊增量，不含首日费用） */
  earned_2027_01: number;
  earned_2027_02: number;
  earned_2027_03: number;
  earned_2027_04: number;
  earned_2027_05: number;
  earned_2027_06: number;
  earned_2027_07: number;
  earned_2027_08: number;
  earned_2027_09: number;
  earned_2027_10: number;
  earned_2027_11: number;
  earned_2027_12: number;
  /** 27年已赚合计 = 27年各月时间分摊合计 */
  earned_2027_total: number;
}

/**
 * 新口径已赚保费Hook结果（V3版本）
 */
export interface NewEarnedPremiumResultV3 {
  /** 2025年保单在2025年的已赚数据 */
  policy2025In2025Data: Policy2025In2025Data[];
  /** 2025年保单在2026年的已赚数据 */
  policy2025In2026Data: Policy2025In2026Data[];
  /** 2026年保单在2026年的已赚数据 */
  policy2026In2026Data: Policy2026In2026Data[];
  /** 2026年保单在2027年的已赚数据 */
  policy2026In2027Data: Policy2026In2027Data[];
  /** 汇总数据 */
  summaryData: NewEarnedPremiumSummaryData[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}

// ========== 滚动12个月已赚保费 ==========

/**
 * 滚动12个月数据行
 * 每个统计月一行，展示该月的滚动12个月窗口数据
 */
export interface Rolling12MonthData {
  /** 统计月，格式 YYYY-MM */
  statMonth: string;
  /** 滚动12个月保费（窗口内起保保单的保费之和） */
  rollingPremium: number;
  /** 滚动12个月首日费用（窗口内起保保单的首日费用之和） */
  rollingFirstDayFee: number;
  /** 滚动12个月时间分摊（窗口内各月的时间分摊增量之和） */
  rollingTimePart: number;
  /** 滚动12个月已赚保费（首日费用 + 时间分摊） */
  rollingEarnedPremium: number;
  /** 已赚率（已赚保费 / 保费） */
  earnedRatio: number;
}

/**
 * 起保月详情数据（用于滚动计算的中间结构）
 */
export interface PolicyMonthDetail {
  /** 保单年度 */
  policyYear: number;
  /** 起保月 */
  policyMonth: number;
  /** 保费 */
  premium: number;
  /** 首日费用 */
  firstDayFee: number;
  /** 各统计月的时间分摊增量，key格式 YYYY-MM */
  earnedIncrements: Map<string, number>;
}

// ========== V2 版本（保留向后兼容） ==========

/**
 * 2025年保单已赚保费数据行
 * 按起保月统计，每月一行，共12行
 */
export interface Policy2025EarnedPremiumData {
  /** 起保月（1-12） */
  policy_month: number;
  /** 保费（起保日期口径） */
  premium: number;
  /** 截至25年末已赚保费 */
  earned_2025_12: number;
  /** 截至26年各月末已赚保费 */
  earned_2026_01: number;
  earned_2026_02: number;
  earned_2026_03: number;
  earned_2026_04: number;
  earned_2026_05: number;
  earned_2026_06: number;
  earned_2026_07: number;
  earned_2026_08: number;
  earned_2026_09: number;
  earned_2026_10: number;
  earned_2026_11: number;
  earned_2026_12: number;
  /** 验证列：13个已赚保费字段之和（应等于保费） */
  earned_total: number;
  /** 验证差异（保费 - 已赚合计） */
  validation_diff: number;
}

/**
 * 2026年保单已赚保费数据行
 * 按起保月统计，每月一行，共12行
 */
export interface Policy2026EarnedPremiumData {
  /** 起保月（1-12） */
  policy_month: number;
  /** 保费（起保日期口径） */
  premium: number;
  /** 截至26年各月末已赚保费（含首日费用率） */
  earned_2026_01: number;
  earned_2026_02: number;
  earned_2026_03: number;
  earned_2026_04: number;
  earned_2026_05: number;
  earned_2026_06: number;
  earned_2026_07: number;
  earned_2026_08: number;
  earned_2026_09: number;
  earned_2026_10: number;
  earned_2026_11: number;
  earned_2026_12: number;
  /** 截至27年各月末已赚保费 */
  earned_2027_01: number;
  earned_2027_02: number;
  earned_2027_03: number;
  earned_2027_04: number;
  earned_2027_05: number;
  earned_2027_06: number;
  earned_2027_07: number;
  earned_2027_08: number;
  earned_2027_09: number;
  earned_2027_10: number;
  earned_2027_11: number;
  earned_2027_12: number;
}

/**
 * 新口径已赚保费汇总数据行
 * 按统计年月汇总，2026年12个月末各一行
 */
export interface NewEarnedPremiumSummaryData {
  /** 统计年月（2026-01 ~ 2026-12） */
  stat_month: string;
  /** 滚动12个月保费收入（起保日期口径） */
  rolling_12m_premium: number;
  /** 2025年保单已赚保费 */
  earned_from_2025: number;
  /** 2026年保单已赚保费 */
  earned_from_2026: number;
  /** 合计已赚保费 */
  total_earned_premium: number;
  /** 已赚率 = 合计已赚保费 / 滚动12个月保费 */
  earned_ratio: number;
}

/**
 * 新口径已赚保费Hook结果
 */
export interface NewEarnedPremiumResult {
  /** 2025年保单数据 */
  policy2025Data: Policy2025EarnedPremiumData[];
  /** 2026年保单数据 */
  policy2026Data: Policy2026EarnedPremiumData[];
  /** 汇总数据 */
  summaryData: NewEarnedPremiumSummaryData[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}

// ==================== 综合费用率预测相关类型 ====================

/**
 * 月度费用数据（按起保月统计）
 * 用于计算滚动12个月费用金额
 */
export interface MonthlyExpenseData {
  /** 起保月份，格式 YYYY-MM */
  policy_month: string;
  /** 当月保费合计（起保日期口径） */
  total_premium: number;
  /** 当月费用金额合计 */
  total_fee: number;
  /** 当月税金 = 保费 × 1.6% */
  tax: number;
  /** 当月总费用 = 费用金额 + 税金 */
  total_expense: number;
}

/**
 * 综合费用率预测数据
 */
export interface ExpenseRatioForecastData {
  /** 统计月份，格式 YYYY-MM */
  stat_month: string;

  // 分母 - 已赚保费（滚动12个月）
  /** 来自2025年保单的已赚保费 */
  earned_from_2025: number;
  /** 来自2026年保单的已赚保费 */
  earned_from_2026: number;
  /** 总已赚保费 */
  total_earned_premium: number;

  // 分子 - 费用金额（延迟1个月）
  /** 费用窗口（延迟1个月） */
  expense_window_start: string;
  expense_window_end: string;
  /** 费用金额合计 */
  total_fee: number;
  /** 税金合计 = 保费 × 1.6% */
  total_tax: number;
  /** 总费用 = 费用金额 + 税金 */
  total_expense: number;

  // 分子 - 运营成本
  /** 运营成本率（%） */
  operating_cost_rate: number;
  /** 运营成本 = 已赚保费 × 运营成本率 */
  operating_cost: number;

  // 综合费用率
  /** 综合费用率（%） = (运营成本 + 总费用) / 已赚保费 × 100 */
  comprehensive_expense_ratio: number;
}

/**
 * 综合费用率预测Hook结果
 */
export interface ExpenseRatioForecastResult {
  /** 预测数据（2026年各月） */
  forecastData: ExpenseRatioForecastData[];
  /** 月度费用明细 */
  monthlyExpenseData: MonthlyExpenseData[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}
