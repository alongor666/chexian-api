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
import { SortableTable } from './SortableTable';
import { usePremiumReport } from '../hooks/usePremiumReport';
import { useGlobalFilters } from '../../../shared/contexts/FilterContext';
import type { TableColumn } from '../types/tableTypes';
import type { OrgPremiumReportRow, SalesmanPremiumReportRow } from '../types/premiumReport';
import { formatWanDirect, formatRate, formatCount, formatTeamName } from '../../../shared/utils/formatters';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { colorClasses, fontStyles } from '../../../shared/styles';

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
  { key: 'salesman_name', header: '业务员姓名', sortable: true, align: 'left' },
  { key: 'org_level_3', header: '所属机构', sortable: true, align: 'left' },
  { key: 'team_name', header: '所属团队', sortable: true, align: 'left', format: (v) => formatTeamName(v as string) },
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
  const [activeTab, setActiveTab] = useState<PremiumTab>('plan');
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
      additionalParams: buildFilterParams(filters),
    };
  }, [filters]);

  // 筛选条件变更时加载数据（仅报表 tab 需要）
  useEffect(() => {
    if (activeTab === 'report') {
      loadData(reportFilters);
    }
  }, [reportFilters, loadData, activeTab]);

  const tabs: { key: PremiumTab; label: string }[] = [
    { key: 'plan', label: '计划达成' },
    { key: 'report', label: '保费报表' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab 切换 */}
      <div className={`border-b ${colorClasses.border.neutral}`}>
        <nav className="flex -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? `border-primary ${colorClasses.text.primary}`
                  : `border-transparent ${colorClasses.text.neutralMuted} hover:text-neutral-700 dark:hover:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600`
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
            <div className={`${colorClasses.bg.danger} border ${colorClasses.border.danger} rounded-lg p-4 ${colorClasses.text.danger}`}>
              <p className="font-medium">加载失败</p>
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* 保费报表汇总 */}
          <div id="report-summary"><PremiumSummaryCard
            summary={summary}
            dateRange={{
              startDate: reportFilters.startDate,
              endDate: reportFilters.endDate,
            }}
          /></div>

          {/* 表一：机构保费报表 */}
          <div id="report-org" className="bg-white dark:bg-neutral-800 rounded-lg shadow">
            <div className={`px-4 py-3 border-b ${colorClasses.border.neutral}`}>
              <h3 className={`text-lg font-semibold flex items-center ${colorClasses.text.neutralBlack}`}>
                <span className="mr-2">🏢</span>
                机构保费报表
              </h3>
              <p className={`text-sm mt-1 ${colorClasses.text.neutralMuted}`}>
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
            <div className={`px-4 py-3 border-t ${colorClasses.bg.neutral} ${colorClasses.border.neutral} text-sm ${colorClasses.text.neutralMuted}`}>
              共 <span className={fontStyles.numeric}>{formatCount(sortedOrgReport.length)}</span> 个机构
            </div>
          </div>

          {/* 表二：业务员保费报表 */}
          <div id="report-salesman" className="bg-white dark:bg-neutral-800 rounded-lg shadow">
            <div className={`px-4 py-3 border-b ${colorClasses.border.neutral}`}>
              <h3 className={`text-lg font-semibold flex items-center ${colorClasses.text.neutralBlack}`}>
                <span className="mr-2">👤</span>
                业务员保费报表
              </h3>
              <p className={`text-sm mt-1 ${colorClasses.text.neutralMuted}`}>
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
            <div className={`px-4 py-3 border-t ${colorClasses.bg.neutral} ${colorClasses.border.neutral} text-sm ${colorClasses.text.neutralMuted}`}>
              共 <span className={fontStyles.numeric}>{formatCount(sortedSalesmanReport.length)}</span> 名业务员
            </div>
          </div>
        </>
      ) : (
        <PremiumPlanPanel />
      )}
    </div>
  );
};
