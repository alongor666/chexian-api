import { memo } from 'react';
import { LineChart } from '../../../widgets/charts/LineChart';
import { QualityBusinessChart } from '../../../widgets/charts/QualityBusinessChart';
import type { TimeView } from '../../../widgets/charts/LineChart';
import { TrendDataPoint, QualityBusinessDataPoint, PremiumTrendBarData } from '../hooks/useTrendData';
import { PerspectiveSwitcher } from '../../../widgets/filters/PerspectiveSwitcher';
import type { ViewPerspective, PerspectiveConfig } from '../../../shared/types/view-perspective';
import { buttonStyles, cardStyles, textStyles, cn } from '../../../shared/styles';

interface TrendSectionProps {
  trendData: TrendDataPoint[];
  qualityBusinessData: QualityBusinessDataPoint[];
  /** V3.0: 双Y轴柱+折线组合图数据 */
  barChartData: PremiumTrendBarData[];
  trendLoading: boolean;
  qualityBusinessLoading: boolean;
  isInitialized: boolean;
  timeView: TimeView;
  startDate?: string;
  endDate?: string;
  onExportTrend: (format: 'csv' | 'excel') => void;
  // V2.0: 视角切换props
  perspective: ViewPerspective;
  setPerspective: (perspective: ViewPerspective) => void;
  perspectiveConfig: PerspectiveConfig;
  /** 当前分析年份 */
  analysisYear?: number;
}

/**
 * 趋势图区域组件
 *
 * 显示：
 * - 保费趋势图（支持日/周/月视图切换）
 * - 优质业务占比趋势图（可选）
 * - 数据导出功能
 * - V2.0: 支持视角切换（保费/商业险件数/交强险件数）
 */
export const TrendSection = memo<TrendSectionProps>(function TrendSection({
  trendData,
  qualityBusinessData,
  barChartData,
  trendLoading,
  qualityBusinessLoading,
  isInitialized,
  timeView,
  startDate,
  endDate,
  onExportTrend,
  perspective,
  setPerspective,
  perspectiveConfig,
  analysisYear,
}) {
  const timeViewLabel =
    timeView === 'daily' ? '按日' : timeView === 'weekly' ? '按周' : '按月';

  return (
    <>
      {/* Premium Trend Chart */}
      {!isInitialized ? (
        <div className={cn(cardStyles.spacious, textStyles.body, "text-center")}>
          <p className="text-lg">请先上传数据文件以查看保费趋势图</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* V2.0: 视角切换器 */}
          <div className={cn(cardStyles.standard)}>
            <PerspectiveSwitcher
              value={perspective}
              onChange={setPerspective}
              label="分析视角"
              showDescription={false}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">{perspectiveConfig.label}趋势 - {timeViewLabel}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onExportTrend('csv')}
                disabled={trendData.length === 0}
                className={cn(buttonStyles.base, buttonStyles.primary, 'px-2 py-1 text-xs')}
              >
                导出 CSV
              </button>
              <button
                onClick={() => onExportTrend('excel')}
                disabled={trendData.length === 0}
                className={cn(buttonStyles.base, buttonStyles.success, 'px-2 py-1 text-xs')}
              >
                导出 Excel
              </button>
            </div>
          </div>
          <LineChart
            title=""
            data={trendData}
            loading={trendLoading}
            height={350}
            timeView={timeView}
            startDate={startDate}
            endDate={endDate}
            yAxisLabel={perspectiveConfig.yAxisLabel}
            barChartData={perspective === 'premium' ? barChartData : undefined}
            analysisYear={analysisYear}
          />
        </div>
      )}

      {/* Quality Business Trend Chart */}
      {isInitialized && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">优质业务占比趋势 - {timeViewLabel}</h2>
          <QualityBusinessChart
            title=""
            data={qualityBusinessData}
            loading={qualityBusinessLoading}
            height={350}
            timeView={timeView}
            startDate={startDate}
            endDate={endDate}
          />
        </div>
      )}
    </>
  );
});
