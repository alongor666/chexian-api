/**
 * 赔案明细分析页面
 *
 * Tab 1: 未决赔案监控
 * Tab 2: 地理风险热力图
 * Tab 3: 赔付率发展
 *
 * 使用 claimsDetail preset 隐藏常驻筛选区，由 QuickFilterBar 提供快捷组合。
 */
import React, { useState, useMemo } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn } from '@/shared/styles';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { useClaimsDetail } from '../claims-detail/hooks/useClaimsDetail';
import { PendingClaimsPanel } from '../claims-detail/components/PendingClaimsPanel';
import { GeoRiskPanel } from '../claims-detail/components/GeoRiskPanel';
import { LossRatioDevelopmentPanel } from '../claims-detail/components/LossRatioDevelopmentPanel';
import { QuickFilterBar, type QuickFilters } from '../claims-detail/components/QuickFilterBar';

const TABS = [
  { key: 'pending', label: '未决赔案监控' },
  { key: 'geo', label: '地理风险热力图' },
  { key: 'development', label: '赔付率发展' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * 将全局筛选参数适配为 claims-detail API 参数
 */
function adaptFilterParams(globalParams: Record<string, string>): Record<string, string> {
  const p: Record<string, string> = {};
  if (globalParams.orgNames) p.orgName = globalParams.orgNames;
  if (globalParams.customerCategories) p.customerCategory = globalParams.customerCategories;
  if (globalParams.startDate) p.dateStart = globalParams.startDate;
  if (globalParams.endDate) p.dateEnd = globalParams.endDate;
  return p;
}

/** 构建筛选摘要文本 */
function buildSummary(filters: Record<string, any>): string {
  const year = filters.analysis_year ?? new Date().getFullYear();
  const start = filters.policy_date_start ?? '';
  const end = filters.policy_date_end ?? '';
  const startShort = start ? start.slice(5) : '01-01';
  const endShort = end ? end.slice(5) : '12-31';
  return `${year}年 | 起保日期 | ${startShort} ~ ${endShort}`;
}

export const ClaimsDetailPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const { filters } = useGlobalFilters();
  const hook = useClaimsDetail();

  // 快捷筛选状态（页面级，默认摩托车选中）
  const [quickFilters, setQuickFilters] = useState<QuickFilters>({
    customerCategory: '摩托车',
  });

  const globalParams = useMemo(() => buildFilterParams(filters), [filters]);

  // 合并全局筛选 + 快捷筛选
  const params = useMemo(() => {
    const base = adaptFilterParams(globalParams);
    // 快捷筛选覆盖全局筛选中的同名参数
    if (quickFilters.customerCategory) base.customerCategory = quickFilters.customerCategory;
    if (quickFilters.isNev) base.isNev = quickFilters.isNev;
    if (quickFilters.coverageCombination) base.coverageCombination = quickFilters.coverageCombination;
    if (quickFilters.isTransfer) base.isTransfer = quickFilters.isTransfer;
    return base;
  }, [globalParams, quickFilters]);

  const summary = useMemo(() => buildSummary(filters), [filters]);

  return (
    <PageFilterPanel
      preset="claimsDetail"
      title="赔案明细分析"
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions} />
      )}
    >
      {/* 快捷筛选栏 */}
      <QuickFilterBar
        filters={quickFilters}
        onChange={setQuickFilters}
        summary={summary}
      />

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
      {activeTab === 'development' && <LossRatioDevelopmentPanel hook={hook} params={params} />}
    </PageFilterPanel>
  );
};

export default ClaimsDetailPage;
