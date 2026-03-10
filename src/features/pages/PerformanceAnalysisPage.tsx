import React, { useState } from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import { PerformanceAnalysisPanel, PerformanceHeaderControls } from '../dashboard/PerformanceAnalysisPanel';
import type {
  PerformanceGrowthMode,
  PerformanceSegmentTag,
  PerformanceTimePeriod,
} from '../dashboard/hooks/usePerformanceSummary';
import { cardStyles, colorClasses, textStyles, cn } from '@/shared/styles';

const PERFORMANCE_ANCHORS = [
  { id: 'performance-heatmap', label: '热力图', shortLabel: '热力图' },
  { id: 'performance-summary', label: '业绩概览', shortLabel: '业绩概览' },
  { id: 'performance-trend', label: '趋势分析', shortLabel: '趋势分析' },
  { id: 'performance-drilldown', label: '下钻分析', shortLabel: '下钻分析' },
  { id: 'performance-top20', label: 'Top20', shortLabel: 'Top20' },
] as const;

export const PerformanceAnalysisPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [segmentTag, setSegmentTag] = useState<PerformanceSegmentTag>('all');
  const [timePeriod, setTimePeriod] = useState<PerformanceTimePeriod>('day');
  const [growthMode, setGrowthMode] = useState<PerformanceGrowthMode>('mom');

  return (
    <PageFilterPanel
      preset="performance"
      title="业绩分析"
      anchorSections={[...PERFORMANCE_ANCHORS]}
      basicFilterVisibleFields={{
        dateCriteria: true,
        analysisYear: true,
        dateRange: true,
        organization: true,
        coverageCombination: true,
        customerCategory: false,
        renewalMode: false,
      }}
      filterBarExtraContent={(
        <div className={cn(cardStyles.compact, 'space-y-1.5')}>
          <p className={cn(textStyles.caption, colorClasses.text.neutralDark)}>
            当前页优先保留时间与机构上下文，热力图、下钻和 Top20 可通过右侧导航快速跳转。
          </p>
        </div>
      )}
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
