import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../shared/utils/export';
import { formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import { useKpiData } from './hooks/useKpiData';
import { useTrendData } from './hooks/useTrendData';
import { usePremiumDashboardData } from './hooks/usePremiumDashboardData';
import { usePerspective } from './hooks/usePerspective';
import { useDashboardLayout } from './hooks/useDashboardLayout';
import { useDashboardBundle } from './hooks/useDashboardBundle';
import { KpiSection } from './components/KpiSection';
import { TrendSection } from './components/TrendSection';
import { TableSection } from './components/TableSection';
import { DashboardCustomizerPanel } from './components/DashboardCustomizerPanel';
import type { DashboardSectionId, KpiCardId, KpiGroup } from './dashboardLayoutConfig';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { cardStyles, cn, colorClasses } from '../../shared/styles';
import { ENABLE_BUNDLE_ROUTES } from '../../shared/api/client';

type TimeView = 'daily' | 'weekly' | 'monthly';

/**
 * 保费分析看板 - 综合分析视图
 */
interface PremiumDashboardProps {
  showCustomizerPanel?: boolean;
}

export const PremiumDashboard: React.FC<PremiumDashboardProps> = ({
  showCustomizerPanel = false,
}) => {

  const { isDataLoaded } = useDataStatus();

  const isInitialized = isDataLoaded;

  // Time view state
  const [timeView, setTimeView] = useState<TimeView>('weekly');

  // V2.0: 视角状态管理
  const { perspective, setPerspective, config: perspectiveConfig } = usePerspective();

  const {
    sectionOrder,
    sectionVisibility,
    kpiOrderByGroup,
    kpiVisibilityByGroup,
    sectionItems,
    kpiItemsByGroup,
    toggleSection,
    moveSection,
    toggleKpi,
    moveKpi,
    resetLayout,
  } = useDashboardLayout();

  const { filters } = useGlobalFilters();
  const fallbackToLegacy = !ENABLE_BUNDLE_ROUTES;

  const dashboardBundle = useDashboardBundle({
    filters,
    timeView,
    perspective,
    enabled: isInitialized && ENABLE_BUNDLE_ROUTES,
  });

  const kpiPrefetched = useMemo(() => {
    if (!dashboardBundle.bundle) return undefined;
    return {
      kpi: dashboardBundle.bundle.kpi,
      kpiDetail: dashboardBundle.bundle.kpiDetail,
    };
  }, [dashboardBundle.bundle]);

  const trendPrefetched = useMemo(() => {
    if (!dashboardBundle.bundle) return undefined;
    return {
      trendData: dashboardBundle.bundle.trend.map((item) => ({
        time_period: String(item.time_period ?? ''),
        org_level_3: String(item.org_level_3 ?? '四川'),
        premium: Number(item.premium ?? 0),
        next_month_ratio: Number(item.next_month_ratio ?? 0),
      })),
      qualityBusinessData: dashboardBundle.bundle.qualityTrend.map((item) => ({
        time_period: String(item.time_period ?? ''),
        quality_premium: Number(item.quality_premium ?? 0),
        total_premium: Number(item.total_premium ?? 0),
        quality_ratio: Number(item.quality_ratio ?? 0),
      })),
    };
  }, [dashboardBundle.bundle]);

  const rankingPrefetched = useMemo(() => {
    if (!dashboardBundle.bundle) return undefined;
    return {
      allBusinessTop10: dashboardBundle.bundle.ranking.allBusinessTop.map((row: any) => ({
        salesman_name: String(row.salesman_name ?? ''),
        org_level_3: String(row.org_level_3 ?? ''),
        total_premium: formatPremiumWan(Number(row.total_premium ?? 0)),
        policy_count: Number(row.policy_count ?? 0),
      })),
      qualityBusinessTop10: dashboardBundle.bundle.ranking.qualityBusinessTop.map((row: any) => ({
        salesman_name: String(row.salesman_name ?? ''),
        org_level_3: String(row.org_level_3 ?? ''),
        total_premium: formatPremiumWan(Number(row.total_premium ?? 0)),
        policy_count: Number(row.policy_count ?? 0),
      })),
    };
  }, [dashboardBundle.bundle]);

  // KPI 数据获取

  const {
    kpiData: kpis,
    kpiDetails,
    loading: kpiLoading,
    error: kpiError,
  } = useKpiData({
    filters,
    prefetched: kpiPrefetched,
    enabled: isInitialized && (fallbackToLegacy || Boolean(dashboardBundle.error)),
  });

  // 趋势数据获取
  const planTotal = typeof kpis.vehicle_plan_wan === 'number' ? kpis.vehicle_plan_wan : undefined;
  const latestPolicyDate = typeof kpis.latest_policy_date === 'string' ? kpis.latest_policy_date : undefined;
  const {
    trendData,
    qualityBusinessData,
    barChartData,
    loading: trendLoading,
    qualityBusinessLoading,
    error: trendError,
  } = useTrendData({
    filters,
    timeView,
    hasOrgFilter: (filters.org_level_3?.length ?? 0) > 0,
    prefetched: trendPrefetched,
    enabled: isInitialized && (fallbackToLegacy || Boolean(dashboardBundle.error)),
    perspective,
    planTotal,
    latestPolicyDate,
  });

  // Refresh all data
  const {
    allBusinessTop10,
    qualityBusinessTop10,
    loading,
    refresh: refreshData,
  } = usePremiumDashboardData({
    filters,
    prefetched: rankingPrefetched,
    enabled: isInitialized && (fallbackToLegacy || Boolean(dashboardBundle.error)),
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

  const visibleKpisByGroup = useMemo<Record<KpiGroup, KpiCardId[]>>(
    () => ({
      core: kpiOrderByGroup.core.filter((id) => kpiVisibilityByGroup.core[id]),
      focus: kpiOrderByGroup.focus.filter((id) => kpiVisibilityByGroup.focus[id]),
    }),
    [kpiOrderByGroup, kpiVisibilityByGroup]
  );

  const sectionContent: Record<DashboardSectionId, React.ReactNode> = {
    kpi: (
      <KpiSection
        kpis={kpis}
        kpiDetails={kpiDetails}
        loading={kpiLoading}
        visibleKpisByGroup={visibleKpisByGroup}
      />
    ),
    trend: (
      <div className="space-y-4">
        {isInitialized && (
          <div className={cn(cardStyles.standard)}>
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
                    className={`px-4 py-2 rounded ${timeView === value ? 'bg-primary text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-white/10 dark:text-neutral-300 dark:hover:bg-white/15'
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
          barChartData={barChartData}
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
          analysisYear={filters.analysis_year}
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
      {(kpiError || trendError || dashboardBundle.error) && (
        <div className={`${colorClasses.bg.amber} border ${colorClasses.border.warning} ${colorClasses.text.amber} px-4 py-3 rounded text-sm`}>
          {kpiError && <p>KPI 数据加载失败: {kpiError.message}</p>}
          {trendError && <p>趋势数据加载失败: {trendError.message}</p>}
          {dashboardBundle.error && <p>聚合接口加载失败: {dashboardBundle.error}</p>}
        </div>
      )}

      {/* Dashboard Content */}
      <div className="space-y-4">
        {showCustomizerPanel && (
          <div className="no-export">
            <DashboardCustomizerPanel
              sectionItems={sectionItems}
              kpiItemsByGroup={kpiItemsByGroup}
              onToggleSection={toggleSection}
              onMoveSection={moveSection}
              onToggleKpi={toggleKpi}
              onMoveKpi={moveKpi}
              onReset={resetLayout}
            />
          </div>
        )}

        {visibleSections.length === 0 ? (
          <div className={cn(cardStyles.spacious, "text-center text-neutral-500 border-none")}>
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
