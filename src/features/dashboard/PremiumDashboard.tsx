import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../shared/utils/export';
import { PdfExportService } from '../../services/PdfExportService';
import { formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import { useKpiData } from './hooks/useKpiData';
import { useTrendData } from './hooks/useTrendData';
import { usePremiumDashboardData } from './hooks/usePremiumDashboardData';
import { usePerspective } from './hooks/usePerspective';
import { useDashboardLayout } from './hooks/useDashboardLayout';
import { KpiSection } from './components/KpiSection';
import { RoseChartsSection } from './components/RoseChartsSection';
import { TrendSection } from './components/TrendSection';
import { TableSection } from './components/TableSection';
import { DashboardCustomizerPanel } from './components/DashboardCustomizerPanel';
import type { DashboardSectionId } from './dashboardLayoutConfig';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';

import { Logger } from '@/shared/utils/logger';

const logger = new Logger('PremiumDashboard');

type TimeView = 'daily' | 'weekly' | 'monthly';

/**
 * 保费分析看板 - 综合分析视图
 */
export const PremiumDashboard: React.FC = () => {
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const { isDataLoaded } = useDataStatus();

  const isInitialized = isDataLoaded;

  // Time view state
  const [timeView, setTimeView] = useState<TimeView>('daily');

  // V2.0: 视角状态管理
  const { perspective, setPerspective, config: perspectiveConfig } = usePerspective();

  const {
    sectionOrder,
    sectionVisibility,
    kpiOrder,
    kpiVisibility,
    sectionItems,
    kpiItems,
    toggleSection,
    moveSection,
    toggleKpi,
    moveKpi,
    resetLayout,
  } = useDashboardLayout();

  const { filters } = useGlobalFilters();

  // KPI 数据获取
  const {
    kpiData: kpis,
    kpiDetails,
    loading: kpiLoading,
    error: kpiError,
  } = useKpiData({
    filters,
    enabled: true,
  });

  // 趋势数据获取
  const {
    trendData,
    qualityBusinessData,
    loading: trendLoading,
    qualityBusinessLoading,
    error: trendError,
  } = useTrendData({
    filters,
    timeView,
    hasOrgFilter: (filters.org_level_3?.length ?? 0) > 0,
    enabled: isInitialized,
    perspective,
  });

  // Refresh all data
  const {
    allBusinessTop10,
    qualityBusinessTop10,
    customerCategoryData,
    coverageCombinationData,
    terminalSourceData,
    loading,
    refresh: refreshData,
  } = usePremiumDashboardData({
    filters,
    enabled: isInitialized,
  });

  const handleExportTrend = (format: 'csv' | 'excel') => {
    if (trendData.length === 0) {
      alert('暂无趋势数据可导出');
      return;
    }

    const exportData = trendData.map((row) => ({
      时间: row.time_period,
      机构: row.org_level_3,
      保费: formatPremiumWan(row.premium),
      次月占比: row.next_month_ratio ? formatRate(row.next_month_ratio) : '-',
    }));
    const filename = `保费趋势_${timeView}_${getTimestampForFilename()}`;

    if (format === 'excel') {
      void exportToExcel(exportData, filename, '保费趋势');
      return;
    }

    exportArrayToCSV(exportData, `${filename}.csv`);
  };

  const handleExportAllBusiness = (format: 'csv' | 'excel') => {
    if (allBusinessTop10.length === 0) {
      alert('暂无表格数据可导出');
      return;
    }

    const filename = `业务员明细_全部业务Top10_${getTimestampForFilename()}`;

    if (format === 'excel') {
      void exportToExcel(allBusinessTop10, filename, '全部业务Top10');
      return;
    }

    exportArrayToCSV(allBusinessTop10, `${filename}.csv`);
  };

  const handleExportQualityBusiness = (format: 'csv' | 'excel') => {
    if (qualityBusinessTop10.length === 0) {
      alert('暂无表格数据可导出');
      return;
    }

    const filename = `业务员明细_优质业务Top10_${getTimestampForFilename()}`;

    if (format === 'excel') {
      void exportToExcel(qualityBusinessTop10, filename, '优质业务Top10');
      return;
    }

    exportArrayToCSV(qualityBusinessTop10, `${filename}.csv`);
  };

  const visibleKpis = useMemo(
    () => kpiOrder.filter((id) => kpiVisibility[id]),
    [kpiOrder, kpiVisibility]
  );

  const sectionContent: Record<DashboardSectionId, React.ReactNode> = {
    kpi: (
      <KpiSection kpis={kpis} kpiDetails={kpiDetails} loading={kpiLoading} visibleKpis={visibleKpis} />
    ),
    rose: (
      <RoseChartsSection
        customerCategoryData={customerCategoryData}
        coverageCombinationData={coverageCombinationData}
        terminalSourceData={terminalSourceData}
        isInitialized={isInitialized}
        loading={{
          customerCategory: loading.customerCategory,
          coverageCombination: loading.coverageCombination,
          terminalSource: loading.terminalSource,
        }}
      />
    ),
    trend: (
      <div className="space-y-4">
        {isInitialized && (
          <div className="bg-white p-4 rounded shadow">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <span className="font-semibold">趋势图时间视图：</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'daily' as TimeView, label: '签单日' },
                  { value: 'weekly' as TimeView, label: '签单自然周' },
                  { value: 'monthly' as TimeView, label: '签单自然月' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTimeView(value)}
                    className={`px-4 py-2 rounded ${
                      timeView === value ? 'bg-primary text-white' : 'bg-neutral-200 hover:bg-neutral-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <TrendSection
          trendData={trendData}
          qualityBusinessData={qualityBusinessData}
          trendLoading={trendLoading}
          qualityBusinessLoading={qualityBusinessLoading}
          isInitialized={isInitialized}
          timeView={timeView}
          startDate={filters.policy_date_start}
          endDate={filters.policy_date_end}
          onExportTrend={handleExportTrend}
          perspective={perspective}
          setPerspective={setPerspective}
          perspectiveConfig={perspectiveConfig}
        />
      </div>
    ),
    table: (
      <TableSection
        allBusinessData={allBusinessTop10}
        qualityBusinessData={qualityBusinessTop10}
        loading={loading.table}
        isInitialized={isInitialized}
        onExportAll={handleExportAllBusiness}
        onExportQuality={handleExportQualityBusiness}
      />
    ),
  };

  const visibleSections = useMemo(
    () => sectionOrder.filter((id) => sectionVisibility[id]),
    [sectionOrder, sectionVisibility]
  );

  const handleExportPdf = async () => {
    if (!isInitialized) return;
    try {
      setIsExportingPdf(true);
      await PdfExportService.exportDashboardToPdf('premium-dashboard-content', '保费分析看板报告');
    } catch (err) {
      logger.error('PDF export failed', err);
      alert('PDF导出失败，请重试');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Stable ref to latest refreshData — prevents effect re-firing on hook identity change
  const refreshDataRef = useRef(refreshData);
  useLayoutEffect(() => { refreshDataRef.current = refreshData; });

  // Debounced refresh effect — depends only on data inputs, not function identity
  useEffect(() => {
    const timer = setTimeout(() => {
      refreshDataRef.current();
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, timeView]);

  return (
    <div
      id="premium-dashboard-content"
      className="p-2 sm:p-3 md:p-4 max-w-[1600px] mx-auto space-y-3 sm:space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-3 sm:p-4 rounded shadow">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <h1 className="no-export text-xl sm:text-2xl font-bold">保费分析看板</h1>
          {isInitialized && (
            <button
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="no-export px-3 py-1 bg-primary text-white text-sm rounded hover:bg-primary-dark disabled:bg-neutral-400 transition-colors w-full sm:w-auto"
            >
              {isExportingPdf ? '正在导出...' : '导出PDF报告'}
            </button>
          )}
        </div>
      </div>

      {(kpiError || trendError) && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 px-4 py-3 rounded text-sm">
          {kpiError && <p>KPI 数据加载失败: {kpiError.message}</p>}
          {trendError && <p>趋势数据加载失败: {trendError.message}</p>}
        </div>
      )}

      {/* Dashboard Content */}
      <div className="space-y-4">
        <DashboardCustomizerPanel
          sectionItems={sectionItems}
          kpiItems={kpiItems}
          onToggleSection={toggleSection}
          onMoveSection={moveSection}
          onToggleKpi={toggleKpi}
          onMoveKpi={moveKpi}
          onReset={resetLayout}
        />

        {visibleSections.length === 0 ? (
          <div className="bg-white p-6 rounded shadow text-center text-neutral-500">
            未选择显示模块
          </div>
        ) : (
          visibleSections.map((sectionId) => (
            <React.Fragment key={sectionId}>{sectionContent[sectionId]}</React.Fragment>
          ))
        )}
      </div>
    </div>
  );
};
