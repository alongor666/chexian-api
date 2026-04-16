import React, { useMemo, useCallback } from 'react';
import { FeeAnalysisPanel } from '../fee-analysis';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

export const FeeAnalysisPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 费用分析` : '费用分析';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="cost"
      title={dynamicTitle}
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'fee-kpi', label: 'KPI指标' },
        { id: 'fee-detail', label: '费率明细' },
      ]}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div className="p-4">
        <FeeAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
