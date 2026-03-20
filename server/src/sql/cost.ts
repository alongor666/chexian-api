/**
 * 成本分析SQL生成器
 * Cost Analysis SQL Generators
 *
 * 支持多种成本率计算：
 * - 满期赔付率：已报告赔款 / 满期保费
 * - 满期出险率：(赔案件数/保单件数) / (满期天数/365) → 年化
 * - 案均赔款：已报告赔款 / 赔案件数
 * - 费用率：费用金额 / 保费
 * - 综合费用率：(赔款 + 费用) / 满期保费
 *
 * 业务规则：
 * - 车险有效期固定为1年（365天）
 * - 满期天数 = MIN(统计截止日 - 保险起期, 365)
 * - 保险止期 = 保险起期 + 365天
 */

import { formatDate } from '../utils/coefficient-period.js';
import {
  buildDimKeyExpression,
  buildPolicyExposureCTE,
  buildEarnedPremiumCase,
  getMonthEndDate,
  generateEarnedPremiumPeriodQuery,
  type EarnedPremiumPeriodConfig,
} from './sql-builder.js';

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

/** 维度到SQL字段的映射 */
const DIMENSION_FIELD_MAP: Record<CostDimension, string[]> = {
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

// ==================== 核心SQL生成函数 ====================

/**
 * 生成赔付率分析SQL
 *
 * 计算指标：
 * - 保单件数 = COUNT(DISTINCT policy_no)
 * - 保费合计 = SUM(premium)
 * - 赔案件数 = SUM(claim_cases)
 * - 已报告赔款 = SUM(reported_claims)
 * - 案均赔款 = 已报告赔款 / 赔案件数
 * - 满期保费 = SUM(保费 / 365 * 满期天数)
 * - 满期赔付率 = 已报告赔款 / 满期保费
 * - 满期出险率 = (赔案件数 * 365) / 满期天数合计 (年化)
 *
 * @param config - 成本分析配置
 * @returns SQL查询字符串
 */
export function generateClaimRatioQuery(config: CostAnalysisConfig): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');

  // 构建维度显示字段（多维度时用 || ' - ' || 连接）
  const dimKeyExpression =
    groupByFields.length === 1
      ? `COALESCE(${groupByFields[0]}, '未知')`
      : groupByFields.map((f) => `COALESCE(${f}, '未知')`).join(" || ' - ' || ");

  return `
WITH policy_exposure AS (
  SELECT
    policy_no,
    ${groupByFields.map((f) => `${f}`).join(', ')},
    premium,
    insurance_start_date AS start_date,
    -- 满期天数：MIN(统计截止日 - 保险起期, 365)，最小为0
    LEAST(
      GREATEST(
        DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${cutoffDate}'),
        0
      ),
      365
    ) AS exposure_days,
    COALESCE(claim_cases, 0) AS claim_cases,
    COALESCE(reported_claims, 0) AS reported_claims
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
)
SELECT
  ${dimKeyExpression} AS dim_key,
  -- 基础指标（显式转换BigInt为DOUBLE避免JS类型混合错误）
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  CAST(SUM(claim_cases) AS INTEGER) AS total_claim_cases,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,

  -- 案均赔款 = 已报告赔款 / 赔案件数
  CASE
    WHEN SUM(claim_cases) > 0
    THEN ROUND(SUM(reported_claims) / CAST(SUM(claim_cases) AS DOUBLE), 2)
    ELSE NULL
  END AS avg_claim_amount,

  -- 满期保费 = SUM(保费 / 365 * 满期天数)
  ROUND(SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2) AS earned_premium,

  -- 满期天数合计
  CAST(SUM(exposure_days) AS INTEGER) AS total_exposure_days,

  -- 平均满期天数
  ROUND(AVG(CAST(exposure_days AS DOUBLE)), 1) AS avg_exposure_days,

  -- 满期赔付率 = 已报告赔款 / 满期保费
  CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0
    THEN ROUND(SUM(reported_claims) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2)
    ELSE NULL
  END AS earned_claim_ratio,

  -- 满期出险率（年化）= 赔案件数 * 365 / 满期天数合计 * 100
  -- 公式来源：(赔案件数/保单件数) / (满期天数/365) = 赔案件数 * 365 / (保单件数 * 平均满期天数)
  CASE
    WHEN SUM(exposure_days) > 0
    THEN ROUND(CAST(SUM(claim_cases) AS DOUBLE) * 365.0 * 100.0 / CAST(SUM(exposure_days) AS DOUBLE), 2)
    ELSE NULL
  END AS earned_loss_frequency

FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

/**
 * 生成费用率分析SQL
 *
 * 计算指标：
 * - 费用率 = 费用金额 / 保费 * 100%
 *
 * @param config - 成本分析配置
 * @returns SQL查询字符串
 */
export function generateExpenseRatioQuery(config: CostAnalysisConfig): string {
  const { dimension, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');

  const dimKeyExpression =
    groupByFields.length === 1
      ? `COALESCE(${groupByFields[0]}, '未知')`
      : groupByFields.map((f) => `COALESCE(${f}, '未知')`).join(" || ' - ' || ");

  return `
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS total_fee,

  -- 费用率 = 费用金额 / 保费 * 100%
  CASE
    WHEN SUM(premium) > 0
    THEN ROUND(SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium), 2)
    ELSE NULL
  END AS expense_ratio

FROM PolicyFact
WHERE ${whereClause}
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

/**
 * 生成综合费用率分析SQL
 *
 * 计算指标：
 * - 综合费用率 = (赔款 + 费用) / 满期保费 * 100%
 *
 * @param config - 成本分析配置
 * @returns SQL查询字符串
 */
export function generateComprehensiveCostQuery(
  config: CostAnalysisConfig
): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');

  const dimKeyExpression =
    groupByFields.length === 1
      ? `COALESCE(${groupByFields[0]}, '未知')`
      : groupByFields.map((f) => `COALESCE(${f}, '未知')`).join(" || ' - ' || ");

  return `
WITH policy_exposure AS (
  SELECT
    policy_no,
    ${groupByFields.map((f) => `${f}`).join(', ')},
    premium,
    insurance_start_date AS start_date,
    LEAST(
      GREATEST(
        DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${cutoffDate}'),
        0
      ),
      365
    ) AS exposure_days,
    COALESCE(claim_cases, 0) AS claim_cases,
    COALESCE(reported_claims, 0) AS reported_claims,
    COALESCE(fee_amount, 0) AS fee_amount
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
)
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ROUND(SUM(fee_amount), 2) AS total_fee,
  ROUND(SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2) AS earned_premium,

  -- 满期赔付率
  CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0
    THEN ROUND(SUM(reported_claims) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2)
    ELSE NULL
  END AS earned_claim_ratio,

  -- 费用率
  CASE
    WHEN SUM(premium) > 0
    THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2)
    ELSE NULL
  END AS expense_ratio,

  -- 综合费用率 = (赔款 + 费用) / 满期保费 * 100%
  CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0
    THEN ROUND((SUM(reported_claims) + SUM(fee_amount)) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2)
    ELSE NULL
  END AS comprehensive_cost_ratio

FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

/**
 * 生成变动成本率分析SQL
 *
 * 变动成本率 = 赔付率 + 费用率（简化定义）
 *
 * @param config - 成本分析配置
 * @returns SQL查询字符串
 */
export function generateVariableCostQuery(config: CostAnalysisConfig): string {
  const { dimension, cutoffDate, whereClause = '1=1' } = config;
  const groupByFields = DIMENSION_FIELD_MAP[dimension];
  const groupByClause = groupByFields.join(', ');

  const dimKeyExpression =
    groupByFields.length === 1
      ? `COALESCE(${groupByFields[0]}, '未知')`
      : groupByFields.map((f) => `COALESCE(${f}, '未知')`).join(" || ' - ' || ");

  return `
WITH policy_exposure AS (
  SELECT
    policy_no,
    ${groupByFields.map((f) => `${f}`).join(', ')},
    premium,
    LEAST(
      GREATEST(
        DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${cutoffDate}'),
        0
      ),
      365
    ) AS exposure_days,
    COALESCE(reported_claims, 0) AS reported_claims,
    COALESCE(fee_amount, 0) AS fee_amount
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
)
SELECT
  ${dimKeyExpression} AS dim_key,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2) AS earned_premium,
  ROUND(SUM(reported_claims), 2) AS total_reported_claims,
  ROUND(SUM(fee_amount), 2) AS total_fee,

  -- 满期赔付率
  CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0
    THEN ROUND(SUM(reported_claims) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0), 2)
    ELSE NULL
  END AS earned_claim_ratio,

  -- 费用率
  CASE
    WHEN SUM(premium) > 0
    THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2)
    ELSE NULL
  END AS expense_ratio,

  -- 变动成本率 = 赔付率 + 费用率
  CASE
    WHEN SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(reported_claims) * 100.0 / SUM(premium * CAST(exposure_days AS DOUBLE) / 365.0) +
      SUM(fee_amount) * 100.0 / SUM(premium),
      2
    )
    ELSE NULL
  END AS variable_cost_ratio

FROM policy_exposure
GROUP BY ${groupByClause}
ORDER BY SUM(premium) DESC
  `.trim();
}

// ==================== 已赚保费计算SQL ====================

/**
 * 已赚保费计算配置
 */
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

/**
 * 计算滚动12个月窗口的起始日期
 * 窗口 = [统计日 - 364天, 统计日]（共365天）
 */
export function getRolling12MonthWindowStart(cutoffDate: string): string {
  const [year, month, day] = cutoffDate.split('-').map((v) => Number(v));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 364);
  return formatDate(date);
}

/**
 * 生成已赚保费明细查询SQL（滚动12个月口径）
 *
 * 滚动12个月财务口径：
 * - 窗口 = [统计日 - 364天, 统计日]
 * - 保单筛选：承保期间与窗口有交集的所有保单
 *
 * 计算公式：
 * - 期间已赚保费 = 首日费用部分 + 时间分摊部分
 * - 首日费用部分 = P × F × α × I（I=1当起保日在窗口内，否则0）
 * - 时间分摊部分 = P × (1-F) × (窗口内在保天数/365)
 *
 * 参数说明：
 * - P: 保费
 * - F: 费用率 = 费用金额 / 保费
 * - α: 险类系数（交强险=0.82, 商业险=0.94）
 * - 窗口内在保天数 = max(0, min(终保日, 统计日) - max(起保日, 窗口起点) + 1)
 *
 * @param config - 已赚保费计算配置
 * @returns SQL查询字符串
 */
export function generateEarnedPremiumQuery(config: EarnedPremiumConfig): string {
  const { cutoffDate, whereClause = '1=1', policyMonth, orgLevel3 } = config;

  // 滚动12个月窗口
  const windowStart = getRolling12MonthWindowStart(cutoffDate);

  // 构建明细筛选条件
  const detailFilters: string[] = [];
  if (policyMonth && policyMonth !== 'all') {
    detailFilters.push(`policy_month = '${policyMonth}'`);
  }
  if (orgLevel3 && orgLevel3 !== 'all') {
    detailFilters.push(`org_level_3 = '${orgLevel3}'`);
  }
  const detailFilterClause = detailFilters.length > 0
    ? `AND ${detailFilters.join(' AND ')}`
    : '';

  return `
WITH policy_earned AS (
  SELECT
    policy_no,
    org_level_3,
    insurance_type,
    STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS policy_month,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    -- 终保日 = 起保日 + 364天（一年期保单）
    CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY AS end_date,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    -- 起保日是否在窗口内（用于首日费用计算）
    CASE
      WHEN CAST(insurance_start_date AS DATE) >= DATE '${windowStart}'
       AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
      THEN 1 ELSE 0
    END AS start_in_window,
    -- 窗口内在保天数 = max(0, min(终保日, 统计日) - max(起保日, 窗口起点) + 1)
    GREATEST(
      0,
      DATEDIFF('day',
        GREATEST(CAST(insurance_start_date AS DATE), DATE '${windowStart}'),
        LEAST(CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY, DATE '${cutoffDate}')
      ) + 1
    ) AS days_in_window
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND insurance_type IN ('交强险', '商业保险')
    -- 滚动12个月口径：保单承保期间与窗口有交集
    -- 条件：起保日 <= 统计日 AND 终保日 >= 窗口起点
    AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
    AND (CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY) >= DATE '${windowStart}'
)
SELECT
  COALESCE(org_level_3, '未知') AS org_level_3,
  COALESCE(insurance_type, '未知') AS insurance_type,
  COALESCE(policy_month, '未知') AS policy_month,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(fee_amount), 2) AS total_fee,
  -- 平均费用率（%）
  ROUND(AVG(fee_rate) * 100, 2) AS fee_rate,
  -- 险类系数
  ROUND(AVG(line_factor), 2) AS line_factor,
  -- 平均窗口内在保天数
  ROUND(AVG(CAST(days_in_window AS DOUBLE)), 1) AS avg_elapsed_days,
  -- 首日费用部分 = SUM(P × F × α × I)
  ROUND(SUM(premium * fee_rate * line_factor * start_in_window), 2) AS first_day_part,
  -- 时间分摊部分 = SUM(P × (1-F) × (窗口内天数/365))
  ROUND(SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / 365.0)), 2) AS time_part,
  -- 期间已赚保费
  ROUND(
    SUM(premium * fee_rate * line_factor * start_in_window) +
    SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / 365.0)),
    2
  ) AS earned_premium_cum
FROM policy_earned
WHERE 1=1 ${detailFilterClause}
GROUP BY org_level_3, insurance_type, policy_month
ORDER BY org_level_3, insurance_type, policy_month
  `.trim();
}

/**
 * 生成已赚保费汇总查询SQL（滚动12个月口径，按三级机构分组）
 *
 * @param config - 已赚保费计算配置
 * @returns SQL查询字符串
 */
export function generateEarnedPremiumSummaryQuery(config: EarnedPremiumConfig): string {
  const { cutoffDate, whereClause = '1=1' } = config;

  // 滚动12个月窗口
  const windowStart = getRolling12MonthWindowStart(cutoffDate);

  return `
WITH policy_earned AS (
  SELECT
    policy_no,
    org_level_3,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    -- 起保日是否在窗口内
    CASE
      WHEN CAST(insurance_start_date AS DATE) >= DATE '${windowStart}'
       AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
      THEN 1 ELSE 0
    END AS start_in_window,
    -- 窗口内在保天数
    GREATEST(
      0,
      DATEDIFF('day',
        GREATEST(CAST(insurance_start_date AS DATE), DATE '${windowStart}'),
        LEAST(CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY, DATE '${cutoffDate}')
      ) + 1
    ) AS days_in_window
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND insurance_type IN ('交强险', '商业保险')
    -- 滚动12个月口径：保单承保期间与窗口有交集
    AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
    AND (CAST(insurance_start_date AS DATE) + INTERVAL 364 DAY) >= DATE '${windowStart}'
),
aggregated AS (
  SELECT
    COALESCE(org_level_3, '未知') AS org_level_3,
    CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
    SUM(premium) AS total_premium,
    SUM(fee_amount) AS total_fee,
    AVG(fee_rate) AS avg_fee_rate,
    -- 首日费用部分 = SUM(P × F × α × I)
    SUM(premium * fee_rate * line_factor * start_in_window) AS total_first_day_part,
    -- 时间分摊部分 = SUM(P × (1-F) × (窗口内天数/365))
    SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / 365.0)) AS total_time_part
  FROM policy_earned
  GROUP BY org_level_3
),
with_totals AS (
  SELECT * FROM aggregated
  UNION ALL
  SELECT
    '合计' AS org_level_3,
    SUM(policy_count) AS policy_count,
    SUM(total_premium) AS total_premium,
    SUM(total_fee) AS total_fee,
    SUM(avg_fee_rate * policy_count) / NULLIF(SUM(policy_count), 0) AS avg_fee_rate,
    SUM(total_first_day_part) AS total_first_day_part,
    SUM(total_time_part) AS total_time_part
  FROM aggregated
)
SELECT
  org_level_3,
  policy_count,
  ROUND(total_premium, 2) AS total_premium,
  ROUND(total_fee, 2) AS total_fee,
  ROUND(avg_fee_rate * 100, 2) AS avg_fee_rate,
  ROUND(total_first_day_part, 2) AS total_first_day_part,
  ROUND(total_time_part, 2) AS total_time_part,
  ROUND(total_first_day_part + total_time_part, 2) AS total_earned_premium,
  -- 已赚保费率
  CASE
    WHEN total_premium > 0
    THEN ROUND((total_first_day_part + total_time_part) * 100.0 / total_premium, 2)
    ELSE 0
  END AS earned_ratio
FROM with_totals
ORDER BY
  CASE org_level_3
    WHEN '四川' THEN 1
    WHEN '同城' THEN 2
    WHEN '异地' THEN 3
    WHEN '合计' THEN 4
    ELSE 5
  END
  `.trim();
}

// ==================== 预定义配置 ====================

export const COST_ANALYSIS_PRESETS = {
  /** 按客户类别的赔付率分析 */
  claimByCustomer: {
    dimension: 'customer_category' as CostDimension,
  },
  /** 按机构的赔付率分析 */
  claimByOrg: {
    dimension: 'org_level_3' as CostDimension,
  },
  /** 按险别组合的赔付率分析 */
  claimByCoverage: {
    dimension: 'coverage_combination' as CostDimension,
  },
};

// ==================== 新口径已赚保费SQL生成 ====================

/**
 * 新口径已赚保费配置
 */
export interface NewEarnedPremiumConfig {
  /** WHERE条件（可选） */
  whereClause?: string;
}

// ==================== 新口径已赚保费 V3 - 拆分表格 ====================

/**
 * 生成2025年保单在2025年的已赚保费查询SQL（V3版本）
 * 委托给 generateEarnedPremiumPeriodQuery，保持向后兼容
 */
export function generatePolicy2025In2025Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2025,
    earnedYear: 2025,
    isSameYear: true,
    whereClause: config.whereClause ?? '1=1',
  });
}

/**
 * 生成2025年保单在2026年的已赚保费查询SQL（V3版本）
 * 委托给 generateEarnedPremiumPeriodQuery，保持向后兼容
 */
export function generatePolicy2025In2026Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2025,
    earnedYear: 2026,
    isSameYear: false,
    whereClause: config.whereClause ?? '1=1',
  });
}

/**
 * 生成2026年保单在2026年的已赚保费查询SQL（V3版本）
 * 委托给 generateEarnedPremiumPeriodQuery，保持向后兼容
 */
export function generatePolicy2026In2026Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2026,
    earnedYear: 2026,
    isSameYear: true,
    whereClause: config.whereClause ?? '1=1',
  });
}

/**
 * 生成2026年保单在2027年的已赚保费查询SQL（V3版本）
 * 委托给 generateEarnedPremiumPeriodQuery，保持向后兼容
 */
export function generatePolicy2026In2027Query(config: NewEarnedPremiumConfig = {}): string {
  return generateEarnedPremiumPeriodQuery({
    policyYear: 2026,
    earnedYear: 2027,
    isSameYear: false,
    whereClause: config.whereClause ?? '1=1',
  });
}

/**
 * 计算某保单在指定统计月末的已赚保费
 * 已赚保费 = 首日费用部分 + 时间分摊部分
 * - 首日费用部分 = P × F × α（仅当起保日在统计月末之前时计入）
 * - 时间分摊部分 = P × (1-F) × min(有效天数, 365) / 365
 * - 有效天数 = 统计月末 - 起保日 + 1（封顶365天）
 *
 * @param statMonthEnd - 统计月末日期，格式 YYYY-MM-DD
 */
function buildEarnedPremiumCase(statMonthEnd: string): string {
  // 有效天数 = min(统计月末 - 起保日 + 1, 365)，至少0
  return `
    CASE
      WHEN CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
      THEN
        -- 首日费用部分 = P × F × α
        premium * fee_rate * line_factor +
        -- 时间分摊部分 = P × (1-F) × min(有效天数, 365) / 365
        premium * (1 - fee_rate) * LEAST(
          GREATEST(
            DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1,
            0
          ),
          365
        ) / 365.0
      ELSE 0
    END
  `;
}

/**
 * 获取月末日期
 * @param year 年份
 * @param month 月份（1-12）
 */
function getMonthEndDate(year: number, month: number): string {
  // 下个月1号减1天即为当月最后一天
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * 生成2025年保单已赚保费查询SQL
 *
 * 字段：起保月（1-12）、保费、截至25年末已赚保费、26年各月当期新增已赚保费（12个字段）
 *
 * 业务规则：
 * - earned_2025_12：截至2025年末的累计已赚（归于2025年）
 * - earned_2026_01：2026年1月新增已赚 = 截至26年1月末累计 - 截至25年末累计
 * - earned_2026_02：2026年2月新增已赚 = 截至26年2月末累计 - 截至26年1月末累计
 * - ...以此类推
 *
 * 验证规则：保费 ≈ 13个已赚保费字段之和（差异来自首日费用折扣 P×F×(1-α)，约2-3%）
 *
 * @param config - 配置
 * @returns SQL查询字符串
 */
export function generatePolicy2025EarnedPremiumQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  // 生成26年各月的当期新增已赚保费字段（增量而非累计）
  const earned2026Fields: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentMonthEnd = getMonthEndDate(2026, m);
    // 上一期末：1月用25年12月末，2月及以后用上一个月末
    const prevMonthEnd = m === 1 ? getMonthEndDate(2025, 12) : getMonthEndDate(2026, m - 1);

    // 当期新增 = 截至当月末累计 - 截至上月末累计
    earned2026Fields.push(
      `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}) - SUM(${buildEarnedPremiumCase(prevMonthEnd).trim()}), 2) AS earned_2026_${String(m).padStart(2, '0')}`
    );
  }

  return `
WITH policy_base AS (
  SELECT
    policy_no,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    EXTRACT(MONTH FROM CAST(insurance_start_date AS DATE)) AS policy_month,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    insurance_start_date
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025
    AND insurance_type IN ('交强险', '商业保险')
)
SELECT
  CAST(policy_month AS INTEGER) AS policy_month,
  ROUND(SUM(premium), 2) AS premium,
  -- 截至25年末已赚保费（归于2025年）
  ROUND(SUM(${buildEarnedPremiumCase(getMonthEndDate(2025, 12)).trim()}), 2) AS earned_2025_12,
  -- 26年各月当期新增已赚保费（增量）
  ${earned2026Fields.join(',\n  ')},
  -- 已赚合计 = 截至25年末 + 26年各月增量 = 满期已赚
  ROUND(SUM(${buildEarnedPremiumCase(getMonthEndDate(2026, 12)).trim()}), 2) AS earned_total,
  -- 验证差异 = 保费 - 满期已赚（预期差异约2-3%，来自首日费用折扣 P×F×(1-α)）
  ROUND(
    SUM(premium) - SUM(${buildEarnedPremiumCase(getMonthEndDate(2026, 12)).trim()}),
    2
  ) AS validation_diff
FROM policy_base
GROUP BY policy_month
ORDER BY policy_month
  `.trim();
}

/**
 * 生成2026年保单已赚保费查询SQL
 *
 * 字段：起保月、保费、26年各月当期已赚保费（12个字段）、27年各月当期已赚保费（12个字段）
 *
 * 业务规则：
 * - earned_2026_01：截至26年1月末的累计已赚（含首日费用，第一期）
 * - earned_2026_02：2月新增已赚 = 截至26年2月末累计 - 截至26年1月末累计
 * - ...以此类推
 * - earned_2027_01：27年1月新增已赚 = 截至27年1月末累计 - 截至26年12月末累计
 * - ...以此类推
 *
 * @param config - 配置
 * @returns SQL查询字符串
 */
export function generatePolicy2026EarnedPremiumQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  // 生成26年各月的当期已赚保费字段
  const earned2026Fields: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentMonthEnd = getMonthEndDate(2026, m);
    if (m === 1) {
      // 第一期：直接是截至1月末的累计值（含首日费用）
      earned2026Fields.push(
        `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}), 2) AS earned_2026_01`
      );
    } else {
      // 后续月份：当期新增 = 当月末累计 - 上月末累计
      const prevMonthEnd = getMonthEndDate(2026, m - 1);
      earned2026Fields.push(
        `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}) - SUM(${buildEarnedPremiumCase(prevMonthEnd).trim()}), 2) AS earned_2026_${String(m).padStart(2, '0')}`
      );
    }
  }

  // 生成27年各月的当期已赚保费字段
  const earned2027Fields: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentMonthEnd = getMonthEndDate(2027, m);
    // 上一期末：1月用26年12月末，后续用27年上一个月末
    const prevMonthEnd = m === 1 ? getMonthEndDate(2026, 12) : getMonthEndDate(2027, m - 1);
    earned2027Fields.push(
      `ROUND(SUM(${buildEarnedPremiumCase(currentMonthEnd).trim()}) - SUM(${buildEarnedPremiumCase(prevMonthEnd).trim()}), 2) AS earned_2027_${String(m).padStart(2, '0')}`
    );
  }

  return `
WITH policy_base AS (
  SELECT
    policy_no,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    EXTRACT(MONTH FROM CAST(insurance_start_date AS DATE)) AS policy_month,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    insurance_start_date
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026
    AND insurance_type IN ('交强险', '商业保险')
)
SELECT
  CAST(policy_month AS INTEGER) AS policy_month,
  ROUND(SUM(premium), 2) AS premium,
  -- 26年各月当期已赚保费
  ${earned2026Fields.join(',\n  ')},
  -- 27年各月当期已赚保费
  ${earned2027Fields.join(',\n  ')}
FROM policy_base
GROUP BY policy_month
ORDER BY policy_month
  `.trim();
}

/**
 * 生成新口径已赚保费汇总查询SQL
 *
 * 按2026年12个月末统计滚动12个月已赚保费：
 * - 统计年月
 * - 滚动12个月保费（按起保日期口径）
 * - 2025年保单在窗口内已赚保费
 * - 2026年保单在窗口内已赚保费
 * - 合计已赚保费
 * - 已赚率 = 合计已赚保费 / 滚动12个月保费
 *
 * 核心逻辑：
 * - 滚动12个月窗口：[2025年M月1日, 2026年M月末]
 * - 2025年保单窗口内已赚 = 累计(统计月末) - 累计(窗口前一天)
 * - 2026年保单窗口内已赚 = 累计(统计月末)（起保日一定在窗口内）
 *
 * @param config - 配置
 * @returns SQL查询字符串
 */
export function generateNewEarnedPremiumSummaryQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  // 生成12个月的UNION ALL查询
  const monthQueries: string[] = [];

  for (let m = 1; m <= 12; m++) {
    const statMonthEnd = getMonthEndDate(2026, m);
    const statMonth = `2026-${String(m).padStart(2, '0')}`;

    // 滚动12个月窗口：2025年M月1日 ~ 2026年M月末
    const windowStartDate = `2025-${String(m).padStart(2, '0')}-01`;

    // 窗口前一天：2025年(M-1)月末，用于计算2025年保单在窗口内的增量
    // M=1时，窗口前一天是2024-12-31
    const windowPrevEnd = m === 1
      ? '2024-12-31'
      : getMonthEndDate(2025, m - 1);

    monthQueries.push(`
      SELECT
        '${statMonth}' AS stat_month,
        -- 滚动12个月保费：起保日在 [窗口起点, 统计月末] 之间的保费
        (
          SELECT COALESCE(SUM(premium), 0)
          FROM PolicyFact
          WHERE ${whereClause}
            AND insurance_start_date IS NOT NULL
            AND insurance_type IN ('交强险', '商业保险')
            AND CAST(insurance_start_date AS DATE) >= DATE '${windowStartDate}'
            AND CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
        ) AS rolling_12m_premium,
        -- 2025年保单在滚动12个月窗口内的已赚保费
        -- = 累计(统计月末) - 累计(窗口前一天)
        -- 只计算起保日在窗口内的保单（2025年M月及之后起保）
        (
          SELECT COALESCE(SUM(
            -- 累计已赚保费（到统计月末）
            (premium * (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END) *
             (CASE insurance_type WHEN '交强险' THEN 0.82 WHEN '商业保险' THEN 0.94 ELSE 0.90 END) +
             premium * (1 - (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END)) *
             LEAST(GREATEST(DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1, 0), 365) / 365.0)
            -
            -- 减去截至窗口前一天的已赚保费
            (premium * (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END) *
             (CASE insurance_type WHEN '交强险' THEN 0.82 WHEN '商业保险' THEN 0.94 ELSE 0.90 END) *
             (CASE WHEN CAST(insurance_start_date AS DATE) <= DATE '${windowPrevEnd}' THEN 1 ELSE 0 END) +
             premium * (1 - (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END)) *
             LEAST(GREATEST(DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${windowPrevEnd}') + 1, 0), 365) / 365.0)
          ), 0)
          FROM PolicyFact
          WHERE ${whereClause}
            AND insurance_start_date IS NOT NULL
            AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025
            AND CAST(insurance_start_date AS DATE) >= DATE '${windowStartDate}'
            AND insurance_type IN ('交强险', '商业保险')
        ) AS earned_from_2025,
        -- 2026年保单在窗口内的已赚保费（起保日一定在窗口内，直接累计）
        (
          SELECT COALESCE(SUM(
            CASE
              WHEN CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
              THEN
                premium * (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END) *
                (CASE insurance_type WHEN '交强险' THEN 0.82 WHEN '商业保险' THEN 0.94 ELSE 0.90 END) +
                premium * (1 - (CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END)) *
                LEAST(GREATEST(DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1, 0), 365) / 365.0
              ELSE 0
            END
          ), 0)
          FROM PolicyFact
          WHERE ${whereClause}
            AND insurance_start_date IS NOT NULL
            AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026
            AND CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
            AND insurance_type IN ('交强险', '商业保险')
        ) AS earned_from_2026
    `);
  }

  return `
WITH monthly_stats AS (
  ${monthQueries.join('\n  UNION ALL\n  ')}
)
SELECT
  stat_month,
  ROUND(rolling_12m_premium, 2) AS rolling_12m_premium,
  ROUND(earned_from_2025, 2) AS earned_from_2025,
  ROUND(earned_from_2026, 2) AS earned_from_2026,
  ROUND(earned_from_2025 + earned_from_2026, 2) AS total_earned_premium,
  CASE
    WHEN rolling_12m_premium > 0
    THEN ROUND((earned_from_2025 + earned_from_2026) * 100.0 / rolling_12m_premium, 2)
    ELSE 0
  END AS earned_ratio
FROM monthly_stats
ORDER BY stat_month
  `.trim();
}

// ==================== 综合费用率预测SQL ====================

/**
 * 生成月度费用数据查询SQL
 *
 * 按起保月统计保费和费用金额,用于计算滚动12个月费用（考虑延迟）
 *
 * @param config - 配置
 * @returns SQL查询字符串
 */
export function generateMonthlyExpenseQuery(config: NewEarnedPremiumConfig = {}): string {
  const { whereClause = '1=1' } = config;

  return `
SELECT
  STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') AS policy_month,
  CAST(COUNT(DISTINCT policy_no) AS INTEGER) AS policy_count,
  ROUND(SUM(premium), 2) AS total_premium,
  ROUND(SUM(COALESCE(fee_amount, 0)), 2) AS total_fee,
  ROUND(SUM(premium) * 0.016, 2) AS tax,
  ROUND(SUM(COALESCE(fee_amount, 0)) + SUM(premium) * 0.016, 2) AS total_expense
FROM PolicyFact
WHERE ${whereClause}
  AND insurance_start_date IS NOT NULL
  AND (
    (EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2025)
    OR
    (EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = 2026)
  )
GROUP BY STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m')
ORDER BY policy_month
  `.trim();
}
