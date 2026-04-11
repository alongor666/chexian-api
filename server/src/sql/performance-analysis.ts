/**
 * 业绩分析 SQL 生成器 — Barrel Re-export
 *
 * 原 704 行单体文件已拆分为 performance-analysis/ 子目录：
 * - performance-analysis/summary.ts      — 汇总 + 期间边界查询
 * - performance-analysis/trend.ts        — 趋势查询
 * - performance-analysis/drilldown.ts    — 下钻查询
 * - performance-analysis/top-salesman.ts — Top 业务员查询
 *
 * 热力图生成器在 performance-heatmap.ts，共享类型与辅助函数在 performance-analysis-shared.ts。
 * 此文件保持所有原始导出，调用方零改动。
 */

// 子模块
export * from './performance-analysis/summary.js';
export * from './performance-analysis/trend.js';
export * from './performance-analysis/drilldown.js';
export * from './performance-analysis/top-salesman.js';

// 共享类型与辅助函数 (原有 re-exports)
export type {
  PerformanceVehicleCategory,
  PerformanceSegmentTag,
  PerformanceGrowthMode,
  PerformanceTimePeriod,
  PerformanceTrendGranularity,
  PerformanceSummaryExpandDims,
  PerformanceDimension,
  PerformanceDrilldownStep,
  PerformancePeriodBounds,
  GroupByConfig,
} from './performance-analysis-shared.js';

export {
  getPlanDenominator,
  mapLegacyVehicleCategoryToSegmentTag,
  getPerformanceSegmentFilter,
  getPerformanceVehicleCategoryFilter,
} from './performance-analysis-shared.js';

export type {
  HeatmapGroupDimension,
  HeatmapDrillStep,
} from './performance-heatmap.js';

export {
  HEATMAP_DIMENSION_LABELS,
  generatePerformanceOrgHeatmapQuery,
} from './performance-heatmap.js';
