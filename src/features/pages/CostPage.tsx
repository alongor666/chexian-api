import React, { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { buttonStyles, cn } from '@/shared/styles';
import { usePermission } from '@/shared/contexts/PermissionContext';
import { canAccessCost } from '@/shared/config/organizations';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

const ComprehensiveAnalysisPage = lazy(() =>
  import('./ComprehensiveAnalysisPage').then((m) => ({ default: m.ComprehensiveAnalysisPage }))
);

type CostView = 'basic' | 'comprehensive';

export const CostPage: React.FC = () => {
  const { filters, setFilters, maxDataDate } = useGlobalFilters();
  const { userPermission } = usePermission();
  const [searchParams] = useSearchParams();
  const initialView = (searchParams.get('view') as CostView) || 'basic';
  const [view, setView] = useState<CostView>(initialView);

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 成本分析` : '成本分析';
  }, [quickFilters]);

  const comprehensiveSwitch = import.meta.env.VITE_ENABLE_COMPREHENSIVE_ANALYSIS;
  const enableComprehensiveAnalysis =
    comprehensiveSwitch === 'true'
      || (comprehensiveSwitch !== 'false' && canAccessCost(userPermission?.username, userPermission?.specialFeatures));

  if (view === 'comprehensive' && enableComprehensiveAnalysis) {
    return (
      <Suspense fallback={<div className="p-6 animate-pulse"><div className="h-64 bg-neutral-100 dark:bg-white/8 rounded-xl" /></div>}>
        <ComprehensiveAnalysisPage onBack={() => setView('basic')} />
      </Suspense>
    );
  }

  return (
    <PageFilterPanel
      preset="cost"
      title={dynamicTitle}
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'cost-control', label: '分析配置' },
        { id: 'cost-content', label: '分析内容' },
      ]}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions}>
          {enableComprehensiveAnalysis && (
            <button
              onClick={() => setView('comprehensive')}
              className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall)}
            >
              综合分析视图
            </button>
          )}
        </FilterQuickActions>
      )}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
    </PageFilterPanel>
  );
};
