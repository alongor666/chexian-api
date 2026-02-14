import React from 'react';
import { CrossSellAnalysisPanel } from '../dashboard/CrossSellAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const CrossSellPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel preset="full">
      <div className="p-4">
        <CrossSellAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
