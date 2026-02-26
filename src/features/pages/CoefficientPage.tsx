import React from 'react';
import { CoefficientMonitorPanel } from '../coefficient/components/CoefficientMonitorPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';

export const CoefficientPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel preset="coefficient" title="系数监控">
      <div className="p-4">
        <CoefficientMonitorPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
