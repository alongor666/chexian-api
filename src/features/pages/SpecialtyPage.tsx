import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CrossSellAnalysisPanel, CrossSellHeaderControls } from '../dashboard/CrossSellAnalysisPanel';
import { TruckAnalysisPanel } from '../dashboard/TruckAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import { Tabs } from '../../shared/ui';
import { buttonStyles, cn } from '../../shared/styles';
import type { ViewPerspective } from '../../shared/types';
import type { FilterPresetName } from '../../shared/types/filters';
import type { TrendGranularity } from '../dashboard/hooks/useCrossSellTrend';

type SpecialtyTab = 'cross-sell' | 'truck';

const tabItems = [
  { key: 'cross-sell', label: '驾意险推介率' },
  { key: 'truck', label: '营业货车' },
];

const presetMap: Record<SpecialtyTab, FilterPresetName> = {
  'cross-sell': 'full',
  'truck': 'full',
};

const CROSS_SELL_ANCHORS = [
  { id: 'cross-sell-kpi', label: '驱动因子', shortLabel: '驱动因子' },
  { id: 'cross-sell-insight', label: 'AI 解读', shortLabel: 'AI 解读' },
  { id: 'cross-sell-heatmap', label: '热力图', shortLabel: '热力图' },
  { id: 'cross-sell-trend', label: '趋势分析', shortLabel: '趋势分析' },
  { id: 'cross-sell-drilldown', label: '下钻分析', shortLabel: '下钻分析' },
  { id: 'cross-sell-top20', label: 'TOP20', shortLabel: 'TOP20' },
] as const;

const TRUCK_ANCHORS = [
  { id: 'truck-charts', label: '占比分析' },
  { id: 'truck-drilldown', label: '堆叠下钻' },
];

export const SpecialtyPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const initialTab: SpecialtyTab = rawTab === 'cross-sell' || rawTab === 'truck' ? rawTab : 'cross-sell';
  const [activeTab, setActiveTab] = useState<SpecialtyTab>(initialTab);

  const { filters, setFilters } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);

  // Cross-sell state
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');

  // Truck state
  const [truckPerspective, setTruckPerspective] = useState<ViewPerspective>('premium');

  const handleTabChange = (key: string) => {
    const tab = key as SpecialtyTab;
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

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

  const renderHeaderControls = (actions: any) => (
    <FilterQuickActions {...actions}>
      {activeTab === 'cross-sell' && (
        <>
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
          <CrossSellHeaderControls
            trendGranularity={trendGranularity}
            onTrendGranularityChange={setTrendGranularity}
          />
        </>
      )}
    </FilterQuickActions>
  );

  const titleMap: Record<SpecialtyTab, string> = {
    'cross-sell': '交叉销售分析',
    'truck': '营业货车分析',
  };

  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    const base = titleMap[activeTab];
    return label ? `${label} — ${base}` : base;
  }, [quickFilters, activeTab]);

  return (
    <PageFilterPanel
      preset={presetMap[activeTab]}
      title={dynamicTitle}
      anchorSections={
        activeTab === 'cross-sell' ? [...CROSS_SELL_ANCHORS]
        : TRUCK_ANCHORS
      }
      showBasicFilterBar={false}
      headerRightContent={renderHeaderControls}
    >
      <QuickFilterBar
        filters={quickFilters}
        onChange={handleQuickFilterChange}
        hideVehicleType={activeTab === 'truck'}
      />
      <div className="space-y-4">
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={handleTabChange}
          variant="pills"
        />

        {activeTab === 'cross-sell' && (
          <CrossSellAnalysisPanel
            filters={filters}
            trendGranularity={trendGranularity}
          />
        )}

        {activeTab === 'truck' && (
          <div className="p-4">
            <TruckAnalysisPanel
              filters={filters}
              perspective={truckPerspective}
              setPerspective={setTruckPerspective}
            />
          </div>
        )}
      </div>
    </PageFilterPanel>
  );
};
