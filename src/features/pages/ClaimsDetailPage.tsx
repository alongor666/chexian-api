/**
 * 赔案明细分析页面
 *
 * Tab 1: 未决赔案监控
 * Tab 2: 地理风险热力图
 *
 * 使用 PageFilterPanel 集成右侧筛选器面板
 */
import React, { useState, useMemo } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn } from '@/shared/styles';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { useClaimsDetail } from '../claims-detail/hooks/useClaimsDetail';
import { PendingClaimsPanel } from '../claims-detail/components/PendingClaimsPanel';
import { GeoRiskPanel } from '../claims-detail/components/GeoRiskPanel';

const TABS = [
  { key: 'pending', label: '未决赔案监控' },
  { key: 'geo', label: '地理风险热力图' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * 将全局筛选参数适配为 claims-detail API 参数
 * 全局: orgNames/customerCategories/startDate/endDate
 * claims-detail: orgName/customerCategory/dateStart/dateEnd
 */
function adaptFilterParams(globalParams: Record<string, string>): Record<string, string> {
  const p: Record<string, string> = {};
  if (globalParams.orgNames) p.orgName = globalParams.orgNames;
  if (globalParams.customerCategories) p.customerCategory = globalParams.customerCategories;
  if (globalParams.startDate) p.dateStart = globalParams.startDate;
  if (globalParams.endDate) p.dateEnd = globalParams.endDate;
  return p;
}

export const ClaimsDetailPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const { filters } = useGlobalFilters();
  const hook = useClaimsDetail();

  const params = useMemo(
    () => adaptFilterParams(buildFilterParams(filters)),
    [filters]
  );

  return (
    <PageFilterPanel
      preset="cost"
      title="赔案明细分析"
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions} />
      )}
    >
      {/* Tab 切换 */}
      <div className="flex gap-1 border-b mb-4">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'pending' && <PendingClaimsPanel hook={hook} params={params} />}
      {activeTab === 'geo' && <GeoRiskPanel hook={hook} params={params} />}
    </PageFilterPanel>
  );
};

export default ClaimsDetailPage;
