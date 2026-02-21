/**
 * 保费报表主面板组件
 *
 * 包含：
 * - 保费报表汇总
 * - 机构保费报表
 * - 业务员保费报表
 */

import React, { useEffect, useMemo, useState } from 'react';
import { PremiumSummaryCard } from './PremiumSummaryCard';
import { PremiumPlanPanel } from './PremiumPlanPanel';
import { SortableTable } from '../../marketing-report/components/SortableTable';
import { usePremiumReport } from '../hooks/usePremiumReport';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import type { TableColumn } from '../../marketing-report/types/marketingReport';
import type { OrgPremiumReportRow, SalesmanPremiumReportRow } from '../types/premiumReport';
import { formatWanDirect, formatRate, formatCount, formatSalesmanName } from '../../../shared/utils/formatters';

type PremiumTab = 'report' | 'plan';

/**
 * 机构保费报表列定义
 */
const orgReportColumns: TableColumn<OrgPremiumReportRow>[] = [
  { key: 'org_level_3', header: '机构名称', sortable: true, align: 'left' },
  {
    key: '车险保费',
    header: '车险保费(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '商业险保费',
    header: '商业险(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '交强险保费',
    header: '交强险(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '车险件数',
    header: '车险件数',
    sortable: true,
    align: 'right',
    format: (value) => formatCount(Number(value)),
  },
  {
    key: '商业险件数',
    header: '商业险件数',
    sortable: true,
    align: 'right',
    format: (value) => formatCount(Number(value)),
  },
  {
    key: '交强险件数',
    header: '交强险件数',
    sortable: true,
    align: 'right',
    format: (value) => formatCount(Number(value)),
  },
  {
    key: '人均保费',
    header: '人均保费(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '业务员数',
    header: '业务员数',
    sortable: true,
    align: 'right',
    format: (value) => formatCount(Number(value)),
  },
  {
    key: '同比增长率',
    header: '同比增长(%)',
    sortable: true,
    align: 'right',
    format: (value) => (value !== null ? formatRate(Number(value) / 100) : '-'),
  },
];

/**
 * 业务员保费报表列定义
 */
const salesmanReportColumns: TableColumn<SalesmanPremiumReportRow>[] = [
  {
    key: 'salesman_name',
    header: '业务员姓名',
    sortable: true,
    align: 'left',
    format: (value) => formatSalesmanName(String(value)),
  },
  { key: 'org_level_3', header: '所属机构', sortable: true, align: 'left' },
  { key: 'team_name', header: '所属团队', sortable: true, align: 'left' },
  {
    key: '车险保费',
    header: '车险保费(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '商业险保费',
    header: '商业险(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '交强险保费',
    header: '交强险(万元)',
    sortable: true,
    align: 'right',
    format: (value) => formatWanDirect(Number(value)),
  },
  {
    key: '车险件数',
    header: '车险件数',
    sortable: true,
    align: 'right',
    format: (value) => formatCount(Number(value)),
  },
  {
    key: '续保率',
    header: '续保率(%)',
    sortable: true,
    align: 'right',
    format: (value) => formatRate(Number(value) / 100),
  },
  {
    key: '非过户率',
    header: '非过户率(%)',
    sortable: true,
    align: 'right',
    format: (value) => formatRate(Number(value) / 100),
  },
];

/**
 * 保费报表主面板组件
 */
export const PremiumReportPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<PremiumTab>('report');
  const { filters } = useGlobalFilters();

  const {
    sortedOrgReport,
    sortedSalesmanReport,
    summary,
    isLoading,
    error,
    loadData,
    orgReportSort,
    salesmanReportSort,
    setOrgReportSort,
    setSalesmanReportSort,
  } = usePremiumReport();

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

  // 筛选条件变更时加载数据（仅报表 tab 需要）
  useEffect(() => {
    if (activeTab === 'report') {
      loadData(reportFilters);
    }
  }, [reportFilters, loadData, activeTab]);

  const tabs: { key: PremiumTab; label: string }[] = [
    { key: 'report', label: '保费报表' },
    { key: 'plan', label: '保费达成' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab 切换 */}
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab 内容 */}
      {activeTab === 'report' ? (
        <>
          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              <p className="font-medium">加载失败</p>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* 保费报表汇总 */}
          <PremiumSummaryCard
            summary={summary}
            dateRange={{
              startDate: reportFilters.startDate,
              endDate: reportFilters.endDate,
            }}
          />

          {/* 表一：机构保费报表 */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <span className="mr-2">🏢</span>
                机构保费报表
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                各机构保费数据汇总（包含车险、商业险、交强险保费及件数统计）
              </p>
            </div>
            <div className="p-4">
              <SortableTable
                data={sortedOrgReport}
                columns={orgReportColumns}
                sortState={orgReportSort}
                onSortChange={setOrgReportSort}
                rowKey={(row, i) => row.org_level_3 || String(i)}
                loading={isLoading}
              />
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
              共 {sortedOrgReport.length} 个机构
            </div>
          </div>

          {/* 表二：业务员保费报表 */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center">
                <span className="mr-2">👤</span>
                业务员保费报表
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                业务员保费明细（包含保费、件数、续保率、非过户率等指标）
              </p>
            </div>
            <div className="p-4">
              <SortableTable
                data={sortedSalesmanReport}
                columns={salesmanReportColumns}
                sortState={salesmanReportSort}
                onSortChange={setSalesmanReportSort}
                rowKey={(row, i) => `${row.salesman_name}-${row.org_level_3}-${row.team_name}` || String(i)}
                loading={isLoading}
              />
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
              共 {sortedSalesmanReport.length} 名业务员
            </div>
          </div>
        </>
      ) : (
        <PremiumPlanPanel />
      )}
    </div>
  );
};
