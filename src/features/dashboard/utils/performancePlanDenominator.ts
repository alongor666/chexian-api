/**
 * 业绩计划口径周期化分母（前端镜像）
 *
 * **背景**：业绩分析的 plan_premium 字段是**年度**计划值；在 timePeriod 为
 * day/week/month/quarter 时，需要按比例缩小为"当期目标"才能与同期 premium
 * 做减法或比较。后端 SQL 在计算 achievement_rate 时已经这么做：
 *
 * ```sql
 * -- server/src/sql/performance-analysis/shared.ts:29 (SSOT)
 * achievement_rate = (premium * 100.0) / (plan_premium / getPlanDenominator(timePeriod))
 * ```
 *
 * 前端在 KPI 卡片 / 焦点条 / 任何需要计算"当期目标 / 当期缺口"金额的地方，
 * 必须复用同一份分母表，否则会出现"达成率 149.7% 却仍显示缺口"的口径错乱
 * （PR #477 codex review line 110）。
 *
 * **漂移防御**：本表与后端必须一致。任何一侧改动都要同步另一侧 + 更新
 * 相应单元测试，并在 BACKLOG 登记。
 */

import type { PerformanceTimePeriod } from '../hooks/usePerformanceSummary';

/**
 * 把年度计划 plan_premium 按 timePeriod 缩小为当期目标的除数。
 *
 * - day → 365（一年 365 天）
 * - week → 52（一年 52 周）
 * - month → 12
 * - quarter → 4
 * - year → 1（年度即整年）
 */
export function getPlanDenominator(timePeriod: PerformanceTimePeriod): number {
  switch (timePeriod) {
    case 'day':
      return 365;
    case 'week':
      return 52;
    case 'month':
      return 12;
    case 'quarter':
      return 4;
    case 'year':
      return 1;
    default:
      return 365;
  }
}

/**
 * 把年度 plan_premium（万元）换算成 timePeriod 周期内的目标（万元）。
 *
 * @param annualPlan 年度计划（来自 bundle 的 plan_premium 字段）
 * @param timePeriod 当前周期口径
 * @returns 当期目标。`annualPlan` 为 null/undefined 时返回 null。
 */
export function getPeriodPlan(
  annualPlan: number | null | undefined,
  timePeriod: PerformanceTimePeriod
): number | null {
  if (annualPlan == null || !Number.isFinite(annualPlan)) return null;
  const denom = getPlanDenominator(timePeriod);
  if (denom <= 0) return null;
  return annualPlan / denom;
}

/**
 * 在 timePeriod 周期内的"缺口"（当期目标 - 当期实际保费）。
 *
 * 仅当年度计划非空且**当期目标 > 当期保费**时返回正缺口；其余情况（达成 /
 * 计划缺失 / 负数缺口）一律返回 0，由调用方判断是否显示。
 *
 * 设计意图：与"阈值 99%"语义协同 —— 达成率超 99 视为达成，UI 不显示缺口。
 * 缺口仅作为"距离当期目标还差多少"的提示，非"年度计划减当期实际"。
 */
export function getPeriodGap(
  annualPlan: number | null | undefined,
  premium: number,
  timePeriod: PerformanceTimePeriod
): number {
  const periodPlan = getPeriodPlan(annualPlan, timePeriod);
  if (periodPlan == null) return 0;
  if (periodPlan <= premium) return 0;
  return periodPlan - premium;
}
