import React from 'react';
import { ComparisonAnalysisPanel } from '../growth/components/ComparisonAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const ComparisonPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel
      preset="full"
      title="数据对比"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4">
        <ComparisonAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
