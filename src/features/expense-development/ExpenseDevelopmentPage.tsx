/**
 * 费用率发展页面
 *
 * 展示 2023-2026 年费用率按月累计发展趋势。
 * 开发状态 — 仅超级用户可见。
 */
import React, { useState, useMemo } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn } from '@/shared/styles';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { QuickFilterBar, type QuickFilters } from '../claims-detail/components/QuickFilterBar';
import { useExpenseDevelopment } from './hooks/useExpenseDevelopment';
import { ExpenseRatioDevelopmentPanel } from './components/ExpenseRatioDevelopmentPanel';

function buildSummary(filters: Record<string, any>): string {
  const year = filters.analysis_year ?? new Date().getFullYear();
  const start = filters.policy_date_start ?? '';
  const end = filters.policy_date_end ?? '';
  const startShort = start ? start.slice(5) : '01-01';
  const endShort = end ? end.slice(5) : '12-31';
  return `${year}年 | 起保日期 | ${startShort} ~ ${endShort}`;
}

export const ExpenseDevelopmentPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const hook = useExpenseDevelopment();

  const [quickFilters, setQuickFilters] = useState<QuickFilters>({});

  const params = useMemo(() => {
    const base: Record<string, string> = {};
    if (quickFilters.customerCategory) base.customerCategory = quickFilters.customerCategory;
    if (quickFilters.isNev) base.isNev = quickFilters.isNev;
    if (quickFilters.coverageCombination) base.coverageCombination = quickFilters.coverageCombination;
    if (quickFilters.isTransfer) base.isTransfer = quickFilters.isTransfer;
    return base;
  }, [quickFilters]);

  const summary = useMemo(() => buildSummary(filters), [filters]);

  return (
    <PageFilterPanel
      preset="claimsDetail"
      title="费用率发展"
      showBasicFilterBar={false}
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
          onChange={setQuickFilters}
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
