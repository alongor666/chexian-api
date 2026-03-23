import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CrossSellAnalysisPanel, CrossSellHeaderControls } from '../dashboard/CrossSellAnalysisPanel';
import { RenewalAnalysisPanel } from '../dashboard/RenewalAnalysisPanel';
import { RenewalDrilldownPanel } from '../dashboard/RenewalDrilldownPanel';
import { TruckAnalysisPanel } from '../dashboard/TruckAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { Tabs } from '../../shared/ui';
import { buttonStyles, cn } from '../../shared/styles';
import type { ViewPerspective } from '../../shared/types';
import type { FilterPresetName } from '../../shared/types/filters';
import type { TrendGranularity } from '../dashboard/hooks/useCrossSellTrend';

type SpecialtyTab = 'cross-sell' | 'renewal' | 'truck';

const tabItems = [
  { key: 'cross-sell', label: '驾意险推介率' },
  { key: 'renewal', label: '续保分析' },
  { key: 'truck', label: '营业货车' },
];

const presetMap: Record<SpecialtyTab, FilterPresetName> = {
  'cross-sell': 'full',
  'renewal': 'renewalDetail',
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

export const SpecialtyPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as SpecialtyTab) || 'cross-sell';
  const [activeTab, setActiveTab] = useState<SpecialtyTab>(initialTab);

  const { filters, setFilters, maxDataDate } = useGlobalFilters();

  // Cross-sell state
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');

  // Renewal state
  const [renewalTab, setRenewalTab] = useState<'drilldown' | 'detail'>('drilldown');
  const [perspective, setPerspective] = useState<ViewPerspective>('premium');
  const [cutoffDate, setCutoffDate] = useState<string>(
    maxDataDate || new Date().toISOString().split('T')[0]
  );
  const [bundleOnly, setBundleOnly] = useState(false);
  const [selfRenewalOnly, setSelfRenewalOnly] = useState(false);
  const [selectedDueMonth, setSelectedDueMonth] = useState<number | null>(null);

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
    'renewal': '续保分析',
    'truck': '营业货车分析',
  };

  return (
    <PageFilterPanel
      preset={presetMap[activeTab]}
      title={titleMap[activeTab]}
      anchorSections={activeTab === 'cross-sell' ? [...CROSS_SELL_ANCHORS] : undefined}
      showBasicFilterBar={false}
      headerRightContent={renderHeaderControls}
    >
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

        {activeTab === 'renewal' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setRenewalTab('drilldown')}
                className={cn(
                  buttonStyles.base, buttonStyles.sizeSmall,
                  renewalTab === 'drilldown' ? buttonStyles.primary : buttonStyles.secondary
                )}
              >
                续保下钻分析
              </button>
              <button
                onClick={() => setRenewalTab('detail')}
                className={cn(
                  buttonStyles.base, buttonStyles.sizeSmall,
                  renewalTab === 'detail' ? buttonStyles.primary : buttonStyles.secondary
                )}
              >
                续保明细表
              </button>
            </div>

            {renewalTab === 'drilldown' && (
              <div className="space-y-4">
                <div className="bg-primary-bg border border-primary-border rounded-lg p-4">
                  <div className="flex items-center gap-4">
                    <label className="text-sm font-medium text-primary-dark">
                      统计截止日期：
                    </label>
                    <input
                      type="date"
                      value={cutoffDate}
                      onChange={(e) => setCutoffDate(e.target.value)}
                      min="2026-01-01"
                      max={maxDataDate || '2026-12-31'}
                      className="px-3 py-2 border border-primary-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-xs text-primary-dark">
                      起始日期固定为 2026-01-01
                    </span>
                  </div>
                </div>
                <RenewalDrilldownPanel
                  filters={filters}
                  targetYear={filters.analysis_year || new Date().getFullYear()}
                  cutoffDate={cutoffDate}
                  bundleOnly={bundleOnly}
                  setBundleOnly={setBundleOnly}
                  selfRenewalOnly={selfRenewalOnly}
                  setSelfRenewalOnly={setSelfRenewalOnly}
                  selectedDueMonth={selectedDueMonth}
                  setSelectedDueMonth={setSelectedDueMonth}
                />
              </div>
            )}

            {renewalTab === 'detail' && (
              <RenewalAnalysisPanel
                filters={{ ...filters, analysis_year: 2026 }}
                perspective={perspective}
                setPerspective={setPerspective}
              />
            )}
          </div>
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
