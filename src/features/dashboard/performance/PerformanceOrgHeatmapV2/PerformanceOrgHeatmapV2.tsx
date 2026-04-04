/**
 * PerformanceOrgHeatmapV2 — 主组件
 *
 * 统一替代三个旧版热力图组件。
 * 组合：HeatmapHeader → HeatmapSummaryBar → HeatmapMatrix → HeatmapLegend
 * FocusPanel 由父组件在外部渲染。
 */

import { useCallback, useMemo, useState } from 'react';
import { cardStyles, cn } from '@/shared/styles';
import type { HeatmapCellCoord, HeatmapMetric, PerformanceOrgHeatmapV2Props } from './types';
import { useHeatmapColorScale } from './hooks/useHeatmapColorScale';
import { useHeatmapFocusState } from './hooks/useHeatmapFocusState';
import { useHeatmapDerivedData } from './hooks/useHeatmapDerivedData';
import { HeatmapHeader } from './components/HeatmapHeader';
import { HeatmapSummaryBar } from './components/HeatmapSummaryBar';
import { HeatmapMatrix } from './components/HeatmapMatrix';
import { HeatmapLegend } from './components/HeatmapLegend';

export function PerformanceOrgHeatmapV2({
  rows,
  loading,
  error,
  growthMode,
  timePeriod,
  dimensionLabel = '三级机构',
  groupByDimension = 'org_level_3',
  defaultHeatmapMetric,
  onCellClick,
  onRowClick,
}: PerformanceOrgHeatmapV2Props) {
  const [metric, setMetric] = useState<HeatmapMetric>(defaultHeatmapMetric ?? 'growth');

  // 派生数据
  const derivedData = useHeatmapDerivedData({
    rows,
    metric,
    growthMode,
    timePeriod,
    groupByDimension,
  });

  // 保费分位数（仅 premium 模式需要）
  const premiumValues = useMemo(() => {
    if (metric !== 'premium') return undefined;
    const values: number[] = [];
    for (const [_org, orgLine] of derivedData.matrix) {
      for (const [, row] of orgLine) {
        if (row.premium > 0) values.push(row.premium);
      }
    }
    return values;
  }, [metric, derivedData.matrix]);

  // 色彩映射
  const { resolve } = useHeatmapColorScale(premiumValues);

  // 焦点状态
  const focusState = useHeatmapFocusState(timePeriod);

  // 单元格点击
  const handleCellClick = useCallback(
    (coord: HeatmapCellCoord) => {
      focusState.setActiveCell(coord);
      onCellClick?.(coord);
    },
    [focusState.setActiveCell, onCellClick],
  );

  // Hover
  const handleHoverStart = useCallback(
    (coord: HeatmapCellCoord) => {
      focusState.setHoverCell(coord);
    },
    [focusState.setHoverCell],
  );

  const handleHoverEnd = useCallback(() => {
    focusState.setHoverCell(null);
  }, [focusState.setHoverCell]);

  return (
    <section className={cn(cardStyles.standard, 'space-y-3')}>
      <HeatmapHeader
        metric={metric}
        onMetricChange={setMetric}
        growthMode={growthMode}
        timePeriod={timePeriod}
      />

      <HeatmapSummaryBar
        stats={derivedData.summaryStats}
        loading={loading}
      />

      <HeatmapMatrix
        derivedData={derivedData}
        metric={metric}
        growthMode={growthMode}
        timePeriod={timePeriod}
        dimensionLabel={dimensionLabel}
        groupByDimension={groupByDimension}
        loading={loading}
        error={error}
        resolveColor={resolve}
        isCellDimmed={focusState.isCellDimmed}
        isCellSelected={focusState.isCellSelected}
        onCellClick={handleCellClick}
        onHoverStart={handleHoverStart}
        onHoverEnd={handleHoverEnd}
        onRowClick={onRowClick}
      />

      <HeatmapLegend metric={metric} />
    </section>
  );
}
