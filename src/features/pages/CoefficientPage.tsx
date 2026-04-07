import React, { useMemo, useCallback } from 'react';
import { CoefficientMonitorPanel } from '../coefficient/components/CoefficientMonitorPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

export const CoefficientPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 系数监控` : '系数监控';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="coefficient"
      title={dynamicTitle}
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'coefficient-summary', label: '汇总监控' },
        { id: 'coefficient-detail', label: '分期明细' },
      ]}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div className="p-4">
        <CoefficientMonitorPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
