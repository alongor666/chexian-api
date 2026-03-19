import React, { useState } from 'react';
import { RenewalAnalysisPanel } from '../dashboard/RenewalAnalysisPanel';
import { RenewalDrilldownPanel } from '../dashboard/RenewalDrilldownPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel, FilterQuickActions } from '../../components/layout/PageFilterPanel';
import type { ViewPerspective } from '../../shared/types';

type RenewalTab = 'drilldown' | 'detail';

export const RenewalPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();

  const [perspective, setPerspective] = useState<ViewPerspective>('premium');
  const [activeTab, setActiveTab] = useState<RenewalTab>('drilldown');
  const [cutoffDate, setCutoffDate] = useState<string>(
    maxDataDate || new Date().toISOString().split('T')[0]
  );

  const [bundleOnly, setBundleOnly] = useState(false);
  const [selfRenewalOnly, setSelfRenewalOnly] = useState(false);
  const [selectedDueMonth, setSelectedDueMonth] = useState<number | null>(null);

  const detailFilters = {
    ...filters,
    analysis_year: 2026,
  };

  return (
    <PageFilterPanel
      preset="renewalDetail"
      title="续保分析"
      showBasicFilterBar={false}
      headerRightContent={(actions) => <FilterQuickActions {...actions} />}
    >
      <div className="p-4 space-y-4">
        <div className="bg-white rounded shadow">
          <div className="border-b border-neutral-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('drilldown')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'drilldown'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
                }`}
              >
                续保下钻分析
              </button>
              <button
                onClick={() => setActiveTab('detail')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'detail'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
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
