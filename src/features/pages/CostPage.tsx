import React from 'react';
import { CostAnalysisPanel } from '../cost/components/CostAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const CostPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();

  return (
    <PageFilterPanel preset="cost">
      <div className="p-4">
        <CostAnalysisPanel filters={filters} maxDataDate={maxDataDate} />
      </div>
    </PageFilterPanel>
  );
};
