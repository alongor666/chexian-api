/**
 * 营销战报主面板组件
 *
 * 包含：
 * - 节假日统计摘要
 * - 表一：机构战报
 * - 表二：业务员明细表
 * - 假日营销下钻分析
 * - 保费达成下钻分析
 */

import React, { useEffect, useMemo, useState } from 'react';
import { OrganizationReportTable } from './OrganizationReportTable';
import { SalesmanDetailTable } from './SalesmanDetailTable';
import { HolidaySummaryCard } from './HolidaySummaryCard';
import { HolidayDrilldownPanel } from './HolidayDrilldownPanel';
import { PremiumPlanPanel } from './PremiumPlanPanel';
import { useMarketingReport } from '../hooks/useMarketingReport';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';

type MarketingTab = 'report' | 'drilldown' | 'plan';

/**
 * 营销战报主面板组件
 */
export const MarketingReportPanel: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [activeTab, setActiveTab] = useState<MarketingTab>('report');
  const [planYear, setPlanYear] = useState<number>(2026);

  const {
    sortedOrgReport,
    sortedSalesmanDetail,
    holidayStats,
    isLoading,
    error,
    loadData,
    orgReportSort,
    salesmanDetailSort,
    setOrgReportSort,
    setSalesmanDetailSort,
  } = useMarketingReport();

  // 从全局筛选器获取日期范围
  const reportFilters = useMemo(() => {
    const year = filters.analysis_year || 2026;
    const dateField = filters.date_criteria === 'insurance_start_date'
      ? 'insurance_start_date'
      : 'policy_date';

    return {
      dateField: dateField as 'policy_date' | 'insurance_start_date',
      year,
      startDate: filters.policy_date_start || `${year}-01-01`,
      endDate: filters.policy_date_end || `${year}-12-31`,
      org_level_3: filters.org_level_3,
    };
  }, [filters]);

  // 筛选条件变更时加载数据
  useEffect(() => {
    loadData(reportFilters);
  }, [reportFilters, loadData]);

  return (
    <div className="space-y-6">
      {/* 标签页切换 */}
      <div className="bg-white rounded shadow p-2 flex gap-2 items-center">
        <button
          onClick={() => setActiveTab('report')}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
            activeTab === 'report'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          假日战报
        </button>
        <button
          onClick={() => setActiveTab('drilldown')}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
            activeTab === 'drilldown'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          下钻分析
        </button>
        <button
          onClick={() => setActiveTab('plan')}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
            activeTab === 'plan'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          保费达成
        </button>

        {/* 保费达成年度选择器 */}
        {activeTab === 'plan' && (
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm text-gray-600">计划年度：</label>
            <select
              value={planYear}
              onChange={(e) => setPlanYear(Number(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={2025}>2025年</option>
              <option value={2026}>2026年</option>
            </select>
          </div>
        )}
      </div>

      {/* 假日战报 */}
      {activeTab === 'report' && (
        <>
          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              <p className="font-medium">加载失败</p>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* 节假日统计摘要 */}
          <HolidaySummaryCard
            totalDays={holidayStats.totalDays}
            holidays={holidayStats.holidays}
            dateRange={{
              startDate: reportFilters.startDate,
              endDate: reportFilters.endDate,
            }}
          />

          {/* 表一：机构战报 */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <span className="mr-2">🏢</span>
                机构战报
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                各机构假日营销数据汇总（开单率 = 节假日有出单的业务员数 / 总业务员数）
              </p>
            </div>
            <div className="p-4">
              <OrganizationReportTable
                data={sortedOrgReport}
                sortState={orgReportSort}
                onSortChange={setOrgReportSort}
                loading={isLoading}
              />
            </div>
          </div>

          {/* 表二：业务员明细表 */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <span className="mr-2">👤</span>
                业务员明细表
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                业务员假日签单情况（签单比例 = 签单天数 / 节假日天数）
              </p>
            </div>
            <div className="p-4">
              <SalesmanDetailTable
                data={sortedSalesmanDetail}
                sortState={salesmanDetailSort}
                onSortChange={setSalesmanDetailSort}
                loading={isLoading}
              />
            </div>
            {/* 数据统计 */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
              共 {sortedSalesmanDetail.length} 名业务员
              {holidayStats.totalDays > 0 && (
                <span className="ml-4">
                  | 假日天数: {holidayStats.totalDays} 天
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* 下钻分析 */}
      {activeTab === 'drilldown' && (
        <HolidayDrilldownPanel
          filters={filters}
          startDate={reportFilters.startDate}
          endDate={reportFilters.endDate}
        />
      )}

      {/* 保费达成 */}
      {activeTab === 'plan' && <PremiumPlanPanel planYear={planYear} />}
    </div>
  );
};
