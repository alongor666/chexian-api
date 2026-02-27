import React, { useState } from 'react';
import { CrossSellAnalysisPanel, CrossSellHeaderControls } from '../dashboard/CrossSellAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import type { SeatCoverageLevel, VehicleCategory } from '../dashboard/hooks/useCrossSellTimePeriod';
import type { TrendGranularity } from '../dashboard/hooks/useCrossSellTrend';

export const CrossSellPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('passenger');
  const [seatCoverageLevel, setSeatCoverageLevel] = useState<SeatCoverageLevel>('eq_1w');
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');

  return (
    <PageFilterPanel
      preset="full"
      title="交叉销售分析"
      headerBottomLeftContent={(
        <CrossSellHeaderControls
          vehicleCategory={vehicleCategory}
          seatCoverageLevel={seatCoverageLevel}
          trendGranularity={trendGranularity}
          onVehicleCategoryChange={setVehicleCategory}
          onSeatCoverageLevelChange={setSeatCoverageLevel}
          onTrendGranularityChange={setTrendGranularity}
        />
      )}
    >
      <CrossSellAnalysisPanel
        filters={filters}
        vehicleCategory={vehicleCategory}
        seatCoverageLevel={seatCoverageLevel}
        trendGranularity={trendGranularity}
      />
    </PageFilterPanel>
  );
};
