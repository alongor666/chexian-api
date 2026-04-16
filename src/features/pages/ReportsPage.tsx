import React, { useMemo, useCallback } from 'react';
import { PremiumReportPanel } from '../premium-report';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

export const ReportsPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 保费达成` : '保费达成';
  }, [quickFilters]);

  return (
    <PageFilterPanel
      preset="report"
      title={dynamicTitle}
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'report-summary', label: '汇总' },
        { id: 'report-org', label: '机构报表' },
        { id: 'report-salesman', label: '业务员报表' },
      ]}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div className="p-4">
        <PremiumReportPanel />
      </div>
    </PageFilterPanel>
  );
};
