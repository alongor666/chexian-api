import React from 'react';
import { ComparisonAnalysisPanel } from '../growth/components/ComparisonAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const ComparisonPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel preset="full">
      <div className="p-4">
        <ComparisonAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
