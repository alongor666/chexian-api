import React, { useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { buttonStyles, cn } from '@/shared/styles';
import { usePermission } from '@/shared/contexts/PermissionContext';
import { canAccessCost } from '@/shared/config/organizations';

const ComprehensiveAnalysisPage = lazy(() =>
  import('./ComprehensiveAnalysisPage').then((m) => ({ default: m.ComprehensiveAnalysisPage }))
);

type CostView = 'basic' | 'comprehensive';

export const CostPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();
  const { userPermission } = usePermission();
  const [searchParams] = useSearchParams();
  const initialView = (searchParams.get('view') as CostView) || 'basic';
  const [view, setView] = useState<CostView>(initialView);

  const comprehensiveSwitch = import.meta.env.VITE_ENABLE_COMPREHENSIVE_ANALYSIS;
  const enableComprehensiveAnalysis =
    comprehensiveSwitch === 'true'
      || (comprehensiveSwitch !== 'false' && canAccessCost(userPermission?.username, userPermission?.specialFeatures));

  if (view === 'comprehensive' && enableComprehensiveAnalysis) {
    return (
      <Suspense fallback={<div className="p-6 animate-pulse"><div className="h-64 bg-neutral-100 rounded-xl" /></div>}>
        <ComprehensiveAnalysisPage onBack={() => setView('basic')} />
      </Suspense>
    );
  }

  return (
    <PageFilterPanel
      preset="cost"
      title="成本分析"
      showBasicFilterBar={false}
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
      <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
    </PageFilterPanel>
  );
};
