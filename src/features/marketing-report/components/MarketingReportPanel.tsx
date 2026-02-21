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
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 p-2 flex gap-2 items-center">
        <button
          onClick={() => setActiveTab('report')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'report'
              ? 'bg-primary text-white shadow-sm'
              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
        >
          假日战报
        </button>
        <button
          onClick={() => setActiveTab('drilldown')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'drilldown'
              ? 'bg-primary text-white shadow-sm'
              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
        >
          下钻分析
        </button>
        <button
          onClick={() => setActiveTab('plan')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'plan'
              ? 'bg-primary text-white shadow-sm'
              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
        >
          保费达成
        </button>

        {/* 保费达成年度选择器 */}
        {activeTab === 'plan' && (
          <div className="ml-auto flex items-center gap-2 px-2">
            <label className="text-sm font-medium text-neutral-600 dark:text-neutral-400">计划年度：</label>
            <select
              value={planYear}
              onChange={(e) => setPlanYear(Number(e.target.value))}
              className="px-3 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary shadow-sm"
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
            <div className="bg-danger-bg dark:bg-red-900/20 border border-danger-200 dark:border-red-800/50 rounded-lg p-4 text-danger dark:text-danger-light">
              <p className="font-semibold tracking-tight">加载失败</p>
              <p className="text-sm mt-1">{error}</p>
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
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
              <h3 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white flex items-center">
                <span className="mr-2">🏢</span>
                机构战报
              </h3>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mt-1">
                各机构假日营销数据汇总（开单率 = 节假日有出单的业务员数 / 总业务员数）
              </p>
            </div>
            <div className="p-0">
              <OrganizationReportTable
                data={sortedOrgReport}
                sortState={orgReportSort}
                onSortChange={setOrgReportSort}
                loading={isLoading}
              />
            </div>
          </div>

          {/* 表二：业务员明细表 */}
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 overflow-hidden mt-6">
            <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
              <h3 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white flex items-center">
                <span className="mr-2">👤</span>
                业务员明细表
              </h3>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mt-1">
                业务员假日签单情况（签单比例 = 签单天数 / 节假日天数）
              </p>
            </div>
            <div className="p-0">
              <SalesmanDetailTable
                data={sortedSalesmanDetail}
                sortState={salesmanDetailSort}
                onSortChange={setSalesmanDetailSort}
                loading={isLoading}
              />
            </div>
            {/* 数据统计 */}
            <div className="px-5 py-4 bg-neutral-50 dark:bg-neutral-900/50 border-t border-neutral-100 dark:border-neutral-800 text-sm font-medium text-neutral-500 dark:text-neutral-400 flex items-center">
              共 <span className="mx-1 text-neutral-900 dark:text-white font-bold">{sortedSalesmanDetail.length}</span> 名业务员
              {holidayStats.totalDays > 0 && (
                <span className="ml-4 flex items-center">
                  <span className="mx-2 text-neutral-300 dark:text-neutral-700">|</span>
                  假日天数: <span className="mx-1 text-neutral-900 dark:text-white font-bold">{holidayStats.totalDays}</span> 天
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
