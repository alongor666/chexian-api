/**
 * 已赚保费 SQL 生成器 — 财务口径（滚动 12 个月 + V3 期间委托）
 *
 * 包含：
 * - 滚动12个月窗口计算
 * - 已赚保费明细查询
 * - 已赚保费汇总查询（按机构）
 * - V3 期间已赚保费包装器（委托 sql-builder.ts）
 *
 * ⚠️ 口径警告（B304）：本文件输出的 `earned_premium` 是【财务口径】，与
 *    `cost-ratios.ts` 的【时间分摊口径】**字段同名但公式不同**，禁止混用：
 *
 *    | 维度       | 财务口径（本文件）                  | 时间分摊口径（cost-ratios.ts）        |
 *    |-----------|-----------------------------------|--------------------------------------|
 *    | 终保日     | 起保日 + INTERVAL 364 DAY          | 起保日 + INTERVAL 1 YEAR（闰年感知） |
 *    | 险类系数 α | 0.82(交强)/0.94(商业)/0.90(其他)  | 无（不分险类）                        |
 *    | 公式       | 首日费用 P·F·α·I + 时间分摊 P·(1-F)·窗口内天数/policy_term | earned_days / policy_term × P |
 *    | 用途       | 财务报表 / 滚动 12 月口径          | 满期赔付率分母（与赔款 cohort 同步）  |
 *    | 调用方     | /api/query/cost?type=earned*       | /api/query/cost?type=claim 等         |
 *
 *    下游混用会算错赔付率（见 BACKLOG B304）。如需统一，须先 Parquet 直查对账
 *    再决策；字段重命名属 API breaking，本次仅文档化。
 *
 *    ⚠️ 闰年残差（B304 · 2026-07-10 评估）：本文件分母 policy_term 已闰年感知，但终保日
 *    仍固定 +364 天，闰年跨越保单（policy_term=366）第 366 个在保日被永久截掉——
 *    时间分摊部分终身只赚 365/366（SC 账本终身欠计 84.41 万元；闰年批次在保期窗口差异
 *    峰值约 0.2%，当前至 2027-02 生产滚动窗口内无闰年保单、数值零差异）。是否统一到
 *    +1 YEAR 待用户拍板，量化实证与字段迁移方案见
 *    `开发文档/审计/B304_已赚保费双口径闰年评估与字段迁移方案_2026-07-10.md`。
 *    注意 V3 矩阵（sql-builder.ts）已是 +1 YEAR 约定，364 残留仅在本文件两个滚动 12 月函数。
 */

import { formatDate } from '../../utils/date.js';
import { escapeSqlLiteral } from '../../utils/security.js';
import { EARNED_PREMIUM_LINE_FACTORS } from '../../config/earned-premium-factors.js';
import { generateEarnedPremiumPeriodQuery } from '../sql-builder.js';
import type { EarnedPremiumConfig, NewEarnedPremiumConfig } from './shared.js';

// ==================== 滚动12个月窗口 ====================

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

// ==================== 已赚保费明细 ====================

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
 */
export function generateEarnedPremiumQuery(config: EarnedPremiumConfig): string {
  const { cutoffDate, whereClause = '1=1', policyMonth, orgLevel3 } = config;

  // 滚动12个月窗口
  const windowStart = getRolling12MonthWindowStart(cutoffDate);

  // 构建明细筛选条件
  const detailFilters: string[] = [];
  if (policyMonth && policyMonth !== 'all') {
    // B327：转义防 SQL 注入（policyMonth 来自路由 query 无格式约束，duckdbService.query 不过 validateSQL）
    detailFilters.push(`policy_month = '${escapeSqlLiteral(policyMonth)}'`);
  }
  if (orgLevel3 && orgLevel3 !== 'all') {
    // B327：转义防 SQL 注入（orgLevel3 源自 commonFilterSchema z.string，为中文机构名无法正则约束）
    detailFilters.push(`org_level_3 = '${escapeSqlLiteral(orgLevel3)}'`);
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
    -- 保险期限天数（闰年感知：365/366），用于时间分摊分母
    DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR) AS policy_term,
    -- 费用率 F：premium <> 0 即按比例计算（负向批改行 fee/premium 同号得正费率，
    -- 首日费用项 premium×F×α×I 随负保费正确冲销；原 premium>0 条件使负行 F=0，
    -- 首日费用只计提从不冲销，全退保保单残留非零垃圾值 — 2026-06-12 用户裁决按比例冲销）
    CASE WHEN premium <> 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN ${EARNED_PREMIUM_LINE_FACTORS.compulsory}
      WHEN '商业保险' THEN ${EARNED_PREMIUM_LINE_FACTORS.commercial}
      ELSE ${EARNED_PREMIUM_LINE_FACTORS.other}
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
  -- 平均费用率（%）= SUM(费用)/SUM(保费)
  ROUND(SUM(fee_amount) / NULLIF(SUM(premium), 0) * 100, 2) AS fee_rate,
  -- 险类系数
  ROUND(AVG(line_factor), 2) AS line_factor,
  -- 平均窗口内在保天数
  ROUND(AVG(CAST(days_in_window AS DOUBLE)), 1) AS avg_elapsed_days,
  -- 首日费用部分 = SUM(P × F × α × I)
  ROUND(SUM(premium * fee_rate * line_factor * start_in_window), 2) AS first_day_part,
  -- 时间分摊部分 = SUM(P × (1-F) × (窗口内天数/policy_term))（闰年感知）
  ROUND(SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / CAST(policy_term AS DOUBLE))), 2) AS time_part,
  -- 期间已赚保费
  ROUND(
    SUM(premium * fee_rate * line_factor * start_in_window) +
    SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / CAST(policy_term AS DOUBLE))),
    2
  ) AS earned_premium_cum
FROM policy_earned
WHERE 1=1 ${detailFilterClause}
GROUP BY org_level_3, insurance_type, policy_month
ORDER BY org_level_3, insurance_type, policy_month
  `.trim();
}

// ==================== 已赚保费汇总 ====================

/**
 * 生成已赚保费汇总查询SQL（滚动12个月口径，按三级机构分组）
 */
export function generateEarnedPremiumSummaryQuery(config: EarnedPremiumConfig): string {
  const { cutoffDate, whereClause = '1=1', branchLabel: provinceName = '四川' } = config;
  const windowStart = getRolling12MonthWindowStart(cutoffDate);

  return `
WITH policy_earned AS (
  SELECT
    policy_no,
    org_level_3,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    -- 费用率 F：premium <> 0 即按比例计算（负向批改行 fee/premium 同号得正费率，
    -- 首日费用项 premium×F×α×I 随负保费正确冲销；原 premium>0 条件使负行 F=0，
    -- 首日费用只计提从不冲销，全退保保单残留非零垃圾值 — 2026-06-12 用户裁决按比例冲销）
    CASE WHEN premium <> 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN ${EARNED_PREMIUM_LINE_FACTORS.compulsory}
      WHEN '商业保险' THEN ${EARNED_PREMIUM_LINE_FACTORS.commercial}
      ELSE ${EARNED_PREMIUM_LINE_FACTORS.other}
    END AS line_factor,
    -- 起保日是否在窗口内
    CASE
      WHEN CAST(insurance_start_date AS DATE) >= DATE '${windowStart}'
       AND CAST(insurance_start_date AS DATE) <= DATE '${cutoffDate}'
      THEN 1 ELSE 0
    END AS start_in_window,
    -- 保险期限天数（闰年感知：365/366），用于时间分摊分母
    DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR) AS policy_term,
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
    SUM(fee_amount) / NULLIF(SUM(premium), 0) AS avg_fee_rate,
    -- 首日费用部分 = SUM(P × F × α × I)
    SUM(premium * fee_rate * line_factor * start_in_window) AS total_first_day_part,
    -- 时间分摊部分 = SUM(P × (1-F) × (窗口内天数/policy_term))（闰年感知）
    SUM(premium * (1 - fee_rate) * (CAST(days_in_window AS DOUBLE) / CAST(policy_term AS DOUBLE))) AS total_time_part
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
    SUM(total_fee) / NULLIF(SUM(total_premium), 0) AS avg_fee_rate,
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
    WHEN '${provinceName}' THEN 1
    WHEN '同城' THEN 2
    WHEN '异地' THEN 3
    WHEN '合计' THEN 4
    ELSE 5
  END
  `.trim();
}

// ==================== V3 期间已赚保费包装器（锚定年参数化） ====================

/**
 * 已赚保费矩阵四象限（相对锚定年 Y）：
 * - prevInPrev：Y-1 年保单在 Y-1 年的已赚（同年，含首日费用）
 * - prevInCurr：Y-1 年保单在 Y 年的已赚（跨年，仅时间分摊增量）
 * - currInCurr：Y 年保单在 Y 年的已赚（同年，含首日费用）
 * - currInNext：Y 年保单在 Y+1 年的已赚（跨年，仅时间分摊增量）
 *
 * 字段契约为相对年 key（earned_01..earned_12 / earned_total），
 * 绝对年份由调用方随 anchorYear 元数据透出，跨年无需改代码。
 */
export function generateEarnedPremiumMatrixQueries(
  anchorYear: number,
  config: NewEarnedPremiumConfig = {}
): { prevInPrev: string; prevInCurr: string; currInCurr: string; currInNext: string } {
  const whereClause = config.whereClause ?? '1=1';
  return {
    prevInPrev: generateEarnedPremiumPeriodQuery({
      policyYear: anchorYear - 1,
      earnedYear: anchorYear - 1,
      isSameYear: true,
      whereClause,
    }),
    prevInCurr: generateEarnedPremiumPeriodQuery({
      policyYear: anchorYear - 1,
      earnedYear: anchorYear,
      isSameYear: false,
      whereClause,
    }),
    currInCurr: generateEarnedPremiumPeriodQuery({
      policyYear: anchorYear,
      earnedYear: anchorYear,
      isSameYear: true,
      whereClause,
    }),
    currInNext: generateEarnedPremiumPeriodQuery({
      policyYear: anchorYear,
      earnedYear: anchorYear + 1,
      isSameYear: false,
      whereClause,
    }),
  };
}
