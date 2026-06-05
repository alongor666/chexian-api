/**
 * 业绩分析页 · 热力图维度分段控件分组
 *
 * 视觉上把 8 维度按"组织 / 业务"两组展示（PR #480 设计稿）。
 * ARIA 上必须保持单一 radiogroup（外层包），以避免双 radiogroup 共用单状态
 * 导致其中一组无 `aria-checked=true`（codex 第 1 轮 P2 反馈）。
 *
 * SSOT：label 不写在本文件，渲染时从 `HEATMAP_DIMENSION_LABELS`（hooks/usePerformanceOrgHeatmap）取。
 * 完整性 invariant：所有 groups 的 keys 联合 === HEATMAP_DIMENSION_LABELS 的全部 keys，
 * 不漏、不重；由 `__tests__/heatmapDimGroups.test.ts` 守护。
 */

import type { HeatmapDimension } from '../hooks/usePerformanceOrgHeatmap';

export interface HeatmapDimGroup {
  readonly groupLabel: string;
  readonly keys: readonly HeatmapDimension[];
}

export const HEATMAP_DIM_GROUPS: readonly HeatmapDimGroup[] = [
  { groupLabel: '组织', keys: ['org_level_3', 'team', 'salesman'] },
  {
    groupLabel: '业务',
    keys: ['customer_category', 'coverage_combination', 'energy_type', 'business_nature', 'insurance_grade'],
  },
] as const;
