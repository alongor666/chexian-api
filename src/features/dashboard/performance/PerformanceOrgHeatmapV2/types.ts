/**
 * Heatmap V2 — Type definitions
 */

import type { PerformanceOrgHeatmapRow } from '../../hooks/usePerformanceOrgHeatmap';
import type { HeatmapDimension } from '../../hooks/usePerformanceOrgHeatmap';
import type { PerformanceGrowthMode, PerformanceTimePeriod } from '../../hooks/usePerformanceSummary';

// ==================== Metric & Tier ====================

export type HeatmapMetric = 'growth' | 'achievement' | 'premium' | 'coefficient' | 'share' | 'per_policy';

/** 7级发散分段 + unknown */
export type HeatmapTier =
  | 'critical'   // L1 明显低于基准
  | 'weak'       // L2 低于基准
  | 'below'      // L3 略低于基准
  | 'normal'     // L4 正常波动带
  | 'above'      // L5 略高于基准
  | 'strong'     // L6 明显超越
  | 'excellent'  // L7 持续超越
  | 'unknown';   // 缺失值

// ==================== Color Scale ====================

export interface HeatmapColorEntry {
  readonly bg: string;
  readonly text: string;
}

export interface HeatmapColorScale {
  readonly light: Record<HeatmapTier, HeatmapColorEntry>;
  readonly dark: Record<HeatmapTier, HeatmapColorEntry>;
}

// ==================== Threshold Config ====================

export interface HeatmapThresholdTier {
  readonly tier: HeatmapTier;
  /** value >= min 则匹配此档（从高到低遍历，第一个匹配即停） */
  readonly min?: number;
}

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
}
