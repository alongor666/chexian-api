import React from 'react';
import { Link } from 'react-router-dom';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { buttonStyles, cn } from '@/shared/styles';
import { ArrowRight } from 'lucide-react';
import { usePermission } from '@/shared/contexts/PermissionContext';
import { canAccessCost } from '@/shared/config/organizations';

export const CostPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();
  const { userPermission } = usePermission();

  const comprehensiveSwitch = import.meta.env.VITE_ENABLE_COMPREHENSIVE_ANALYSIS;
  const enableComprehensiveAnalysis =
    comprehensiveSwitch === 'true'
      || (comprehensiveSwitch !== 'false' && canAccessCost(userPermission?.username));

  return (
    <PageFilterPanel
      preset="cost"
      title="成本分析"
      showBasicFilterBar={false}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions}>
          {enableComprehensiveAnalysis && (
            <Link
              to="/comprehensive-analysis"
              className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall)}
            >
              进入综合分析
              <ArrowRight size={14} className="ml-1" />
            </Link>
          )}
        </FilterQuickActions>
      )}
    >
      <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
    </PageFilterPanel>
  );
};
