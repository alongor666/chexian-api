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

function buildSummary(filters: Record<string, any>): string {
  const year = filters.analysis_year ?? new Date().getFullYear();
  const start = filters.policy_date_start ?? '';
  const end = filters.policy_date_end ?? '';
  const startShort = start ? start.slice(5) : '01-01';
  const endShort = end ? end.slice(5) : '12-31';
  return `${year}年 | 起保日期 | ${startShort} ~ ${endShort}`;
}

export const ExpenseDevelopmentPage: React.FC = () => {
  const { filters, setFilters } = useGlobalFilters();
  const hook = useExpenseDevelopment();
  const { isOrgUser, userOrg } = useRBAC();

  // 从全局筛选器派生快捷筛选状态（全局→快捷同步）
  const quickFilters = useMemo<QuickFilters>(() => ({
    customerCategory: filters.customer_category?.[0],
    isNev: filters.is_nev === true ? '1' : filters.is_nev === false ? '0' : undefined,
    coverageCombination: filters.coverage_combination?.[0],
    isTransfer: filters.is_transfer === true ? 'true' : undefined,
  }), [filters.customer_category, filters.is_nev, filters.coverage_combination, filters.is_transfer]);

  // 快捷筛选变更 → 写入全局筛选器（快捷→全局同步）
  const handleQuickFilterChange = (newQuick: QuickFilters) => {
    setFilters(prev => ({
      ...prev,
      customer_category: newQuick.customerCategory ? [newQuick.customerCategory] : undefined,
      is_nev: newQuick.isNev === '1' ? true : newQuick.isNev === '0' ? false : undefined,
      coverage_combination: newQuick.coverageCombination ? [newQuick.coverageCombination] : undefined,
      is_transfer: newQuick.isTransfer === 'true' ? true : undefined,
    }));
  };

  // 从全局筛选器构建 API 参数
  const params = useMemo(() => {
    return buildFilterParams(filters, { isOrgUser, userOrg });
  }, [filters, isOrgUser, userOrg]);

  const summary = useMemo(() => buildSummary(filters), [filters]);

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
        <QuickFilterBar
          filters={quickFilters}
          onChange={handleQuickFilterChange}
          summary={summary}
        />
      </div>

      {/* 发展趋势面板 */}
      <div id="expense-dev-content">
        <ExpenseRatioDevelopmentPanel hook={hook} params={params} />
      </div>
    </PageFilterPanel>
  );
};

export default ExpenseDevelopmentPage;
