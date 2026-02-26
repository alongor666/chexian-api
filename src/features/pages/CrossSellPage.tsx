import React, { useState } from 'react';
import { CrossSellAnalysisPanel, CrossSellHeaderControls } from '../dashboard/CrossSellAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import type { VehicleCategory } from '../dashboard/hooks/useCrossSellTimePeriod';
import type { TrendGranularity } from '../dashboard/hooks/useCrossSellTrend';

export const CrossSellPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('passenger');
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');

  return (
    <PageFilterPanel
      preset="full"
      title="交叉销售分析"
      headerRightContent={(
        <CrossSellHeaderControls
          vehicleCategory={vehicleCategory}
          trendGranularity={trendGranularity}
          onVehicleCategoryChange={setVehicleCategory}
          onTrendGranularityChange={setTrendGranularity}
        />
      )}
    >
      <CrossSellAnalysisPanel
        filters={filters}
        vehicleCategory={vehicleCategory}
        trendGranularity={trendGranularity}
      />
    </PageFilterPanel>
  );
};
