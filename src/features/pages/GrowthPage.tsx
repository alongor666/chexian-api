import React, { useMemo, useCallback } from 'react';
import { GrowthAnalysisPanel } from '../growth/components/GrowthAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

export const GrowthPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 增长分析` : '增长分析';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="growth"
      title={dynamicTitle}
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'growth-control', label: '分析配置' },
        { id: 'growth-charts', label: '趋势图表' },
        { id: 'growth-detail', label: '明细数据' },
      ]}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <GrowthAnalysisPanel filters={filters} />
    </PageFilterPanel>
  );
};
