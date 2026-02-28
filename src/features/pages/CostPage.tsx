import React from 'react';
import { Link } from 'react-router-dom';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { buttonStyles, cn } from '@/shared/styles';
import { ArrowRight } from 'lucide-react';

export const CostPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();
  const enableComprehensiveAnalysis = import.meta.env.VITE_ENABLE_COMPREHENSIVE_ANALYSIS === 'true';

  return (
    <PageFilterPanel
      preset="cost"
      title="成本分析"
      headerRightContent={
        enableComprehensiveAnalysis ? (
          <Link
            to="/comprehensive-analysis"
            className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall)}
          >
            进入综合分析
            <ArrowRight size={14} className="ml-1" />
          </Link>
        ) : null
      }
    >
      <div className="p-4">
        <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
      </div>
    </PageFilterPanel>
  );
};
