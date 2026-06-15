/**
 * 趋势图共享类型（widgets / features 跨域复用）
 *
 * B330 修复：widgets/charts/{LineChart,YoyComboChart} 原从
 * features/dashboard/hooks/useTrendData 跨域 import type，
 * 违反 widgets→features 依赖倒置。将类型上提至 shared/types，
 * widgets / features 各自从此处导入。
 */

/**
 * 双 Y 轴柱状 + 折线组合图数据点（保费趋势主图用）。
 */
export interface PremiumTrendBarData {
  /** 对齐后的时间标签（去年份前缀） */
  time_period: string;
  /** X 轴显示标签 */
  display_label: string;
  /** 本年保费（原值） */
  current_premium: number;
  /** 上年同期保费（原值） */
  prev_premium: number;
  /** 当期同比增长率 */
  yoy_rate: number | null;
  /** 累计计划达成率（仅有计划时非 null） */
  achievement_rate: number | null;
}
