import React, { useState } from 'react';
import { RenewalAnalysisPanel } from '../dashboard/RenewalAnalysisPanel';
import { RenewalDrilldownPanel } from '../dashboard/RenewalDrilldownPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import type { ViewPerspective } from '../../shared/types';

type RenewalTab = 'drilldown' | 'detail';

/**
 * 续保分析页面（标签页结构）
 *
 * 筛选器统一在侧边栏中管理（SidebarFilterPanel），使用 renewalDetail preset。
 *
 * 包含：
 * - 标签页1：续保下钻分析（支持截止日期选择，起始日固定2026-01-01）
 * - 标签页2：续保明细表（到期日显示年月日，高亮最新签单日期行）
 */
export const RenewalPage: React.FC = () => {
  const { filters, maxDataDate } = useGlobalFilters();

  const [perspective, setPerspective] = useState<ViewPerspective>('premium');
  const [activeTab, setActiveTab] = useState<RenewalTab>('drilldown');
  const [cutoffDate, setCutoffDate] = useState<string>(
    maxDataDate || new Date().toISOString().split('T')[0]
  );

  // 下钻分析专用筛选状态（提升到页面级统一管理）
  const [bundleOnly, setBundleOnly] = useState(false);
  const [selfRenewalOnly, setSelfRenewalOnly] = useState(false);
  const [selectedDueMonth, setSelectedDueMonth] = useState<number | null>(null);

  // 续保明细页专用筛选器（锁定分析年度=2026）
  const detailFilters = {
    ...filters,
    analysis_year: 2026,
  };

  return (
    <div className="p-4 space-y-4">
      {/* 标签页导航 */}
      <div className="bg-white rounded shadow">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('drilldown')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'drilldown'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              续保下钻分析
            </button>
            <button
              onClick={() => setActiveTab('detail')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'detail'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              续保明细表
            </button>
          </nav>
        </div>

        {/* 标签页内容 */}
        <div className="p-6">
          {activeTab === 'drilldown' && (
            <div className="space-y-6">
              {/* 截止日期选择器 */}
              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-blue-800">
                    统计截止日期：
                  </label>
                  <input
                    type="date"
                    value={cutoffDate}
                    onChange={(e) => setCutoffDate(e.target.value)}
                    min="2026-01-01"
                    max={maxDataDate || '2026-12-31'}
                    className="px-3 py-2 border border-blue-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-blue-700">
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
  );
};
