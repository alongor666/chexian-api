import React from 'react';
import { CoefficientMonitorPanel } from '../coefficient/components/CoefficientMonitorPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const CoefficientPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel
      preset="coefficient"
      title="系数监控"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4">
        <CoefficientMonitorPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
