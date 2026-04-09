/**
 * HeatmapHeader — 指标Tabs + 口径说明文字
 */

import { Tabs } from '@/shared/ui/Tabs';
import { cn, colorClasses, textStyles } from '@/shared/styles';
import type { HeatmapMetric } from '../types';
import type { PerformanceGrowthMode, PerformanceTimePeriod } from '../../../hooks/usePerformanceSummary';
import { getHeatmapMetricTabs, TIME_PERIOD_HINTS } from '../config';

interface HeatmapHeaderProps {
  readonly metric: HeatmapMetric;
  readonly onMetricChange: (metric: HeatmapMetric) => void;
  readonly growthMode: PerformanceGrowthMode;
  readonly timePeriod: PerformanceTimePeriod;
}

export function HeatmapHeader({ metric, onMetricChange, growthMode, timePeriod }: HeatmapHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs
        items={getHeatmapMetricTabs(growthMode, timePeriod)}
        activeKey={metric}
        onChange={(key) => onMetricChange(key as HeatmapMetric)}
        variant="pills"
        size="small"
      />
      <p className={cn(textStyles.caption, colorClasses.text.neutralMuted)}>
        {TIME_PERIOD_HINTS[timePeriod] ?? ''}
      </p>
    </div>
  );
}
