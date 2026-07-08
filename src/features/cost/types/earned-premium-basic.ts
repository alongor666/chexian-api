/**
 * 已赚保费基础类型与选项
 * 从 costTypes.ts 拆分而来
 */

import { getLastDayOfMonth } from '../../../shared/utils/date';

// ==================== 已赚保费相关 ====================

/**
 * 生成某一年 12 个月末选项（YYYY-MM-DD → 「YYYY年M月末」）。
 * 原为写死 2026 年的静态数组（跨年即过期），2026-07-07 硬编码专项改为按年动态生成。
 */
export function buildYearMonthEndOptions(year: number): { value: string; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const lastDay = getLastDayOfMonth(year, i);
    return {
      value: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      label: `${year}年${month}月末`,
    };
  });
}

/**
 * 当年 12 个月末选项 —— 仅作 CostAnalysisControlPanel 未传入动态 monthEndOptions 时的兜底；
 * 常规路径由 CostAnalysisPanel 依据数据最大日期动态生成。
 */
export const MONTH_END_OPTIONS: { value: string; label: string }[] =
  buildYearMonthEndOptions(new Date().getFullYear());

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
