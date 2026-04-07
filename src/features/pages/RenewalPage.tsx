import React, { useState, useMemo, useCallback } from 'react';
import { RenewalAnalysisPanel } from '../dashboard/RenewalAnalysisPanel';
import { RenewalDrilldownPanel } from '../dashboard/RenewalDrilldownPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import type { ViewPerspective } from '../../shared/types';

type RenewalTab = 'drilldown' | 'detail';

export const RenewalPage: React.FC = () => {
  const { filters, setFilters, maxDataDate } = useGlobalFilters();

  const [perspective, setPerspective] = useState<ViewPerspective>('premium');
  const [activeTab, setActiveTab] = useState<RenewalTab>('drilldown');
  const [cutoffDate, setCutoffDate] = useState<string>(
    maxDataDate || new Date().toISOString().split('T')[0]
  );

  const [bundleOnly, setBundleOnly] = useState(false);
  const [selfRenewalOnly, setSelfRenewalOnly] = useState(false);
  const [selectedDueMonth, setSelectedDueMonth] = useState<number | null>(null);

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 续保分析` : '续保分析';
  }, [quickFilters]);

  const detailFilters = {
    ...filters,
    analysis_year: 2026,
  };

  return (
    <PageFilterPanel
      preset="renewalDetail"
      title={dynamicTitle}
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div className="p-4 space-y-4">
        <div className="bg-white dark:bg-neutral-800 rounded shadow">
          <div className="border-b border-neutral-200 dark:border-neutral-700">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('drilldown')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'drilldown'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600'
                }`}
              >
                续保下钻分析
              </button>
              <button
                onClick={() => setActiveTab('detail')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'detail'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600'
                }`}
              >
                续保明细表
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'drilldown' && (
              <div className="space-y-6">
                <div className="bg-primary-bg border border-primary-border rounded p-4">
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

            {activeTab === 'detail' && (
              <RenewalAnalysisPanel
                filters={detailFilters}
                perspective={perspective}
                setPerspective={setPerspective}
              />
            )}
          </div>
        </div>
      </div>
    </PageFilterPanel>
  );
};
