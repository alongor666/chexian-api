import React, { useState, useMemo, useCallback } from 'react';
import { TruckAnalysisPanel } from '../dashboard/TruckAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import type { ViewPerspective } from '../../shared/types';

export const TruckPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const [perspective, setPerspective] = useState<ViewPerspective>('premium');

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 营业货车分析` : '营业货车分析';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="full"
      title={dynamicTitle}
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} hideVehicleType />
      <div className="p-4">
        <TruckAnalysisPanel
          filters={filters}
          perspective={perspective}
          setPerspective={setPerspective}
        />
      </div>
    </PageFilterPanel>
  );
};
