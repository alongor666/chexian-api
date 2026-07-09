import React, { useState, useMemo, useCallback } from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../filters/PageFilterPanel';
import { PerformanceAnalysisPanel, PerformanceHeaderActions } from '../dashboard/PerformanceAnalysisPanel';
import { PerformanceFocusStrip } from '../dashboard/PerformanceFocusStrip';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceSummaryExpandDims,
  PerformanceTimePeriod,
} from '../dashboard/hooks/usePerformanceSummary';

const PERFORMANCE_ANCHORS = [
  { id: 'performance-focus', label: '今日焦点', shortLabel: '焦点' },
  { id: 'performance-heatmap', label: '热力图', shortLabel: '热力图' },
  { id: 'performance-summary', label: '业绩概览', shortLabel: '业绩概览' },
  { id: 'performance-trend', label: '趋势分析', shortLabel: '趋势分析' },
  { id: 'performance-drilldown', label: '下钻分析', shortLabel: '下钻分析' },
  { id: 'performance-top20', label: 'Top20', shortLabel: 'Top20' },
] as const;

/**
 * FocusStrip 和 Panel 都查询 performance-bundle。
 * - Panel 默认 expandDims = 'none'（见 PerformanceAnalysisPanel useState 初值）
 * - FocusStrip 锁定 'none' 是有意为之：FocusStrip 解析的 4 个语义信号（整体行 / 险别
 *   组合主行 / drilldown 行 / topSalesman 行）都是 bundle 顶层数据，与 expandDims 无关，
 *   保持 'none' 既能在首屏与 Panel queryKey 完全命中（仅 1 次 HTTP 请求），也避免
 *   用户在 Panel 切换 油电/新转续 后 FocusStrip 跟着多次重查。
 */
const FOCUS_STRIP_EXPAND_DIMS: PerformanceSummaryExpandDims = 'none';

export const PerformanceAnalysisPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const [segmentTag, setSegmentTag] = useState<PerformanceSegmentTag>('all');
  const [timePeriod, setTimePeriod] = useState<PerformanceTimePeriod>('day');
  const [growthMode, setGrowthMode] = useState<PerformanceGrowthMode>('mom');

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 业绩分析` : '业绩分析';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="performance"
      title={dynamicTitle}
      anchorSections={[...PERFORMANCE_ANCHORS]}
      showBasicFilterBar={false}
      headerRightContent={(actions) => (
        <PerformanceHeaderActions
          segmentTag={segmentTag}
          onSegmentTagChange={setSegmentTag}
          onReset={actions.onReset}
          onOpenAdvanced={actions.onOpenAdvanced}
          activeFilterCount={actions.activeFilterCount}
        />
      )}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div id="performance-focus" className="scroll-mt-32">
        <PerformanceFocusStrip
          filters={filters}
          segmentTag={segmentTag}
          timePeriod={timePeriod}
          growthMode={growthMode}
          expandDims={FOCUS_STRIP_EXPAND_DIMS}
        />
      </div>
      <PerformanceAnalysisPanel
        filters={filters}
        segmentTag={segmentTag}
        timePeriod={timePeriod}
        growthMode={growthMode}
        onTimePeriodChange={setTimePeriod}
        onGrowthModeChange={setGrowthMode}
        defaultHeatmapMetric="achievement"
      />
    </PageFilterPanel>
  );
};
