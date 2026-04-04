import React from 'react';
import { FeeAnalysisPanel } from '../fee-analysis';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';

export const FeeAnalysisPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel
      preset="cost"
      title="费用分析"
      showBasicFilterBar={false}
      anchorSections={[
        { id: 'fee-kpi', label: 'KPI指标' },
        { id: 'fee-detail', label: '费率明细' },
      ]}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4">
        <FeeAnalysisPanel filters={filters} />
      </div>
    </PageFilterPanel>
  );
};
