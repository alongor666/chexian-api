import React, { useState, useMemo, useCallback } from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { PerformanceAnalysisPanel, PerformanceHeaderActions } from '../dashboard/PerformanceAnalysisPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceTimePeriod,
} from '../dashboard/hooks/usePerformanceSummary';

const PERFORMANCE_ANCHORS = [
  { id: 'performance-heatmap', label: '热力图', shortLabel: '热力图' },
  { id: 'performance-summary', label: '业绩概览', shortLabel: '业绩概览' },
  { id: 'performance-trend', label: '趋势分析', shortLabel: '趋势分析' },
  { id: 'performance-drilldown', label: '下钻分析', shortLabel: '下钻分析' },
  { id: 'performance-top20', label: 'Top20', shortLabel: 'Top20' },
] as const;

export const PerformanceAnalysisPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const [segmentTag, setSegmentTag] = useState<PerformanceSegmentTag>('all');
  const [timePeriod, setTimePeriod] = useState<PerformanceTimePeriod>('day');
  const [growthMode, setGrowthMode] = useState<PerformanceGrowthMode>('mom');

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination]);
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
