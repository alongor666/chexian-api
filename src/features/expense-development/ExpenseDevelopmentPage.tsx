/**
 * 费用率发展页面
 *
 * 展示 2023-2026 年费用率按月累计发展趋势。
 * 开发状态 — 仅超级用户可见。
 *
 * 使用全局筛选器，快捷筛选与全局筛选双向联动。
 */
import React, { useMemo } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn } from '@/shared/styles';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { QuickFilterBar, type QuickFilters } from '../claims-detail/components/QuickFilterBar';
import { useExpenseDevelopment } from './hooks/useExpenseDevelopment';
import { ExpenseRatioDevelopmentPanel } from './components/ExpenseRatioDevelopmentPanel';
import { useRBAC } from '@/shared/hooks/useRBAC';

export const ExpenseDevelopmentPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const hook = useExpenseDevelopment();
  const { isOrgUser, userOrg } = useRBAC();

  // 从全局筛选器派生快捷筛选状态（全局→快捷同步）
  const quickFilters = useMemo<QuickFilters>(() => ({
    vehicleType: filters.vehicle_quick_filter,
    isNev: filters.is_nev ?? undefined,
    isNewCar: filters.is_new_car ?? undefined,
    businessNature: filters.business_nature,
    isTransfer: filters.is_transfer ?? undefined,
    coverageCombination: filters.coverage_combination?.[0],
  }), [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.business_nature, filters.is_transfer, filters.coverage_combination]);

  // 快捷筛选变更 → 写入全局筛选器（快捷→全局同步）
  const handleQuickFilterChange = (newQuick: QuickFilters) => {
    setFilters(prev => ({
      ...prev,
      vehicle_quick_filter: newQuick.vehicleType,
      is_nev: newQuick.isNev,
      is_new_car: newQuick.isNewCar,
      is_renewal: newQuick.renewalType === 'renewal' ? true : newQuick.renewalType === 'transfer' ? false : undefined,
      business_nature: newQuick.businessNature,
      is_transfer: newQuick.isTransfer,
      coverage_combination: newQuick.coverageCombination ? [newQuick.coverageCombination] : undefined,
    }));
  };

  // 从全局筛选器构建 API 参数
  const params = useMemo(() => {
    return buildFilterParams(filters, { isOrgUser, userOrg });
  }, [filters, isOrgUser, userOrg]);

  return (
    <PageFilterPanel
      preset="full"
      title="费用率发展"
      anchorSections={[
        { id: 'expense-dev-filter', label: '快捷筛选' },
        { id: 'expense-dev-content', label: '发展趋势' },
      ]}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions} />
      )}
    >
      {/* 开发标识 */}
      <div className={cn('mb-3 inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium', 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300')}>
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
