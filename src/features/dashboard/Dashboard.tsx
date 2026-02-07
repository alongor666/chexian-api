import React, { useEffect, useMemo, useState } from 'react';
import { FilterPanel } from '../filters/FilterPanel';
import { KpiCard } from '../../widgets/kpi/KpiCard';
import { BarChart } from '../../widgets/charts/BarChart';
import { RoseChart } from '../../widgets/charts/RoseChart';
import { VirtualTable } from '../../widgets/table/VirtualTable';
import { AlertPanel } from '../../widgets/alerts/AlertPanel';
import { AlertBadge } from '../../widgets/alerts/AlertBadge';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../shared/utils/export';
import { formatCount, formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import { createLogger } from '../../shared/utils/logger';
import { useDashboardData } from './hooks/useDashboardData';
import { useDashboardFilters } from './hooks/useDashboardFilters';
import { useDataQualityCheck } from './hooks/useDataQualityCheck';
import { useAlerts } from './hooks/useAlerts';
import { DataErrorIndicator } from './components/DataErrorIndicator';
import { useDataStatus } from '../../shared/contexts/DataContext';

const logger = createLogger('Dashboard');

export const Dashboard: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [alertsCollapsed, setAlertsCollapsed] = useState(true);

  const { isDataLoaded } = useDataStatus();

  const isDataEnabled = isDataLoaded;

  const { warnings: dataQualityWarnings } = useDataQualityCheck();
  const { filters, setFilters, buildWhereClause, applySalesmanFilter } = useDashboardFilters({
    onError: setError,
  });
  const whereClause = useMemo(() => buildWhereClause(), [buildWhereClause]);

  const apiFilters = useMemo(() => ({
    orgLevel3: filters.org_level_3,
    salesmanName: filters.salesman_name,
  }), [filters.org_level_3, filters.salesman_name]);

  const {
    kpis,
    chartData,
    tableData,
    customerCategoryData,
    coverageCombinationData,
    terminalSourceData,
    loading,
    errors: dataErrors,
    hasErrors: hasDataErrors,
    clearErrors: clearDataErrors,
    clearError: clearDataError,
    refresh,
  } = useDashboardData({
    whereClause,
    filters: apiFilters,
    enabled: isDataEnabled,
  });

  const {
    alerts,
    summary: alertSummary,
    loading: alertsLoading,
    refreshAlerts,
    markAsRead,
    markAllAsRead,
    markAsResolved,
  } = useAlerts({
    autoLoad: isDataEnabled,
    filters: {
      orgLevel3: filters.org_level_3 ? [filters.org_level_3] : undefined,
    },
  });

  // Export Functions
  const buildKpiExportData = () => ([
    {
      '指标': '总保费',
      '数值': kpis.total_premium ? formatPremiumWan(kpis.total_premium) : '-'
    },
    {
      '指标': '机构数',
      '数值': kpis.org_count || '-'
    },
    {
      '指标': '业务员数',
      '数值': kpis.salesman_count || '-'
    },
    {
      '指标': '人均保费',
      '数值': kpis.per_capita_premium ? formatPremiumWan(kpis.per_capita_premium) : '-'
    },
    {
      '指标': '续保占比',
      '数值': kpis.renewal_rate !== undefined ? formatRate(Number(kpis.renewal_rate)) : '-'
    },
    {
      '指标': '新能源占比',
      '数值': kpis.nev_rate !== undefined ? formatRate(Number(kpis.nev_rate)) : '-'
    },
    {
      '指标': '优质业务占比',
      '数值': kpis.quality_business_rate !== undefined ? formatRate(Number(kpis.quality_business_rate)) : '-'
    },
    {
      '指标': '商业险投保率',
      '数值': kpis.commercial_insurance_rate !== undefined ? formatRate(Number(kpis.commercial_insurance_rate)) : '-'
    }
  ]);

  const handleExportKPI = (format: 'csv' | 'excel') => {
    if (Object.keys(kpis).length === 0) {
      alert('暂无 KPI 数据可导出');
      return;
    }

    const exportData = buildKpiExportData();
    const filename = `KPI数据_${getTimestampForFilename()}`;

    if (format === 'excel') {
      void exportToExcel(exportData, filename, 'KPI数据');
      return;
    }

    exportArrayToCSV(exportData, `${filename}.csv`);
  };

  const handleExportChart = (format: 'csv' | 'excel') => {
    if (chartData.length === 0) {
      alert('暂无图表数据可导出');
      return;
    }

    const exportData = chartData.map(row => ({
      '业务员': row.dim_key,
      '保费': formatPremiumWan(row.value)
    }));
    const filename = `业务员保费Top20_${getTimestampForFilename()}`;

    if (format === 'excel') {
      void exportToExcel(exportData, filename, '业务员Top20');
      return;
    }

    exportArrayToCSV(exportData, `${filename}.csv`);
  };

  const handleExportTable = (format: 'csv' | 'excel') => {
    if (tableData.length === 0) {
      alert('暂无表格数据可导出');
      return;
    }

    const filename = `业务员明细_${getTimestampForFilename()}`;

    if (format === 'excel') {
      void exportToExcel(tableData, filename, '业务员明细');
      return;
    }

    exportArrayToCSV(tableData, `${filename}.csv`);
  };

  const handleChartDrillDown = (salesmanName: string) => {
    applySalesmanFilter(salesmanName);
  };

  // Debounced Filter Effect
  useEffect(() => {
    const timer = setTimeout(() => {
      refresh();
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, refresh]);

  const tableColumns = useMemo(
    () => [
      { key: 'salesman_name', header: '业务员', width: 100 },
      { key: 'org_level_3', header: '机构', width: 150 },
      { key: 'signed_premium', header: '签单保费', width: 120 },
      { key: 'policy_count', header: '单量', width: 80 },
    ],
    []
  );

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-4 rounded shadow">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">签单业绩分析看板</h1>
          {isDataEnabled && (
            <AlertBadge
              summary={alertSummary}
              onClick={() => setAlertsCollapsed(!alertsCollapsed)}
              showDetail
            />
          )}
        </div>
      </div>

      {error && <div className="bg-red-100 text-red-700 p-4 rounded">{error}</div>}

      {/* 数据加载错误提示 */}
      {isDataEnabled && (
        <DataErrorIndicator
          errors={dataErrors}
          hasErrors={hasDataErrors}
          onRetry={refresh}
          onDismiss={clearDataError}
          onDismissAll={clearDataErrors}
        />
      )}

      {/* Alert Panel */}
      {isDataEnabled && (
        <AlertPanel
          alerts={alerts}
          summary={alertSummary}
          loading={alertsLoading}
          onRefresh={refreshAlerts}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
          onMarkAsResolved={markAsResolved}
          collapsed={alertsCollapsed}
          onCollapsedChange={setAlertsCollapsed}
        />
      )}

      {/* Data Quality Warnings */}
      {dataQualityWarnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-800 mb-2">数据质量提醒</h3>
              <ul className="text-sm text-yellow-700 space-y-1">
                {dataQualityWarnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Filter Panel */}
      <FilterPanel filters={filters} onChange={setFilters} />

      {/* KPI Cards with Export Button */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">核心指标</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportKPI('csv')}
              disabled={!isDataEnabled || Object.keys(kpis).length === 0}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              导出 KPI CSV
            </button>
            <button
              onClick={() => handleExportKPI('excel')}
              disabled={!isDataEnabled || Object.keys(kpis).length === 0}
              className="px-3 py-1 text-sm bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              导出 KPI Excel
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <KpiCard title="总保费" value={kpis.total_premium} formatter={formatPremiumWan} loading={loading.kpi} />
          <KpiCard title="机构数" value={kpis.org_count} formatter={formatCount} loading={loading.kpi} />
          <KpiCard title="业务员数" value={kpis.salesman_count} formatter={formatCount} loading={loading.kpi} />
          <KpiCard title="人均保费" value={kpis.per_capita_premium} formatter={formatPremiumWan} loading={loading.kpi} />
          <KpiCard title="续保占比" value={kpis.renewal_rate} formatter={(val) => formatRate(Number(val))} loading={loading.kpi} />
          <KpiCard title="新能源占比" value={kpis.nev_rate} formatter={(val) => formatRate(Number(val))} loading={loading.kpi} />
          <KpiCard title="优质业务占比" value={kpis.quality_business_rate} formatter={(val) => formatRate(Number(val))} loading={loading.kpi} />
          <KpiCard title="商业险投保率" value={kpis.commercial_insurance_rate} formatter={(val) => formatRate(Number(val))} loading={loading.kpi} />
        </div>
      </div>

      {/* Rose Charts */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">占比分析</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <RoseChart
            title="客户类别占比"
            data={customerCategoryData}
            loading={loading.customerCategory}
          />
          <RoseChart
            title="险别组合占比"
            data={coverageCombinationData}
            loading={loading.coverageCombination}
          />
          <RoseChart
            title="终端来源占比"
            data={terminalSourceData}
            loading={loading.terminalSource}
            showValueLabel={false}
          />
        </div>
      </div>

      {/* Main Content: Chart + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[500px]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">业务员保费 Top20</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportChart('csv')}
                disabled={!isDataEnabled || chartData.length === 0}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                导出 CSV
              </button>
              <button
                onClick={() => handleExportChart('excel')}
                disabled={!isDataEnabled || chartData.length === 0}
                className="px-2 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                导出 Excel
              </button>
            </div>
          </div>
          <BarChart
            data={chartData}
            loading={loading.chart}
            onBarClick={handleChartDrillDown}
            valueFormatter={formatPremiumWan}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">业务员明细</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportTable('csv')}
                disabled={!isDataEnabled || tableData.length === 0}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                导出 CSV
              </button>
              <button
                onClick={() => handleExportTable('excel')}
                disabled={!isDataEnabled || tableData.length === 0}
                className="px-2 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                导出 Excel
              </button>
            </div>
          </div>
          <VirtualTable
            columns={tableColumns}
            data={tableData}
            loading={loading.table}
          />
        </div>
      </div>
    </div>
  );
};
