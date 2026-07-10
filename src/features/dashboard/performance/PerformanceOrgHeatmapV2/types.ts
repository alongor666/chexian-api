/**
 * Heatmap V2 — Type definitions
 */

import type { HeatmapThresholdTier, HeatmapTier } from '@/shared/styles';
import type { PerformanceOrgHeatmapRow } from '../../hooks/usePerformanceOrgHeatmap';
import type { HeatmapDimension } from '../../hooks/usePerformanceOrgHeatmap';
import type { PerformanceGrowthMode, PerformanceTimePeriod } from '../../hooks/usePerformanceSummary';

// ==================== Metric & Tier ====================

export type HeatmapMetric = 'growth' | 'achievement' | 'premium' | 'coefficient' | 'share' | 'per_policy';

// 档位/色值/阈值档类型收拢至 SSOT src/shared/styles/heatmap-scale.ts，此处 re-export 保持目录内引用不变
export type { HeatmapTier, HeatmapColorEntry, HeatmapColorScale, HeatmapThresholdTier } from '@/shared/styles';

// ==================== Threshold Config ====================

export interface HeatmapThresholdConfig {
  readonly metric: HeatmapMetric;
  /** 从高到低排列（第一项min最大） */
  readonly tiers: readonly HeatmapThresholdTier[];
}

// ==================== Derived Data ====================

export interface HeatmapSummaryStats {
  /** 最新一期处于 critical 或 weak 档位的机构数 */
  readonly abnormalOrgCount: number;
  /** 连续处于 critical/weak 天数最长的机构 */
  readonly maxConsecutiveDanger: { readonly org: string; readonly days: number } | null;
  /** 最近改善最快的机构（最新一期增长率相对前一期的正向变化最大） */
  readonly fastestImprovement: { readonly org: string; readonly delta: number } | null;
}

export interface HeatmapDerivedData {
  readonly dates: readonly string[];
  readonly organizations: readonly string[];
  readonly matrix: ReadonlyMap<string, ReadonlyMap<string, PerformanceOrgHeatmapRow>>;
  readonly summaryStats: HeatmapSummaryStats;
  readonly weekendDates: ReadonlySet<string>;
}

// ==================== Focus State ====================

export interface HeatmapCellCoord {
  readonly org: string;
  readonly date: string;
}

export interface HeatmapFocusState {
  readonly activeCell: HeatmapCellCoord | null;
  readonly hoverCell: HeatmapCellCoord | null;
}

// ==================== Tooltip ====================

export interface HeatmapTooltipContent {
  readonly org: string;
  readonly date: string;
  readonly weekdayLabel: string;
  readonly metric: HeatmapMetric;
  readonly tier: HeatmapTier;
  readonly tierLabel: string;
  readonly businessNote: string;
  readonly growthRate: number | null;
  readonly achievementRate: number | null;
  readonly premium: number | null;
  readonly avgPricingCoefficient: number | null;
  readonly premiumShare: number | null;
  readonly perPolicyPremium: number | null;
}

// ==================== Component Props ====================

export interface PerformanceOrgHeatmapV2Props {
  readonly rows: PerformanceOrgHeatmapRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly growthMode: PerformanceGrowthMode;
  readonly timePeriod: PerformanceTimePeriod;
  readonly dimensionLabel?: string;
  readonly groupByDimension?: HeatmapDimension;
  readonly defaultHeatmapMetric?: HeatmapMetric;
  readonly onCellClick?: (payload: HeatmapCellCoord) => void;
  readonly onRowClick?: (org: string) => void;
}

export interface HeatmapFocusPanelProps {
  readonly activeCell: HeatmapCellCoord | null;
  readonly row: PerformanceOrgHeatmapRow | undefined;
  readonly metric: HeatmapMetric;
  readonly growthMode: PerformanceGrowthMode;
  readonly onDrillClick: () => void;
  readonly onClear: () => void;
  /**
   * 抽屉之上是否还浮着 DimensionPicker（或其他模态）。
   * 为 true 时抽屉的 ESC 处理器让位（picker / 模态自己处理），
   * 避免按 ESC 时把抽屉的 heatmapSelection 清空，picker 仍开着却拿不到下钻上下文。
   * 修 PR #481 codex 第 2 轮 P2-1。
   */
  readonly isPickerOpen?: boolean;
}
