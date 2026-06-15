/**
 * 增长率分析 — 共享类型与辅助函数
 *
 * 包含：GrowthType / TimeView / GrowthConfig 类型定义
 *       generateTimeExpression() 内部辅助函数（供 growth/ 子模块使用）
 *
 * DC-001: 支持动态日期字段（通过 dateField 参数）
 */

import { DateCriteria } from '../../types/data.js';

export type GrowthType = 'yoy' | 'mom' | 'ytd' | 'custom';
export type TimeView = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * 增长率计算配置接口
 */
export interface GrowthConfig {
  /** 增长率类型 */
  growthType: GrowthType;
  /** 时间视图 */
  timeView: TimeView;
  /** 对比基准期间（用于自定义比较） */
  baselinePeriod?: {
    startDate: string;
    endDate: string;
  };
  /** 当前期间（用于自定义比较） */
  currentPeriod?: {
    startDate: string;
    endDate: string;
  };
  /** 比较的指标 */
  metric?: string;
  /** 分组维度 */
  groupBy?: string[];
  /** WHERE条件 */
  whereClause?: string;
  /** 参考年份（用于YTD计算，DC-002合规，避免硬编码CURRENT_DATE） */
  referenceYear?: number;
}

/**
 * 生成时间周期表达式
 *
 * DC-001: 支持动态日期字段
 *
 * @param timeView - 时间视图
 * @param dateColumn - 日期列名（默认使用 policy_date，DC-001 支持动态传入）
 * @returns SQL时间表达式
 */
export function generateTimeExpression(
  timeView: TimeView,
  dateColumn: DateCriteria = 'policy_date'
): string {
  switch (timeView) {
    case 'daily':
      return `CAST(${dateColumn} AS DATE)`;
    case 'weekly':
      return `DATE_TRUNC('week', CAST(${dateColumn} AS DATE))`;
    case 'monthly':
      return `DATE_TRUNC('month', CAST(${dateColumn} AS DATE))`;
    case 'quarterly':
      return `DATE_TRUNC('quarter', CAST(${dateColumn} AS DATE))`;
    case 'yearly':
      return `DATE_TRUNC('year', CAST(${dateColumn} AS DATE))`;
    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }
}

/**
 * 生成"先位移再截断"的时间周期表达式。
 *
 * 用途：YoY 计算"去年同期"时，必须保证 weekly 视图下两侧落在同一周一边界。
 * 例：原 `DATE_TRUNC('week', date) + INTERVAL '1 year'` 把周一加 1 年后落到周二，
 * 与当年同周的 `DATE_TRUNC('week', date)` 不再相等，产生整列 NULL/-100% 幽灵行。
 * 正确做法：先把原始日期 +1 年，再 DATE_TRUNC —— 重新对齐当年的周一边界。
 *
 * @param timeView - 时间视图
 * @param dateColumn - 日期列名
 * @param shift - SQL INTERVAL 语法（如 '1 year' / '52 weeks'）
 */
export function generateShiftedTimeExpression(
  timeView: TimeView,
  dateColumn: DateCriteria = 'policy_date',
  shift: string
): string {
  const shifted = `(CAST(${dateColumn} AS DATE) + INTERVAL '${shift}')`;
  switch (timeView) {
    case 'daily':
      return shifted;
    case 'weekly':
      return `DATE_TRUNC('week', ${shifted})`;
    case 'monthly':
      return `DATE_TRUNC('month', ${shifted})`;
    case 'quarterly':
      return `DATE_TRUNC('quarter', ${shifted})`;
    case 'yearly':
      return `DATE_TRUNC('year', ${shifted})`;
    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }
}

/**
 * timeView → DATE_TRUNC 单位映射（YTD 在已聚合周期上做位移后重新截断时用）。
 */
export function timeViewToTruncUnit(timeView: TimeView): string {
  switch (timeView) {
    case 'daily': return 'day';
    case 'weekly': return 'week';
    case 'monthly': return 'month';
    case 'quarterly': return 'quarter';
    case 'yearly': return 'year';
    default:
      throw new Error(`Unknown time view: ${timeView}`);
  }
}
