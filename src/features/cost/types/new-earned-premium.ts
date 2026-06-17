/**
 * 新口径已赚保费类型（V3 + V2 兼容 + 滚动 12 月）
 * 从 costTypes.ts 拆分而来
 */

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
