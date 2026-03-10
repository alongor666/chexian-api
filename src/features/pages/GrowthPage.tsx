import React from 'react';
import { GrowthAnalysisPanel } from '../growth/components/GrowthAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const GrowthPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel
      preset="growth"
      title="增长分析"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <GrowthAnalysisPanel filters={filters} />
    </PageFilterPanel>
  );
};
