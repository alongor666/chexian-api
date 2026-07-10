/**
 * 新口径已赚保费类型（相对年契约）
 *
 * 后端 /api/query/cost?type=earned-new 返回「保单年度 × 已赚年度」四象限矩阵，
 * 行字段为相对年 key（earned_01..earned_12 / earned_total），行所属绝对年份
 * 由响应元数据 anchorYear（锚定年 Y）推导：
 * - policyPrevInPrev：Y-1 年保单在 Y-1 年的已赚（含 premium / first_day_fee）
 * - policyPrevInCurr：Y-1 年保单在 Y 年的已赚（仅时间分摊增量）
 * - policyCurrInCurr：Y 年保单在 Y 年的已赚（含 premium / first_day_fee）
 * - policyCurrInNext：Y 年保单在 Y+1 年的已赚（仅时间分摊增量）
 */

// ==================== 相对年月度已赚行 ====================

/**
 * 跨年已赚行：某保单年度在「单个已赚年度」的 12 个月当月已赚（时间分摊增量）
 */
export interface CrossYearEarnedRow {
  /** 起保月（1-12） */
  policy_month: number;
  /** 该已赚年度各月当月已赚（earned_01..earned_12） */
  earned_01: number;
  earned_02: number;
  earned_03: number;
  earned_04: number;
  earned_05: number;
  earned_06: number;
  earned_07: number;
  earned_08: number;
  earned_09: number;
  earned_10: number;
  earned_11: number;
  earned_12: number;
  /** 该已赚年度合计 */
  earned_total: number;
}

/**
 * 同年已赚行：保单年度 == 已赚年度，额外含保费与首日费用
 */
export interface SameYearEarnedRow extends CrossYearEarnedRow {
  /** 保费（起保日期口径） */
  premium: number;
  /** 首日费用（P × F × α，在起保年度计入） */
  first_day_fee: number;
}

/** 取某月的相对年已赚字段值（m 为 1-12） */
export function getEarnedMonthValue(row: CrossYearEarnedRow, m: number): number {
  const key = `earned_${String(m).padStart(2, '0')}` as keyof CrossYearEarnedRow;
  return (row[key] as number) || 0;
}

/**
 * 新口径已赚保费Hook结果（四象限矩阵 + 锚定年）
 */
export interface NewEarnedPremiumResultV3 {
  /** 锚定年 Y（后端解析，缺省回退当前年） */
  anchorYear: number;
  /** Y-1 年保单在 Y-1 年的已赚数据 */
  policyPrevInPrevData: SameYearEarnedRow[];
  /** Y-1 年保单在 Y 年的已赚数据 */
  policyPrevInCurrData: CrossYearEarnedRow[];
  /** Y 年保单在 Y 年的已赚数据 */
  policyCurrInCurrData: SameYearEarnedRow[];
  /** Y 年保单在 Y+1 年的已赚数据 */
  policyCurrInNextData: CrossYearEarnedRow[];
  /** 汇总数据 */
  summaryData: NewEarnedPremiumSummaryData[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}

// ==================== 滚动12个月汇总 ====================

/**
 * 新口径已赚保费汇总数据行
 * 按统计年月汇总，锚定年 Y 的 12 个月末各一行
 */
export interface NewEarnedPremiumSummaryData {
  /** 统计年月（Y-01 ~ Y-12） */
  stat_month: string;
  /** 滚动12个月保费收入（起保日期口径） */
  rolling_12m_premium: number;
  /** 上一保单年度（Y-1）保单已赚保费 */
  earned_from_prev: number;
  /** 锚定年（Y）保单已赚保费 */
  earned_from_curr: number;
  /** 合计已赚保费 */
  total_earned_premium: number;
  /** 已赚率 = 合计已赚保费 / 滚动12个月保费 */
  earned_ratio: number;
}
