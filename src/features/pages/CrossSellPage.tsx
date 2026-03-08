import React, { useState } from 'react';
import { CrossSellAnalysisPanel, CrossSellHeaderControls } from '../dashboard/CrossSellAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import type { TrendGranularity } from '../dashboard/hooks/useCrossSellTrend';

export const CrossSellPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');

  return (
      <PageFilterPanel
        preset="full"
      title="非营业客车交叉销售分析"
      headerBottomLeftContent={(
        <CrossSellHeaderControls
          trendGranularity={trendGranularity}
          onTrendGranularityChange={setTrendGranularity}
        />
      )}
    >
      <CrossSellAnalysisPanel
        filters={filters}
        trendGranularity={trendGranularity}
      />
    </PageFilterPanel>
  );
};
