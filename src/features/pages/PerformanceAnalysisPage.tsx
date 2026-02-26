import React, { useState } from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { PerformanceAnalysisPanel, PerformanceHeaderControls } from '../dashboard/PerformanceAnalysisPanel';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceTimePeriod,
} from '../dashboard/hooks/usePerformanceSummary';

export const PerformanceAnalysisPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [segmentTag, setSegmentTag] = useState<PerformanceSegmentTag>('all');
  const [timePeriod, setTimePeriod] = useState<PerformanceTimePeriod>('day');
  const [growthMode, setGrowthMode] = useState<PerformanceGrowthMode>('mom');

  return (
    <PageFilterPanel
      preset="performance"
      title="业绩分析"
      headerBottomLeftContent={(
        <PerformanceHeaderControls
          segmentTag={segmentTag}
          timePeriod={timePeriod}
          growthMode={growthMode}
          onSegmentTagChange={setSegmentTag}
          onTimePeriodChange={setTimePeriod}
          onGrowthModeChange={setGrowthMode}
        />
      )}
      headerChipsAlign="right"
    >
      <PerformanceAnalysisPanel
        filters={filters}
        segmentTag={segmentTag}
        timePeriod={timePeriod}
        growthMode={growthMode}
      />
    </PageFilterPanel>
  );
};
