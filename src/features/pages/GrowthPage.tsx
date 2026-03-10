import React from 'react';
import { GrowthAnalysisPanel } from '../growth/components/GrowthAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { cardStyles, colorClasses, textStyles, cn } from '@/shared/styles';

export const GrowthPage: React.FC = () => {
  const { filters } = useGlobalFilters();

  return (
    <PageFilterPanel
      preset="growth"
      title="增长分析"
      basicFilterVisibleFields={{
        dateCriteria: true,
        analysisYear: true,
        dateRange: false,
        organization: true,
        coverageCombination: false,
        customerCategory: false,
        renewalMode: false,
      }}
      filterBarExtraContent={(
        <div className={cn(cardStyles.compact, 'space-y-1.5')}>
          <p className={cn(textStyles.caption, colorClasses.text.neutralDark)}>
            增长分析优先保留口径、年度和机构单选，避免与页面内部对比模式产生双重时间状态。
          </p>
        </div>
      )}
    >
      <GrowthAnalysisPanel filters={filters} />
    </PageFilterPanel>
  );
};
