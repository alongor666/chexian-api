/**
 * 已赚保费基础类型与选项
 * 从 costTypes.ts 拆分而来
 */

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
