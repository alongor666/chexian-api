import React from 'react';
import { GrowthAnalysisPanel } from '../growth/components/GrowthAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const GrowthPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel preset="full" title="增长分析">
      <div className="p-4">
        <GrowthAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
