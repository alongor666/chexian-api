import { memo } from 'react';
import { LineChart } from '../../../widgets/charts/LineChart';
import { QualityBusinessChart } from '../../../widgets/charts/QualityBusinessChart';
import { YoyComboChart } from '../../../widgets/charts/YoyComboChart';
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
  /**
   * V4.0: 年度保费目标（万元）。
   * 有值时在主折线图上绘制 warning 色虚线目标参考线。
   */
  targetPremiumWan?: number;
}

/**
 * 趋势图区域组件 — V4.0 视觉重设计（设计简报 §5）
 *
 * 布局：
 * - 控制栏（时间粒度 + 视角切换 + 导出）全行
 * - 主图区（2/3 宽）：保费折线 + 上年 ghost 虚线 + 目标参考线
 * - 次级图栈（1/3 宽）：① 同比柱线小图 ② 优质占比折线小图
 *
 * 保留所有功能：日/周/月切换、保费/件数视角、CSV/Excel 导出。
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
  targetPremiumWan,
}) {
  const timeViewLabel =
    timeView === 'daily' ? '按日' : timeView === 'weekly' ? '按周' : '按月';

  if (!isInitialized) {
    return (
      <div className={cn(cardStyles.spacious, textStyles.body, 'text-center')}>
        <p className="text-lg">请先上传数据文件以查看保费趋势图</p>
      </div>
    );
  }

  // 主折线模式仅保费视角有上年同期数据，件数视角降级为原组合图
  const usePrimaryLineMode = perspective === 'premium';

  return (
    <div className="space-y-3">
      {/* 控制栏：视角切换 + 导出按钮 */}
      <div className={cn(cardStyles.standard, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-3')}>
        <PerspectiveSwitcher
          value={perspective}
          onChange={setPerspective}
          label="分析视角"
          showDescription={false}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 dark:text-neutral-400 hidden sm:inline">
            {perspectiveConfig.label}趋势 · {timeViewLabel}
          </span>
          <button
            onClick={() => onExportTrend('csv')}
            disabled={trendData.length === 0}
            className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2.5 py-1 text-xs')}
          >
            导出 CSV
          </button>
          <button
            onClick={() => onExportTrend('excel')}
            disabled={trendData.length === 0}
            className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2.5 py-1 text-xs')}
          >
            导出 Excel
          </button>
        </div>
      </div>

      {/* 图表区：主图（主列）+ 次级图栈（副列） */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">

        {/* 主图：保费折线（占 2/3 宽） */}
        <div className="xl:col-span-2">
          {/* 图表标题行（含图例说明） */}
          <div className="mb-1.5 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              {perspectiveConfig.label}趋势
              {targetPremiumWan != null && targetPremiumWan > 0 && perspective === 'premium' && (
                <span className="ml-2 text-xs font-normal text-neutral-500">含上年同期与目标线</span>
              )}
              {usePrimaryLineMode && (targetPremiumWan == null || targetPremiumWan === 0) && (
                <span className="ml-2 text-xs font-normal text-neutral-500">含上年同期</span>
              )}
            </h3>
            {/* 内联图例说明（替代图例组件，符合设计简报"线端直接标注"原则） */}
            {usePrimaryLineMode && (
              <div className="flex items-center gap-3 text-xs text-neutral-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-primary rounded-sm" />
                  本年
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-4"
                    style={{
                      height: '1.5px',
                      background: 'repeating-linear-gradient(to right, #8c8c8c 0, #8c8c8c 4px, transparent 4px, transparent 7px)',
                      opacity: 0.6,
                    }}
                  />
                  上年
                </span>
                {targetPremiumWan != null && targetPremiumWan > 0 && (
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block w-4"
                      style={{
                        height: '1.5px',
                        background: 'repeating-linear-gradient(to right, #faad14 0, #faad14 4px, transparent 4px, transparent 7px)',
                      }}
                    />
                    目标
                  </span>
                )}
              </div>
            )}
          </div>
          <LineChart
            title=""
            data={trendData}
            loading={trendLoading}
            height={320}
            timeView={timeView}
            startDate={startDate}
            endDate={endDate}
            yAxisLabel={perspectiveConfig.yAxisLabel}
            barChartData={perspective === 'premium' ? barChartData : undefined}
            analysisYear={analysisYear}
            showPrimaryLineMode={usePrimaryLineMode}
            targetPremiumWan={targetPremiumWan}
          />
        </div>

        {/* 次级图栈（1/3 宽）：同比 + 优质占比 */}
        <div className="flex flex-col gap-3">
          {/* 次级图 ①：本年 vs 上年同比柱线 */}
          <div>
            <div className="mb-1 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                本年 vs 上年（同比）
              </h3>
              <span className="text-xs text-neutral-400">柱=保费 · 线=同比</span>
            </div>
            <YoyComboChart
              data={perspective === 'premium' ? barChartData : []}
              analysisYear={analysisYear}
              loading={trendLoading}
              height={180}
            />
          </div>

          {/* 次级图 ②：优质业务占比趋势 */}
          <div>
            <div className="mb-1 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                优质业务占比趋势
              </h3>
              <span className="text-xs text-neutral-400">{timeViewLabel}</span>
            </div>
            <QualityBusinessChart
              title=""
              data={qualityBusinessData}
              loading={qualityBusinessLoading}
              height={180}
              timeView={timeView}
              startDate={startDate}
              endDate={endDate}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
