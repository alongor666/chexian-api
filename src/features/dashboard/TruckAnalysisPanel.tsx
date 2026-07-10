import React from 'react';
import { TonnageRoseChart } from '../../widgets/charts/TonnageRoseChart';
import { TruckDrillDownChart } from '../../widgets/charts/TruckDrillDownChart';
import { OrgPremiumPieChart } from '../../widgets/charts/OrgPremiumPieChart';
import { PerspectiveSwitcher } from '../../widgets/filters/PerspectiveSwitcher';
import type { AdvancedFilterState } from '../../shared/types/data';
import type { ViewPerspective } from '../../shared/types';
import { getPerspectiveConfig } from '../../shared/types';
import { formatCount, formatPremiumWan } from '../../shared/utils/formatters';
import { useTruckAnalysis } from './hooks/useTruckAnalysis';
import { cardStyles, textStyles, cn } from '../../shared/styles';
import { ErrorState } from '../../shared/ui';

interface TruckAnalysisPanelProps {
  filters: AdvancedFilterState;
  perspective: ViewPerspective;
  setPerspective: (perspective: ViewPerspective) => void;
}

/**
 * 营业货车专项分析面板
 *
 * 功能：
 * - 玫瑰图：展示各吨位分段的保费和保单数量占比（支持指标切换）
 * - 下钻分析图：展示机构堆叠柱状图，支持点击下钻到吨位分段详情
 *
 * @example
 * ```tsx
 * <TruckAnalysisPanel filters={filters} />
 * ```
 */
export const TruckAnalysisPanel: React.FC<TruckAnalysisPanelProps> = ({
  filters,
  perspective,
  setPerspective,
}) => {
  // 使用 useTruckAnalysis hook 获取数据（API-only 模式）
  const {
    rosePremiumData,
    roseCountData,
    tonnageByOrgData,
    orgPremiumData,
    loading,
    error,
    refresh,
  } = useTruckAnalysis({ filters, perspective });

  const perspectiveConfig = getPerspectiveConfig(perspective);
  const valueFormatter =
    perspectiveConfig.valueFormatter === 'premium' ? formatPremiumWan : formatCount;
  const valueLabel = perspectiveConfig.valueFormatter === 'premium' ? '保费' : '件数';

  // Panel 级错误态（05dff4 ⑥）：hook 一直暴露 error/refresh 但此前未消费，请求失败时页面静默空白
  if (error) {
    return (
      <div className={cn(cardStyles.standard)}>
        <ErrorState title="营业货车分析加载失败" message={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={cn(cardStyles.standard)}>
        <PerspectiveSwitcher
          value={perspective}
          onChange={setPerspective}
          label="分析视角"
          showDescription={false}
        />
      </div>
      <div id="truck-charts" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={cn(cardStyles.standard)}>
          <h3 className={cn(textStyles.titleSmall, "mb-4 text-center")}>吨位分段占比</h3>
          <TonnageRoseChart
            premiumData={rosePremiumData}
            countData={roseCountData}
            loading={loading}
            showTitle={false}
            showContainer={false}
          />
        </div>
        <div className={cn(cardStyles.standard)}>
          <h3 className={cn(textStyles.titleSmall, "mb-4 text-center")}>
            三级机构{valueLabel}占比
          </h3>
          <OrgPremiumPieChart
            data={orgPremiumData}
            loading={loading}
            showContainer={false}
            valueFormatter={valueFormatter}
            centerLabel={`总${valueLabel}`}
            seriesLabel={`三级机构${valueLabel}占比`}
          />
        </div>
      </div>

      <div id="truck-drilldown" className={cn(cardStyles.standard)}>
        <h3 className={cn(textStyles.titleSmall, "mb-1 text-center")}>
          三级机构营业货车堆叠图（{perspectiveConfig.label}）
        </h3>
        <TruckDrillDownChart
          data={tonnageByOrgData}
          loading={loading}
          showTitle={false}
          showContainer={false}
          perspective={perspective}
        />
      </div>
    </div>
  );
};
