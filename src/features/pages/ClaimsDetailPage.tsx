/**
 * 赔案明细分析页面
 *
 * Tab 1: 未决赔案监控
 * Tab 2: 地理风险热力图
 * Tab 3: 赔付率发展
 *
 * 使用 claimsDetail preset，由 QuickFilterBar 提供快捷组合。
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn, colorClasses } from '@/shared/styles';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { useClaimsDetail } from '../claims-detail/hooks/useClaimsDetail';
import { PendingClaimsPanel } from '../claims-detail/components/PendingClaimsPanel';
import { GeoRiskPanel } from '../claims-detail/components/GeoRiskPanel';
import { LossRatioDevelopmentPanel } from '../claims-detail/components/LossRatioDevelopmentPanel';
import { ClaimsHeatmapPanel } from '../claims-detail/components/ClaimsHeatmapPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';

const TABS = [
  { key: 'pending', label: '未决赔案监控' },
  { key: 'geo', label: '地理风险热力图' },
  { key: 'development', label: '赔付率发展' },
  { key: 'claims-heatmap', label: '理赔热力图' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TAB_TITLES: Record<TabKey, string> = {
  pending: '未决赔案监控',
  geo: '地理风险热力图',
  development: '赔付率发展',
  'claims-heatmap': '理赔热力图',
};

/**
 * 将全局筛选参数适配为 claims-detail API 参数
 */
function adaptFilterParams(globalParams: Record<string, string>): Record<string, string> {
  const p: Record<string, string> = {};
  if (globalParams.orgNames) p.orgName = globalParams.orgNames;
  if (globalParams.startDate) p.dateStart = globalParams.startDate;
  if (globalParams.endDate) p.dateEnd = globalParams.endDate;
  return p;
}

export const ClaimsDetailPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const { filters, setFilters } = useGlobalFilters();
  const hook = useClaimsDetail();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);

  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);

  const globalParams = useMemo(() => buildFilterParams(filters), [filters]);

  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    const year = filters.analysis_year ?? new Date().getFullYear();
    const parts = [label, `${year}年`, TAB_TITLES[activeTab]].filter(Boolean);
    return parts.join(' ');
  }, [quickFilters, filters.analysis_year, activeTab]);

  // claims-detail API 使用专用参数格式。
  // ⚠ 下方 quickFilters 叠加与 buildFilterParams 产物大部分重叠但并非纯冗余
  // （如 is_nev=false 会被 deriveQuickFilters 推导为 fuelCategory=oil、
  //  renewalType=transfer 含 isNewCar=false 的页面级补丁语义）——
  // 待 Phase 2（BACKLOG d0cd4b 赔案后端补解析）一并收敛到统一函数，本期只标注豁免
  const params = useMemo(() => {
    const base = adaptFilterParams(globalParams);
    // governance-allow: filter-params-mapping
    if (quickFilters.vehicleType) base.vehicleQuickFilter = quickFilters.vehicleType;
    // governance-allow: filter-params-mapping
    if (quickFilters.enterpriseCar) base.enterpriseCar = 'true';
    // governance-allow: filter-params-mapping
    if (quickFilters.fuelCategory) base.fuelCategory = quickFilters.fuelCategory;
    // governance-allow: filter-params-mapping
    if (quickFilters.isNev !== undefined) base.isNev = String(quickFilters.isNev);
    // governance-allow: filter-params-mapping
    if (quickFilters.isNewCar !== undefined) base.isNewCar = String(quickFilters.isNewCar);
    if (quickFilters.renewalType === 'renewal') {
      // governance-allow: filter-params-mapping
      base.isRenewal = 'true';
    } else if (quickFilters.renewalType === 'transfer') {
      // governance-allow: filter-params-mapping
      base.isRenewal = 'false';
      // governance-allow: filter-params-mapping
      base.isNewCar = 'false';
    }
    // governance-allow: filter-params-mapping
    if (quickFilters.businessNature) base.businessNature = quickFilters.businessNature;
    // governance-allow: filter-params-mapping
    if (quickFilters.isTransfer !== undefined) base.isTransfer = String(quickFilters.isTransfer);
    // governance-allow: filter-params-mapping
    if (quickFilters.coverageCombination) base.coverageCombinations = quickFilters.coverageCombination;
    // governance-allow: filter-params-mapping
    if (quickFilters.insuranceType) base.insuranceType = String(quickFilters.insuranceType === 'compulsory');
    return base;
  }, [globalParams, quickFilters]);

  return (
    <PageFilterPanel
      preset="claimsDetail"
      title={dynamicTitle}
      showBasicFilterBar={true}
      anchorSections={[
        { id: 'claims-filter', label: '快捷筛选' },
        { id: 'claims-content', label: '分析内容' },
      ]}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions} />
      )}
    >
      {/* 快捷筛选栏（能力矩阵 claims_detail：PolicyFact 半连接，PR #571 后全维度可表达） */}
      <div id="claims-filter">
        <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} domain="claims_detail" />
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b mb-4">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? `border-primary ${colorClasses.text.primary}`
                : `border-transparent ${colorClasses.text.neutralMuted} hover:text-neutral-600`
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div id="claims-content">
        {activeTab === 'pending' && <PendingClaimsPanel hook={hook} params={params} />}
        {activeTab === 'geo' && <GeoRiskPanel hook={hook} params={params} />}
        {activeTab === 'development' && <LossRatioDevelopmentPanel hook={hook} params={params} />}
        {activeTab === 'claims-heatmap' && <ClaimsHeatmapPanel hook={hook} params={params} />}
      </div>
    </PageFilterPanel>
  );
};

export default ClaimsDetailPage;
