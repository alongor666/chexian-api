import React, { useMemo, useCallback } from 'react';
import { ComparisonAnalysisPanel } from '../growth/components/ComparisonAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

export const ComparisonPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 数据对比` : '数据对比';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="full"
      title={dynamicTitle}
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div className="p-4">
        <ComparisonAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
