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
      anchorSections={[
        { id: 'growth-control', label: '分析配置' },
        { id: 'growth-charts', label: '趋势图表' },
        { id: 'growth-detail', label: '明细数据' },
      ]}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <GrowthAnalysisPanel filters={filters} />
    </PageFilterPanel>
  );
};
