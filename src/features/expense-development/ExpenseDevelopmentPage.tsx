/**
 * 费用率发展页面
 *
 * 展示 2023-2026 年费用率按月累计发展趋势。
 * 开发状态 — 仅超级用户可见。
 *
 * 使用全局筛选器，快捷筛选与全局筛选双向联动。
 */
import React, { useMemo, useCallback } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn, colorClasses } from '@/shared/styles';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { PageFilterPanel, FilterQuickActions } from '@/features/filters/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import { useExpenseDevelopment } from './hooks/useExpenseDevelopment';
import { ExpenseRatioDevelopmentPanel } from './components/ExpenseRatioDevelopmentPanel';
import { useRBAC } from '@/shared/hooks/useRBAC';

export const ExpenseDevelopmentPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const hook = useExpenseDevelopment();
  const { isOrgUser, userOrg } = useRBAC();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);

  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);

  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 费用率发展` : '费用率发展';
  }, [quickFilters]);

  const params = useMemo(() => {
    return buildFilterParams(filters, { isOrgUser, userOrg });
  }, [filters, isOrgUser, userOrg]);

  return (
    <PageFilterPanel
      preset="full"
      title={dynamicTitle}
      anchorSections={[
        { id: 'expense-dev-filter', label: '快捷筛选' },
        { id: 'expense-dev-content', label: '发展趋势' },
      ]}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions} />
      )}
    >
      {/* 开发标识 */}
      <div className={cn('mb-3 inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium', colorClasses.bg.amber, colorClasses.text.amber)}>
        开发中 · 仅管理员可见
      </div>

      {/* 快捷筛选 */}
      <div id="expense-dev-filter">
        <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      </div>

      {/* 发展趋势面板 */}
      <div id="expense-dev-content">
        <ExpenseRatioDevelopmentPanel hook={hook} params={params} />
      </div>
    </PageFilterPanel>
  );
};

export default ExpenseDevelopmentPage;
