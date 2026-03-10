import React, { useState } from 'react';
import { CrossSellAnalysisPanel, CrossSellHeaderControls } from '../dashboard/CrossSellAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import type { TrendGranularity } from '../dashboard/hooks/useCrossSellTrend';
import { buttonStyles, cardStyles, colorClasses, textStyles, cn } from '../../shared/styles';

const CROSS_SELL_ANCHORS = [
  { id: 'cross-sell-kpi', label: '驱动因子', shortLabel: '驱动因子' },
  { id: 'cross-sell-insight', label: 'AI 解读', shortLabel: 'AI 解读' },
  { id: 'cross-sell-heatmap', label: '热力图', shortLabel: '热力图' },
  { id: 'cross-sell-trend', label: '趋势分析', shortLabel: '趋势分析' },
  { id: 'cross-sell-drilldown', label: '下钻分析', shortLabel: '下钻分析' },
  { id: 'cross-sell-top20', label: 'TOP20', shortLabel: 'TOP20' },
] as const;

export const CrossSellPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');

  const quickScenes = [
    {
      label: '转保',
      active: filters.is_new_car === false && filters.is_renewal === false,
      onClick: () =>
        setFilters((prev) =>
          prev.is_new_car === false && prev.is_renewal === false
            ? { ...prev, is_new_car: undefined, is_renewal: undefined }
            : { ...prev, is_new_car: false, is_renewal: false }
        ),
    },
    {
      label: '可续',
      active:
        filters.is_renewable === true &&
        filters.is_commercial_insure === true &&
        filters.insurance_type === false,
      onClick: () =>
        setFilters((prev) =>
          prev.is_renewable === true &&
          prev.is_commercial_insure === true &&
          prev.insurance_type === false
            ? {
              ...prev,
              is_renewable: undefined,
              is_commercial_insure: undefined,
              insurance_type: undefined,
            }
            : {
              ...prev,
              is_renewable: true,
              is_commercial_insure: true,
              insurance_type: false,
            }
        ),
    },
  ];

  return (
    <PageFilterPanel
      preset="full"
      title="非营业客车交叉销售分析"
      anchorSections={[...CROSS_SELL_ANCHORS]}
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
        <div className={cn(cardStyles.compact, 'space-y-2')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(textStyles.caption, colorClasses.text.neutralDark)}>场景快选</span>
            {quickScenes.map((scene) => (
              <button
                key={scene.label}
                type="button"
                onClick={scene.onClick}
                className={cn(
                  buttonStyles.base,
                  scene.active ? buttonStyles.primary : buttonStyles.secondary,
                  'px-3 py-1.5 text-xs'
                )}
                aria-pressed={scene.active}
              >
                {scene.label}
              </button>
            ))}
          </div>
          <p className={cn(textStyles.caption, colorClasses.text.neutral)}>
            当前页默认聚焦长页面阅读效率，基础筛选常驻，高级维度进入抽屉。
          </p>
        </div>
      )}
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
