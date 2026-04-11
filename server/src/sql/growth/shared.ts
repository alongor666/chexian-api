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
