import React from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { PerformanceAnalysisPanel } from '../dashboard/PerformanceAnalysisPanel';

export const PerformanceAnalysisPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel preset="performance" title="业绩分析">
      <PerformanceAnalysisPanel filters={filters} />
    </PageFilterPanel>
  );
};
